"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { Role } from "@/lib/types";

type UploadRole = Role | "AUTO";

interface Result { file_name: string; id?: string; warnings?: string[]; error?: string }

const WARNING_TEXT: Record<string, string> = {
  name_not_detected: "name not found — row will show the file name",
  email_not_detected: "no email found — can't be sent to until fixed",
  phone_not_detected: "no phone found",
  multiple_emails: "several emails — first one used",
};

export function UploadForm() {
  const [role, setRole] = useState<UploadRole>("AUTO");
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const ok = [...list].filter((f) => /\.(pdf|docx|txt)$/i.test(f.name));
    setFiles((prev) => [...prev, ...ok.filter((f) => !prev.some((p) => p.name === f.name))].slice(0, 60));
  };

  async function upload() {
    setBusy(true);
    setErr(null);
    const form = new FormData();
    form.set("role", role);
    files.forEach((f) => form.append("files", f));
    try {
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setResults(json.results);
      setFiles([]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-grid">
      <div>
        <h3 style={{ marginBottom: 12 }}>Role applied for</h3>
        <div className="role-choice">
          {(["AUTO", "PM", "SPM"] as UploadRole[]).map((r) => (
            <label key={r}>
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
              <span>
                <span className="title">{r === "AUTO" ? "Mixed — detect role" : r === "PM" ? "Product Manager" : "Senior Product Manager"}</span>
                <br />
                <span className="sub">
                  {r === "AUTO" ? "Classified as PM or SPM, then sent to Role review" : r === "PM" ? "2–4 yrs · core operations platform" : "5–8 yrs · integration and data layer"}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div
          className={`dropzone ${over ? "over" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
        >
          <h3>Drop CVs here, or click to choose</h3>
          <p className="muted" style={{ margin: "4px 0 0" }}>.pdf · .docx · .txt — scanned image PDFs aren't supported (no OCR)</p>
          <input ref={input} type="file" multiple accept=".pdf,.docx,.txt" hidden onChange={(e) => add(e.target.files)} />
        </div>

        {files.length > 0 && (
          <>
            <ul className="filelist">
              {files.map((f) => (
                <li key={f.name}>
                  <span className="mono">{(f.size / 1024).toFixed(0).padStart(4, " ")} KB</span>
                  <span style={{ flex: 1 }}>{f.name}</span>
                  <button className="btn btn-quiet" onClick={() => setFiles(files.filter((x) => x !== f))}>Remove</button>
                </li>
              ))}
            </ul>
            <div className="email-actions">
              <button className="btn btn-primary" disabled={busy} onClick={upload}>
                {busy ? "Parsing…" : role === "AUTO" ? `Upload ${files.length} for role detection` : `Upload ${files.length} as ${role}`}
              </button>
            </div>
          </>
        )}
        {err && <p className="error-text">{err}</p>}

        {results && (
          <section style={{ marginTop: 32 }}>
            <h3>Parsed {results.filter((r) => r.id).length} of {results.length}</h3>
            <ul className="filelist">
              {results.map((r) => (
                <li key={r.file_name}>
                  <span className={`mono ${r.id ? "ok" : "bad"}`}>{r.id ? r.id.slice(0, 8) : "failed"}</span>
                  <span style={{ flex: 1 }}>
                    {r.file_name}
                    {r.error && <span className="error-text"> — {r.error}</span>}
                    {r.warnings?.map((w) => <span key={w} className="muted"> · {WARNING_TEXT[w] ?? w}</span>)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="email-actions">
              <Link className="btn" href={`/?role=${role === "AUTO" ? "REVIEW" : role}`}>{role === "AUTO" ? "Go to Role review" : `Go to ${role} shortlist to score`}</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
