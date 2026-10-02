import { requireArjun } from "@/lib/auth";
import Link from "next/link";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Call {
  id: string;
  candidate_id: string | null;
  step: string;
  model: string;
  status: string;
  system_instruction: string;
  contents: string;
  response_text: string | null;
  error: string | null;
  pii_check: { ok: boolean; leaks: { kind: string; sample: string }[] };
  latency_ms: number | null;
  created_at: string;
  candidate_label: string | null;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ candidate?: string }> }) {
  await requireArjun();
  const { candidate } = await searchParams;
  let q = db()
    .from("ai_calls")
    .select("id, candidate_id, step, model, status, system_instruction, contents, response_text, error, pii_check, latency_ms, created_at, candidate_label")
    .order("created_at", { ascending: false })
    .limit(candidate ? 50 : 150);
  if (candidate) q = q.eq("candidate_id", candidate);
  const { data, error } = await q;
  if (error) return <p className="error-text">{error.message}</p>;
  const calls = data as unknown as Call[];
  const blocked = calls.filter((c) => c.status === "blocked").length;

  return (
    <>
      <h1>AI audit log</h1>
      <p className="lede">
        The exact system instruction and content of every Gemini call, as sent — with the result of the PII guard that
        ran on it first. Candidates appear by file name and ID only. A call the guard flags is blocked, never sent.
      </p>
      <div className="toolbar">
        <span className="counts">
          <span className="mono">{calls.length}</span> calls shown · <span className="mono">{blocked}</span> blocked by PII guard
        </span>
        {candidate && <Link href="/audit" className="btn btn-quiet">Show all candidates</Link>}
      </div>
      {calls.length === 0 && <p className="empty">No Gemini calls yet.</p>}
      {calls.map((c) => (
        <div className="audit-row" key={c.id}>
          <div className="audit-head">
            <span className="mono">{new Date(c.created_at).toLocaleString("en-IN", { hour12: false })}</span>
            <strong>{c.step}</strong>
            <span className={c.status === "ok" ? "ok" : c.status === "sent" ? "muted" : "bad"}>{c.status}</span>
            <span className={c.pii_check.ok ? "ok" : "bad"}>
              PII guard: {c.pii_check.ok ? "clean" : `blocked (${c.pii_check.leaks.map((l) => l.kind).join(", ")})`}
            </span>
            <span className="mono muted">{c.model}{c.latency_ms ? ` · ${c.latency_ms} ms` : ""}</span>
            {c.candidate_id && (
              <Link href={`/audit?candidate=${c.candidate_id}`} className="mono">
                {c.candidate_id.slice(0, 8)} · {c.candidate_label ?? "unknown file"}
              </Link>
            )}
          </div>
          <details>
            <summary>Content sent ({c.contents.length.toLocaleString()} chars)</summary>
            <pre className="payload">{c.contents}</pre>
          </details>
          <details>
            <summary>System instruction ({c.system_instruction.length.toLocaleString()} chars)</summary>
            <pre className="payload">{c.system_instruction}</pre>
          </details>
          {(c.response_text || c.error) && (
            <details>
              <summary>{c.error ? "Error" : "Response"}</summary>
              <pre className="payload">{c.error ?? c.response_text}</pre>
            </details>
          )}
        </div>
      ))}
    </>
  );
}
