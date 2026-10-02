"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role, RoleSignals, RoleStatus } from "@/lib/types";
import { RoleTabs, type TabKey } from "./Tabs";

export interface ReviewView {
  id: string;
  name: string;
  nameOk: boolean;
  nameMethod: string | null;
  fileName: string;
  roleStatus: RoleStatus;
  role: Role | null;
  guess: Role | null;
  confidence: "high" | "medium" | "low" | null;
  reason: string | null;
  signals: RoleSignals | null;
  error: string | null;
}

async function post(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

const other = (r: Role): Role => (r === "PM" ? "SPM" : "PM");

export function RoleReview(props: { counts: Record<TabKey, number>; topN: number; items: ReviewView[]; folderFiles: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const needName = props.items.filter((c) => !c.nameOk);
  const unclassified = props.items.filter((c) => c.nameOk && c.roleStatus === "unclassified");
  const waiting = props.items.filter((c) => c.roleStatus === "needs_confirmation").length;

  async function importFolder() {
    setErrors([]);
    setBusy("Importing applications/ …");
    try {
      const { results } = await post("/api/ingest-folder");
      const added = results.filter((r: { id?: string; duplicate?: boolean }) => r.id && !r.duplicate).length;
      const dupes = results.filter((r: { duplicate?: boolean }) => r.duplicate).length;
      const failed = results.filter((r: { error?: string }) => r.error);
      setNotice(`Imported ${added} new · ${dupes} already in · ${failed.length} failed. Parsing and redaction only — no AI yet.`);
      setErrors(failed.map((r: { file_name: string; error: string }) => `${r.file_name}: ${r.error}`));
    } catch (e) {
      setErrors([(e as Error).message]);
    }
    setBusy(null);
    router.refresh();
  }

  async function classifyAll() {
    setErrors([]);
    let done = 0;
    const errs: string[] = [];
    setBusy(`Classifying 0/${unclassified.length}`);
    await pool(unclassified, 3, async (c) => {
      try {
        await post(`/api/candidates/${c.id}/classify`);
      } catch (e) {
        errs.push(`${c.fileName}: ${(e as Error).message}`);
      }
      setBusy(`Classifying ${++done}/${unclassified.length}`);
    });
    setErrors(errs);
    setBusy(null);
    router.refresh();
  }

  return (
    <>
      <h1>Role review</h1>
      <p className="lede">
        Mixed applications are sorted into PM or SPM before any scoring. A role is auto-confirmed only if the CV states it,
        or the classifier is highly confident and PM experience sits clearly inside one band (≤ 3.5 years → PM, ≥ 5.5 years →
        SPM). Everything else waits for you. Scoring only runs once a role is confirmed.
      </p>
      <RoleTabs active="REVIEW" counts={props.counts} topN={props.topN} />

      <div className="toolbar">
        <span className="counts">
          <span className="mono">{props.items.length}</span> in review · <span className="mono">{waiting}</span> waiting for you ·{" "}
          <span className="mono">{needName.length}</span> need a name · <span className="mono">{props.folderFiles}</span> files in applications/
        </span>
        <span className="spacer" />
        {busy && <span className="progress mono">{busy}</span>}
        <button className="btn" disabled={!!busy} onClick={importFolder}>Import applications/ folder</button>
        <button className="btn" disabled={!!busy || unclassified.length === 0} onClick={classifyAll}>
          Classify roles{unclassified.length ? ` (${unclassified.length})` : ""}
        </button>
      </div>
      {notice && <p className="progress">{notice}</p>}
      {errors.length > 0 && <ul className="error-text">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}

      {props.items.length === 0 ? (
        <p className="empty">Nothing waiting for a role. Import the applications/ folder, or upload CVs with “Detect role”.</p>
      ) : (
        <table className="ranked review">
          <thead>
            <tr>
              <th>Candidate</th>
              <th className="c-guess">Guess</th>
              <th>Why</th>
              <th className="c-action">Your call</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((c) => <ReviewRow key={c.id} c={c} onChanged={() => router.refresh()} />)}
          </tbody>
        </table>
      )}
    </>
  );
}

function ReviewRow({ c, onChanged }: { c: ReviewView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }

  const s = c.signals;
  const uncertain = c.confidence === "low";
  return (
    <tr className={`row-static ${uncertain || !c.nameOk ? "attention" : ""}`}>
      <td>
        <div className="cand-name">{c.name}</div>
        <div className="cand-sub"><span className="mono">{c.id.slice(0, 8)}</span> · {c.fileName}</div>
      </td>
      <td className="c-guess">
        {c.guess ? <span className="role-chip mono">{c.guess}</span> : <span className="muted">—</span>}
        {c.confidence && <div className={`conf conf-${c.confidence}`}>{c.confidence === "low" ? "uncertain" : `${c.confidence} confidence`}</div>}
      </td>
      <td>
        {!c.nameOk ? (
          <span className="error-text">
            Name not confirmed{c.nameMethod === "header" ? ` (guessed “${c.name}” from the header)` : ""} — no AI step can run until
            you enter it, so we know it’s redacted.
          </span>
        ) : c.reason ? (
          <>
            <div>{c.reason}</div>
            {s && (
              <div className="cand-sub">
                <span className="mono">{s.pm_years}</span> PM yrs · <span className="mono">{s.total_years}</span> total · {s.most_recent_title}
                {s.stated_role !== "none" && (
                  <> · stated: “{s.stated_role_quote}”{s.stated_quote_verified === false && <span className="error-text"> (not found verbatim in CV)</span>}</>
                )}
              </div>
            )}
          </>
        ) : c.error ? (
          <span className="error-text">{c.error}</span>
        ) : (
          <span className="muted">Not classified yet</span>
        )}
      </td>
      <td className="c-action">
        {!c.nameOk ? (
          <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act(() => post(`/api/candidates/${c.id}/name`, { name })); }}>
            <input placeholder="Full name as on CV" value={name} onChange={(e) => setName(e.target.value)} aria-label="Candidate full name" />
            <button className="btn" disabled={busy || name.trim().split(/\s+/).length < 2}>Save name</button>
          </form>
        ) : c.roleStatus === "auto_confirmed" && c.role ? (
          <div className="action-stack">
            <span className="ok">Auto-confirmed {c.role}</span>
            <span className="cand-sub">{s?.auto_rule}</span>
            <button className="btn btn-quiet" disabled={busy} onClick={() => act(() => post(`/api/candidates/${c.id}/role`, { role: other(c.role!) }))}>
              Change to {other(c.role)}
            </button>
          </div>
        ) : c.guess ? (
          <div className="action-stack">
            {uncertain && <span className="flag-note">Uncertain — please confirm</span>}
            <div className="btn-row">
              <button className="btn btn-primary" disabled={busy} onClick={() => act(() => post(`/api/candidates/${c.id}/role`, { role: c.guess }))}>
                Confirm {c.guess}
              </button>
              <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/candidates/${c.id}/role`, { role: other(c.guess!) }))}>
                Make it {other(c.guess)}
              </button>
            </div>
          </div>
        ) : (
          <div className="btn-row">
            <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/candidates/${c.id}/role`, { role: "PM" }))}>PM</button>
            <button className="btn" disabled={busy} onClick={() => act(() => post(`/api/candidates/${c.id}/role`, { role: "SPM" }))}>SPM</button>
          </div>
        )}
        {err && <div className="error-text">{err}</div>}
      </td>
    </tr>
  );
}
