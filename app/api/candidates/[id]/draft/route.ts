import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { draftCandidate } from "@/lib/pipeline";

export const runtime = "nodejs";
// Gemini calls (median-of-3 scoring, drafting) and multi-file parsing outlast the default serverless limit.
export const maxDuration = 60;

/** AI call 3: writes a DRAFT only. Sending happens exclusively in ../confirm. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  const { topN, force } = await req.json();
  const n = Number(topN);
  if (!Number.isInteger(n) || n < 0 || n > 60) return NextResponse.json({ error: "topN must be an integer 0–60" }, { status: 400 });
  try {
    return NextResponse.json({ id, outcome: await draftCandidate(id, n, { force: !!force }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
