import { NextResponse } from "next/server";
import { authClient } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await (await authClient()).auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
