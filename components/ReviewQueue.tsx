"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/types";
import { EmailEditor, fmtTime, type EditorCandidate } from "./EmailEditor";
import { ScoreChip } from "./Score";

export interface ReviewItem extends EditorCandidate {
  role: Role;
  rank: number;
  score: number;
  fileName: string;
  brief: string | null;
  draftWarnings: string[];
}

/**
 * The review-and-send session on one screen.
 *
 * Deliberately NOT here, and never to be added (stop and ask instead — see SUMMARY.md):
 * multi-select, select-all, "confirm all", bulk send, or any key/button that sends more than the one
 * candidate in front of you. Keyboard shortcuts only move focus and open one candidate's own
 * Confirm & Send; the send itself is always that candidate's "Send now".
 */
export function ReviewQueue({ items, testRecipient }: { items: ReviewItem[]; testRecipient: string | null }) {
  const router = useRouter();
  const total = items.length;
  const sent = items.filter((i) => i.status === "confirmed_sent");
  const invites = items.filter((i) => i.emailType === "invite");
  const rejects = items.filter((i) => i.emailType === "reject");
  const firstUnsent = items.findIndex((i) => i.status !== "confirmed_sent");

  // Invites start open (they deserve a read); rejections start collapsed.
  const [open, setOpen] = useState<Set<string>>(() => new Set(invites.filter((i) => i.status !== "confirmed_sent").map((i) => i.id)));
  const [focus, setFocus] = useState(Math.max(0, firstUnsent));
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  const toggle = useCallback((id: string, force?: boolean) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (force ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const goTo = useCallback(
    (index: number) => {
      const i = Math.min(Math.max(index, 0), items.length - 1);
      setFocus(i);
      rowRefs.current[items[i]?.id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [items],
  );

  const nextUnsentAfter = useCallback(
    (index: number) => {
      const after = items.findIndex((it, i) => i > index && it.status !== "confirmed_sent");
      return after >= 0 ? after : items.findIndex((it) => it.status !== "confirmed_sent");
    },
    [items],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      // Never hijack typing, and let a focused button handle its own Enter.
      if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const item = items[focus];
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        goTo(focus + 1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        goTo(focus - 1);
      } else if (e.key === "n") {
        e.preventDefault();
        const n = nextUnsentAfter(focus);
        if (n >= 0) goTo(n);
      } else if (e.key === "Enter" && item && !t.closest("button")) {
        e.preventDefault();
        toggle(item.id);
      } else if (e.key === "c" && item && item.status !== "confirmed_sent") {
        // Opens THIS candidate's Confirm & Send only. Sending still needs "Send now".
        e.preventDefault();
        toggle(item.id, true);
        setTimeout(() => document.getElementById(`confirm-${item.id}`)?.focus(), 50);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, items, goTo, toggle, nextUnsentAfter]);

  const afterSend = (index: number, id: string) => {
    toggle(id, false);
    const n = nextUnsentAfter(index);
    if (n >= 0) goTo(n);
  };

  const pct = total ? Math.round((sent.length / total) * 100) : 0;
  const refresh = () => router.refresh();

  const row = (item: ReviewItem) => {
    const index = items.indexOf(item);
    return (
      <ReviewRow
        key={item.id}
        item={item}
        focused={index === focus}
        open={open.has(item.id)}
        onFocus={() => setFocus(index)}
        onToggle={() => toggle(item.id)}
        refCb={(el) => (rowRefs.current[item.id] = el)}
        testRecipient={testRecipient}
        onChanged={refresh}
        onSent={() => afterSend(index, item.id)}
      />
    );
  };

  return (
    <>
      <h1>Review &amp; send</h1>
      <p className="lede">
        Every draft in one place: interview invites first, then rejections. Each email is sent only when you confirm that
        one candidate — open it, read it, Confirm &amp; Send, then Send now.
      </p>

      <div className="progress-bar" role="status" aria-live="polite">
        <div className="progress-line">
          <strong className="mono">{sent.length}</strong>&nbsp;of&nbsp;<span className="mono">{total}</span>&nbsp;confirmed
          <span className="muted">
            &nbsp;· invites <span className="mono">{invites.filter((i) => i.status === "confirmed_sent").length}/{invites.length}</span> · rejections{" "}
            <span className="mono">{rejects.filter((i) => i.status === "confirmed_sent").length}/{rejects.length}</span>
          </span>
          <span className="spacer" />
          {firstUnsent >= 0 ? (
            <button className="btn btn-quiet" onClick={() => goTo(nextUnsentAfter(focus - 1))}>
              Next unsent
            </button>
          ) : (
            <span className="ok">All {total} confirmed</span>
          )}
          <span className="muted kbd-hint">
            <kbd>j</kbd>/<kbd>k</kbd> move · <kbd>n</kbd> next unsent · <kbd>Enter</kbd> open · <kbd>c</kbd> confirm this one
          </span>
        </div>
        <div className="progress-track" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
        {testRecipient && (
          <div className="progress-redirect">
            Test redirect on — every send goes to <span className="mono">{testRecipient}</span>, not the candidate.
          </div>
        )}
      </div>

      <section className="review-section">
        <h2>
          Interview invites <span className="mono muted">{invites.length}</span>
        </h2>
        <div className="review-list">{invites.map(row)}</div>
      </section>

      <section className="review-section">
        <h2>
          Rejections <span className="mono muted">{rejects.length}</span>
        </h2>
        <p className="section-note">Personalised and reason-free. Open one to read it before you confirm.</p>
        <div className="review-list dense">{rejects.map(row)}</div>
      </section>
    </>
  );
}

function ReviewRow(props: {
  item: ReviewItem;
  focused: boolean;
  open: boolean;
  onFocus: () => void;
  onToggle: () => void;
  refCb: (el: HTMLElement | null) => void;
  testRecipient: string | null;
  onChanged: () => void;
  onSent: () => void;
}) {
  const { item, focused, open } = props;
  const isSent = item.status === "confirmed_sent";
  return (
    <article
      ref={props.refCb}
      className={`review-row ${focused ? "focused" : ""} ${isSent ? "is-sent" : ""} ${item.emailType}`}
      onMouseDown={props.onFocus}
      aria-current={focused ? "true" : undefined}
    >
      <button className="review-head" onClick={props.onToggle} aria-expanded={open}>
        <span className="mono review-rank">
          {item.role} #{item.rank}
        </span>
        <span className="review-name">{item.name}</span>
        <ScoreChip total={item.score} />
        <span className="review-subject">{item.emailSubject}</span>
        {item.draftWarnings.length > 0 && <span className="error-text">check</span>}
        <span className="review-status">
          {isSent && item.sentAt ? <span className="stamp">Sent {fmtTime(item.sentAt)}</span> : item.sendStartedAt ? <span className="error-text">Send unfinished</span> : <span className="muted">Draft</span>}
        </span>
      </button>
      {open && (
        <div className={`review-body ${item.brief ? "with-brief" : ""}`}>
          {item.brief && (
            <div>
              <h3>Interview brief</h3>
              <p className="brief">{item.brief}</p>
            </div>
          )}
          <div>
            {item.draftWarnings.length > 0 && <p className="error-text">Check before sending: {item.draftWarnings.join("; ")}</p>}
            <EmailEditor
              key={`${item.emailSubject}|${item.emailBody}|${item.status}`}
              c={item}
              testRecipient={props.testRecipient}
              onChanged={props.onChanged}
              onSent={props.onSent}
            />
          </div>
        </div>
      )}
    </article>
  );
}
