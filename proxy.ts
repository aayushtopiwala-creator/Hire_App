import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Reachable without a session: the sign-in page only.
const PUBLIC = [/^\/login$/];

/**
 * Optimistic gate in front of everything (Next 16 "Proxy", formerly middleware). Refreshes the
 * Supabase session cookie and turns away anyone who isn't the allowed user. Pages and API routes
 * re-check on the server as well (lib/auth.ts) — this is not the only line of defence.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  const { pathname } = request.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return response;

  const { data } = await supabase.auth.getUser();
  const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  const ok = !!allowed && data.user?.email?.toLowerCase() === allowed;
  if (ok) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's static assets and the app icon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
