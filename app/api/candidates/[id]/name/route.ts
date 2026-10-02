import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { setCandidateName } from "@/lib/pipeline";

export const runtime = "nodejs";

/** Founder enters/corrects the candidate's name; redaction is re-run before any AI step. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  const { name } = await req.json().catch(() => ({}));
  if (typeof name !== "string" || name.trim().split(/\s+/).length < 2) {
    return NextResponse.json({ error: "enter the full name (at least two words)" }, { status: 400 });
  }
  try {
    const c = await setCandidateName(id, name);
    return NextResponse.json({ id, name: c.personal_details.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
