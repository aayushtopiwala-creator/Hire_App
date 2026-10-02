import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { processCandidate } from "@/lib/pipeline";

export const runtime = "nodejs";
// Gemini calls (median-of-3 scoring, drafting) and multi-file parsing outlast the default serverless limit.
export const maxDuration = 60;

/** AI calls 1 + 2 (extract, score) for one candidate. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  const { force } = await req.json().catch(() => ({ force: false }));
  try {
    const c = await processCandidate(id, { force: !!force });
    return NextResponse.json({ id, total_score: c.total_score });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
