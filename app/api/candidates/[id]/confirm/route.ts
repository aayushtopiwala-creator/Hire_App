import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { sendConfirmedEmail } from "@/lib/email/send";
import { prepareEmail, resolveRecipient } from "@/lib/email/validate";
import { env } from "@/lib/env";
import { getCandidate } from "@/lib/pipeline";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
// Gemini calls (median-of-3 scoring, drafting) and multi-file parsing outlast the default serverless limit.
export const maxDuration = 60;

// A lock older than this is treated as abandoned (e.g. the server died mid-send) and can be retaken.
// Resend's idempotency key (same candidate + recipient + content) still prevents a duplicate delivery.
const LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Confirm & Send — the single code path in the system that sends an email.
 * Requires an explicit { confirm: true } from the founder's click, for one candidate.
 *
 * Order: take send lock -> call Resend -> only then mark confirmed_sent. The row never says
 * "sent" unless Resend accepted the email.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  const { subject, body, confirm } = await req.json().catch(() => ({}));
  if (confirm !== true) return NextResponse.json({ error: "explicit confirm required" }, { status: 400 });

  const c = await getCandidate(id);
  if (c.status === "confirmed_sent") return NextResponse.json({ error: "already sent" }, { status: 409 });
  if (!c.email_type) return NextResponse.json({ error: "no draft exists for this candidate" }, { status: 409 });

  const prepared = prepareEmail(subject, body, c.personal_details);
  if ("error" in prepared) return NextResponse.json({ error: prepared.error }, { status: 400 });
  const { subject: subj, text } = prepared;
  const dest = resolveRecipient(c.personal_details.email, env.emailTestRecipient(), env.allowRealSends());
  if ("blocked" in dest) return NextResponse.json({ error: dest.blocked }, { status: 400 });
  const to = dest.to;

  // 1. Take the send lock (still a draft, and no live lock) so a double click can't send twice.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LOCK_TTL_MS).toISOString();
  const { data: locked, error: lockErr } = await db()
    .from("candidates")
    .update({ send_started_at: now.toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .or(`send_started_at.is.null,send_started_at.lt.${staleBefore}`)
    .select("id");
  if (lockErr) return NextResponse.json({ error: lockErr.message }, { status: 500 });
  if (!locked?.length) return NextResponse.json({ error: "a send for this candidate is already in progress, or it was already sent" }, { status: 409 });

  // 2. Send.
  let messageId: string;
  try {
    messageId = await sendConfirmedEmail({ candidateId: id, to, subject: subj, text });
  } catch (e) {
    // Nothing was delivered: release the lock so the founder can retry.
    await db().from("candidates").update({ send_started_at: null }).eq("id", id);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // 3. Resend accepted it — only now record it as sent.
  const sentAt = new Date().toISOString();
  const record = { status: "confirmed_sent", sent_at: sentAt, sent_to: to, email_subject: subj, email_body: text, resend_message_id: messageId, send_started_at: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await db().from("candidates").update(record).eq("id", id);
    if (!error) return NextResponse.json({ ok: true, sent_to: to, sent_at: sentAt, resend_message_id: messageId });
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
  }
  // The email WAS sent but couldn't be recorded. The lock stays, so the UI blocks another send.
  console.error(`[confirm] ${id}: sent as Resend ${messageId} to ${to} but the status update failed`);
  return NextResponse.json(
    { error: `Email was sent (Resend id ${messageId}) but recording it failed — do not resend; refresh and check.`, resend_message_id: messageId },
    { status: 500 },
  );
}
