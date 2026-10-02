import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { classifyCandidate } from "@/lib/pipeline";

export const runtime = "nodejs";
// Gemini calls (median-of-3 scoring, drafting) and multi-file parsing outlast the default serverless limit.
export const maxDuration = 60;

/** Role step (AI): guess PM/SPM for one candidate. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  try {
    const c = await classifyCandidate(id);
    return NextResponse.json({ id, role_guess: c.role_guess, role_status: c.role_status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
