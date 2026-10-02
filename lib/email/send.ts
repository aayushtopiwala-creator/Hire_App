import { createHash } from "node:crypto";
import { Resend } from "resend";
import { env } from "../env";

/**
 * The ONLY module that imports Resend, and its only caller is app/api/candidates/[id]/confirm
 * (enforced by tests/send-path.test.ts). There is no bulk or automatic send anywhere.
 */
export async function sendConfirmedEmail(args: { candidateId: string; to: string; subject: string; text: string }) {
  const resend = new Resend(env.resendApiKey());
  const { data, error } = await resend.emails.send(
    { from: env.emailFrom(), to: [args.to], subject: args.subject, text: args.text },
    // Same candidate + same content can't be delivered twice, even on a retried request;
    // content is part of the key so an edited retry after a failed send isn't rejected as a reused key.
    { idempotencyKey: `candidate-${args.candidateId}-${createHash("sha256").update(args.to + args.subject + args.text).digest("hex").slice(0, 16)}` },
  );
  if (error) throw new Error(`Resend: ${error.message}`);
  return data!.id;
}
