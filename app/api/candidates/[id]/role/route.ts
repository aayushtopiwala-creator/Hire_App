import { guardApi } from "@/lib/auth";
import { NextResponse } from "next/server";
import { confirmRole } from "@/lib/pipeline";

export const runtime = "nodejs";

/** Founder confirms or flips a candidate's role. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi();
  if (denied) return denied;
  const { id } = await params;
  const { role } = await req.json().catch(() => ({}));
  if (role !== "PM" && role !== "SPM") return NextResponse.json({ error: "role must be PM or SPM" }, { status: 400 });
  try {
    const c = await confirmRole(id, role);
    return NextResponse.json({ id, role: c.role });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
