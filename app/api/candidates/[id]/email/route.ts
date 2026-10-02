import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { getCandidate, update } from "@/lib/pipeline";

export const runtime = "nodejs";

/** Save the founder's edits to a draft. Does not send. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  const { subject, body } = await req.json();
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    return NextResponse.json({ error: "subject and body are required" }, { status: 400 });
  }
  const c = await getCandidate(id);
  if (c.status === "confirmed_sent") return NextResponse.json({ error: "already sent — drafts are locked" }, { status: 409 });
  await update(id, { email_subject: subject, email_body: body, email_edited: true });
  return NextResponse.json({ ok: true });
}
