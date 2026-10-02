import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { ingestFile } from "@/lib/ingest";
import { ROLES, type Role } from "@/lib/types";

export const runtime = "nodejs";
// Gemini calls (median-of-3 scoring, drafting) and multi-file parsing outlast the default serverless limit.
export const maxDuration = 60;

const MAX_FILES = 60;
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const denied = await guardApi();
  if (denied) return denied;
  const form = await req.formData();
  const rawRole = form.get("role");
  // "AUTO" = mixed intake: the classify step guesses the role later.
  const role: Role | null = rawRole === "AUTO" ? null : (rawRole as Role);
  if (role !== null && !ROLES.includes(role)) return NextResponse.json({ error: "role must be PM, SPM or AUTO" }, { status: 400 });

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "no files" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `max ${MAX_FILES} files per upload` }, { status: 400 });

  const results = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) {
      results.push({ file_name: f.name, error: "file larger than 10 MB" });
      continue;
    }
    results.push(await ingestFile(role, f.name, Buffer.from(await f.arrayBuffer())));
  }
  return NextResponse.json({ results });
}
