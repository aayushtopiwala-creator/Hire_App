"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { CATEGORIES, CATEGORY_META, type ExtractedProfile, type Justifications, type Role, type Scores } from "@/lib/types";
import { ScoreChip, SegmentBar } from "./Score";
import { EmailEditor, fmtTime } from "./EmailEditor";
import { RoleTabs, type TabKey } from "./Tabs";

export interface CandidateView {
  id: string;
  rank: number | null;
  name: string;
  nameDetected: boolean;
  email: string | null;
  fileName: string;
  piiWarnings: string[];
  profile: ExtractedProfile | null;
  scores: Scores | null;
  justifications: Justifications | null;
  total: number | null;
  brief: string | null;
  emailSubject: string | null;
  emailBody: string | null;
  emailType: "invite" | "reject" | null;
  emailEdited: boolean;
  draftWarnings: string[];
  status: "draft" | "confirmed_sent";
  sentAt: string | null;
  sendStartedAt: string | null;
  sentTo: string | null;
  error: string | null;
  roleStatus: string;
  roleNote: string;
}

const ROLE_LABEL: Record<Role, string> = { PM: "Product Manager", SPM: "Senior Product Manager" };
const shortId = (id: string) => id.slice(0, 8);

async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Run jobs with limited concurrency so 60 CVs don't hit Gemini all at once. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export function Dashboard(props: { role: Role; topN: number; shortlistNote: string | null; counts: Record<TabKey, number>; candidates: CandidateView[]; testRecipient: string | null }) {
  const { role, topN, counts, candidates } = props;
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [n, setN] = useState(String(topN));

  const unscored = candidates.filter((c) => c.total === null);
  const scored = candidates.filter((c) => c.total !== null);
  const sent = candidates.filter((c) => c.status === "confirmed_sent").length;
  const needsDraft = scored.filter((c) => c.status !== "confirmed_sent" && (!c.emailBody || c.emailType !== ((c.rank ?? 0) <= topN ? "invite" : "reject")));

  async function run(label: string, ids: string[], fn: (id: string) => Promise<unknown>) {
    setErrors([]);
    let done = 0;
    setBusy(`${label} 0/${ids.length}`);
    const errs: string[] = [];
    await pool(ids, 3, async (id) => {
      try {
        await fn(id);
      } catch (e) {
        errs.push(`${candidates.find((c) => c.id === id)?.fileName}: ${(e as Error).message}`);
      }
      setBusy(`${label} ${++done}/${ids.length}`);
    });
    setErrors(errs);
    setBusy(null);
    router.refresh();
  }

  const scorePending = () => run("Scoring", unscored.map((c) => c.id), (id) => post(`/api/candidates/${id}/process`));
  const generateDrafts = () => run("Drafting", needsDraft.map((c) => c.id), (id) => post(`/api/candidates/${id}/draft`, { topN }));

  function applyN() {
    const v = Number(n);
    if (Number.isInteger(v) && v >= 0 && v <= 60 && v !== topN) router.replace(`/?role=${role}&n=${v}`);
  }

  return (
    <>
      <h1>{ROLE_LABEL[role]} shortlist</h1>
      <p className="lede">
        Ranked by rubric v2 score. Top {topN} get an interview invite draft and a brief; everyone else a personalised
        rejection draft. Nothing is sent until you confirm a candidate.
      </p>

      <RoleTabs active={role} counts={counts} topN={topN} />

      <div className="toolbar">
        <span className="counts">
          <span className="mono">{scored.length}</span> scored · <span className="mono">{unscored.length}</span> awaiting
          scoring · <span className="mono">{sent}</span> sent
        </span>
        <label className="field-inline">
          Interview shortlist
          <input value={n} onChange={(e) => setN(e.target.value)} onBlur={applyN} onKeyDown={(e) => e.key === "Enter" && applyN()} inputMode="numeric" aria-label="Shortlist size" />
        </label>
        {props.shortlistNote && <span className="counts">{props.shortlistNote}</span>}
        <span className="spacer" />
        {busy && <span className="progress mono">{busy}</span>}
        <button className="btn" disabled={!!busy || unscored.length === 0} onClick={scorePending}>
          Score pending{unscored.length ? ` (${unscored.length})` : ""}
        </button>
        <button
          className="btn"
          disabled={!!busy || unscored.length > 0 || needsDraft.length === 0}
          title={unscored.length ? "Score everyone first — ranks aren't final yet" : undefined}
          onClick={generateDrafts}
        >
          Generate drafts{needsDraft.length ? ` (${needsDraft.length})` : ""}
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="error-text">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      {candidates.length === 0 ? (
        <p className="empty">
          No {role} candidates yet. <Link href="/upload">Upload CVs</Link> to start.
        </p>
      ) : (
        <table className="ranked">
          <thead>
            <tr>
              <th className="c-rank">Rank</th>
              <th>Candidate</th>
              <th className="c-score">Score</th>
              <th className="c-bar">A–F breakdown</th>
              <th className="c-draft">Draft</th>
              <th className="c-status">Status</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, i) => {
              const isOpen = open === c.id;
              const showCut = topN > 0 && c.rank === topN && candidates[i + 1]?.rank;
              return (
                <Fragment key={c.id}>
                  <tr className={`row ${isOpen ? "open" : ""}`} onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen}>
                    <td className="c-rank">
                      <span className={`rank ${c.rank && c.rank <= topN ? "shortlisted" : ""}`}>
                        {c.rank ? String(c.rank).padStart(2, "0") : "—"}
                      </span>
                    </td>
                    <td>
                      <div className="cand-name">{c.name}</div>
                      <div className="cand-sub">
                        <span className="mono">{shortId(c.id)}</span> · {c.fileName}
                        {c.profile && ` · ${c.profile.years_experience} yrs`}
                      </div>
                    </td>
                    <td className="c-score"><ScoreChip total={c.total} /></td>
                    <td className="c-bar">{c.scores ? <SegmentBar scores={c.scores} /> : <span className="muted">{c.error ? <span className="error-text">Failed — open for details</span> : "Awaiting scoring"}</span>}</td>
                    <td className="c-draft">
                      {c.emailType ? (
                        <span className={`tag ${c.emailType}`}>
                          {c.emailType === "invite" ? "Invite" : "Rejection"}
                          {c.emailEdited && <span className="muted"> · edited</span>}
                          {c.draftWarnings.length > 0 && <span className="warn" title={c.draftWarnings.join("\n")}>check</span>}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="c-status">
                      {c.status === "confirmed_sent" && c.sentAt ? <span className="stamp">Sent {fmtTime(c.sentAt)}</span> : <span className="muted">Draft</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <Detail c={c} role={role} topN={topN} testRecipient={props.testRecipient} onChanged={() => router.refresh()} />
                      </td>
                    </tr>
                  )}
                  {showCut && (
                    <tr className="cutline">
                      <td colSpan={6}>
                        <div>Interview line · top {topN}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

const OWNERSHIP_LABEL: Record<string, string> = {
  hands_on_owner: "hands-on owner",
  direct_exposure: "direct exposure",
  surface_technical: "surface / technical",
  non_operational: "non-operational",
};

function Detail({ c, role, topN, testRecipient, onChanged }: { c: CandidateView; role: Role; topN: number; testRecipient: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(label: string, fn: () => Promise<unknown>) {
    setErr(null);
    setBusy(label);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const p = c.profile;
  return (
    <div className="detail-inner">
      <div>
        <section>
          <h3>Score breakdown</h3>
          {c.scores && c.justifications ? (
            <>
              <p className="section-note">
                <span className="mono">{c.total}</span> / 10 · every score cites evidence from the extracted profile
              </p>
              <div style={{ marginBottom: 16 }}><SegmentBar scores={c.scores} legend /></div>
              {CATEGORIES.map((k) => (
                <div className="cat" key={k}>
                  <span className="cat-letter">{k}</span>
                  <span className="cat-label">{CATEGORY_META[k].label}</span>
                  <span className="cat-score">
                    {c.scores![k]}
                    <span className="max">/{CATEGORY_META[k].max}</span>
                  </span>
                  <div className="cat-just">{c.justifications![k]}</div>
                </div>
              ))}
              {c.justifications._adjustments && <p className="section-note">Scoring notes (median of 3 runs, rubric arithmetic): {c.justifications._adjustments.join("; ")}</p>}
            </>
          ) : (
            <p className="muted">{c.error ? <span className="error-text">{c.error}</span> : "Not scored yet."}</p>
          )}
        </section>

        {p && (
          <section>
            <h3>Extracted profile</h3>
            <p className="section-note">From the PII-redacted CV · communication: {p.communication_quality}</p>
            <ul className="profile-roles">
              {p.roles.map((r, i) => (
                <li key={i}>
                  <div><strong>{r.title}</strong> · {r.company}</div>
                  <div className="when">{r.duration}</div>
                  {r.key_achievement && <div className="ach">{r.key_achievement}</div>}
                </li>
              ))}
            </ul>
            <Signals title="Ops immersion (A)" items={p.ops_immersion_signals.map((s) => ({ kind: OWNERSHIP_LABEL[s.ownership_level] ?? s.ownership_level, strong: s.ownership_level === "hands_on_owner", text: s.duration ? `· ${s.duration}` : "", quote: s.evidence_quote || s.description, verified: s.quote_verified }))} />
            <Signals title="Shipped / killed (B)" items={p.shipped_and_killed_evidence.map((s) => ({ kind: s.type.replace("_", "-"), strong: s.type !== "shipped", text: "", quote: s.evidence_quote || s.description, verified: s.quote_verified }))} />
            <Signals title="Voice and validation (F)" items={p.personal_voice_signals.map((s) => ({ kind: s.type.replaceAll("_", " "), strong: false, text: s.attribution ? `— ${s.attribution}` : "", quote: s.text, verified: s.quote_verified }))} />
            <dl className="kv" style={{ marginTop: 16 }}>
              <dt>Education</dt><dd>{p.education.join("; ") || "—"}</dd>
              <dt>Certifications</dt><dd>{p.certifications.join("; ") || "—"}</dd>
              <dt>Flags</dt><dd>{p.flags.length ? p.flags.map((f) => `${f.type.replaceAll("_", " ")}: ${f.detail}`).join("; ") : "—"}</dd>
            </dl>
          </section>
        )}
        <section>
          <div className="email-actions">
            <button className="btn-quiet btn" disabled={!!busy || c.status === "confirmed_sent"} onClick={() => act("Re-scoring…", () => post(`/api/candidates/${c.id}/process`, { force: true }))}>
              Re-extract and re-score
            </button>
            <Link className="btn-quiet btn" href={`/audit?candidate=${c.id}`}>See exactly what Gemini received</Link>
            {c.status !== "confirmed_sent" && (
              <button
                className="btn-quiet btn"
                disabled={!!busy}
                onClick={() => {
                  if (confirm(`Move to ${role === "PM" ? "SPM" : "PM"}? Its profile, scores and drafts are cleared and it is re-scored against that role.`))
                    act("Moving…", () => post(`/api/candidates/${c.id}/role`, { role: role === "PM" ? "SPM" : "PM" }));
                }}
              >
                Move to {role === "PM" ? "SPM" : "PM"}
              </button>
            )}
          </div>
          <div className="role-line" style={{ marginTop: 8 }}>
            Role {role}: {c.roleNote}
            {!c.nameDetected && <span className="error-text">Name not detected in CV — showing file name.</span>}
          </div>
        </section>
      </div>

      <div>
        {c.brief && (
          <section>
            <h3>Interview brief</h3>
            <p className="brief">{c.brief}</p>
          </section>
        )}
        <section>
          <h3>{c.emailType === "invite" ? "Interview invite" : c.emailType === "reject" ? "Rejection" : "Email"}</h3>
          {c.emailBody && c.emailSubject ? (
            <EmailEditor key={c.emailSubject + c.emailBody} c={c} testRecipient={testRecipient} onChanged={onChanged} />
          ) : (
            <p className="muted">
              {c.total === null ? "Score this candidate first." : "No draft yet — use Generate drafts once everyone in this role is scored."}
            </p>
          )}
          {c.draftWarnings.length > 0 && (
            <p className="error-text">Check before sending: {c.draftWarnings.join("; ")}</p>
          )}
          {c.total !== null && c.status !== "confirmed_sent" && (
            <div className="email-actions">
              <button className="btn-quiet btn" disabled={!!busy} onClick={() => act("Drafting…", () => post(`/api/candidates/${c.id}/draft`, { topN, force: true }))}>
                {c.emailBody ? "Regenerate draft" : "Draft now"}
                {c.emailEdited ? " (discards your edits)" : ""}
              </button>
            </div>
          )}
          {busy && <p className="progress">{busy}</p>}
          {err && <p className="error-text">{err}</p>}
        </section>
      </div>
    </div>
  );
}

function Signals({ title, items }: { title: string; items: { kind: string; strong: boolean; text: string; quote: string; verified?: boolean }[] }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="cat-label" style={{ marginBottom: 4 }}>{title}</div>
      {items.length === 0 ? (
        <div className="signal muted">None found in CV</div>
      ) : (
        items.map((s, i) => (
          <div className="signal" key={i}>
            <span className={`kind ${s.strong ? "strong" : ""}`}>{s.kind}</span>
            {/* Verbatim evidence when we have it; the model's paraphrase only as a fallback. */}
            {s.quote ? <q>{s.quote}</q> : s.text}
            {s.quote && s.text && <span className="muted"> {s.text}</span>}
            {s.verified === false && <span className="unverified">quote not found verbatim in CV</span>}
          </div>
        ))
      )}
    </div>
  );
}
