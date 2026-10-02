import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { ingestFolder, listApplicationFiles } from "@/lib/ingest";

export const runtime = "nodejs";
// Gemini calls (median-of-3 scoring, drafting) and multi-file parsing outlast the default serverless limit.
export const maxDuration = 60;

/** What's in applications/ (names only). */
export async function GET() {
  const denied = await guardApi();
  if (denied) return denied;
  try {
    return NextResponse.json({ files: listApplicationFiles() });
  } catch {
    return NextResponse.json({ files: [] });
  }
}

/** Batch-ingest applications/ as mixed intake (role to be classified). Parsing + PII split only — no AI. */
export async function POST() {
  const denied = await guardApi();
  if (denied) return denied;
  try {
    return NextResponse.json({ results: await ingestFolder() });
  } catch {
    // On a hosted deployment there is no local applications/ folder.
    return NextResponse.json({ error: "No applications/ folder on this deployment — use Upload CVs instead." }, { status: 400 });
  }
}
