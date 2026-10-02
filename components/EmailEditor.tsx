"use client";

import { useState } from "react";

/** The fields the editor needs; both the shortlist and the review screen pass these. */
export interface EditorCandidate {
  id: string;
  name: string;
  email: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailType: "invite" | "reject" | null;
  status: "draft" | "confirmed_sent";
  sentAt: string | null;
  sentTo: string | null;
  sendStartedAt: string | null;
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Draft editor with the ONLY send control in the UI. Sending is always two explicit steps for ONE
 * candidate: "Confirm & Send" opens a confirmation naming the recipient, then "Send now" sends.
 * There is deliberately no way to act on several candidates at once — see SUMMARY.md.
 */
export function EmailEditor({
  c,
  testRecipient,
  onChanged,
  onSent,
}: {
  c: EditorCandidate;
  testRecipient: string | null;
  onChanged: () => void;
  onSent?: () => void;
}) {
  const [subject, setSubject] = useState(c.emailSubject ?? "");
  const [body, setBody] = useState(c.emailBody ?? "");
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "sending">("idle");
  const [err, setErr] = useState<string | null>(null);
  const locked = c.status === "confirmed_sent";
  const dirty = subject !== c.emailSubject || body !== c.emailBody;
  const recipient = testRecipient ?? c.email;

  async function save() {
    setErr(null);
    setState("saving");
    try {
      const res = await fetch(`/api/candidates/${c.id}/email`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, body }) });
      if (!res.ok) throw new Error((await res.json()).error);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  async function send() {
    setErr(null);
    setState("sending");
    try {
      // The only call in the UI that can send an email; the server requires confirm: true.
      const res = await fetch(`/api/candidates/${c.id}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, body, confirm: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setConfirming(false);
      onSent?.();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  return (
    <>
      <div className="email">
        <div className="email-row">
          <label>To</label>
          <span>
            {locked ? <span className="mono">{c.sentTo}</span> : c.email ? <span className="mono">{c.email}</span> : <span className="error-text">No email found in CV</span>}
            {!locked && testRecipient && <span className="redirect-note"> → redirected to <span className="mono">{testRecipient}</span></span>}
          </span>
        </div>
        <div className="email-row">
          <label htmlFor={`subj-${c.id}`}>Subject</label>
          <input id={`subj-${c.id}`} value={subject} disabled={locked} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <textarea value={body} disabled={locked} onChange={(e) => setBody(e.target.value)} aria-label="Email body" />
      </div>

      {locked ? (
        <p style={{ marginTop: 12 }}>
          <span className="stamp">Sent {c.sentAt && fmtTime(c.sentAt)}</span> <span className="muted">to {c.sentTo}</span>
        </p>
      ) : c.sendStartedAt && !confirming ? (
        <p className="error-text" style={{ marginTop: 12 }}>
          A send for this candidate started {fmtTime(c.sendStartedAt)} and didn’t finish recording. Check the Resend dashboard
          before trying again — a retry with identical content won’t deliver twice, but an edited one would.
        </p>
      ) : confirming ? (
        <div className="confirm-box" onKeyDown={(e) => e.key === "Escape" && state === "idle" && setConfirming(false)}>
          <p>
            Send this {c.emailType === "invite" ? "interview invite" : "rejection"} to <strong className="mono">{recipient}</strong>
            {testRecipient && <span className="muted"> (test redirect — {c.name} will not receive it)</span>}? This can’t be undone.
          </p>
          <div className="email-actions" style={{ marginTop: 0 }}>
            <button className="btn btn-primary" autoFocus disabled={state !== "idle"} onClick={send}>
              {state === "sending" ? "Sending…" : "Send now"}
            </button>
            <button className="btn" disabled={state !== "idle"} onClick={() => setConfirming(false)}>Cancel</button>
            <span className="muted kbd-hint">Enter sends · Esc cancels</span>
          </div>
        </div>
      ) : (
        <div className="email-actions">
          <button
            id={`confirm-${c.id}`}
            className="btn btn-primary"
            disabled={!recipient || state !== "idle" || !subject.trim() || !body.trim()}
            onClick={() => setConfirming(true)}
          >
            Confirm &amp; Send
          </button>
          <button className="btn" disabled={!dirty || state !== "idle"} onClick={save}>
            {state === "saving" ? "Saving…" : "Save draft"}
          </button>
          {dirty && <span className="muted">Unsaved edits — Confirm &amp; Send uses what you see here.</span>}
        </div>
      )}
      {err && <p className="error-text">{err}</p>}
    </>
  );
}
