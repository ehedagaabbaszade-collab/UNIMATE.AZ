import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decide, isPublicPath, toRole } from "./lib/guard";
import { getSupabaseEnv } from "./lib/supabase/env";

/**
 * Next 16 "proxy" (formerly middleware). Refreshes the Supabase session cookies, sends visitors without a session to
 * /sign-in and signed-in users whose profiles.role does not allow the path to /access-denied. The role is read with the
 * user's own JWT (server-side query). Pages and the layout repeat the check (src/lib/session.ts) and the database
 * re-checks inside every RPC. When the backend is not configured it passes through so the not-configured state renders.
 */
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  if (!env) return NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        for (const { name, value } of items) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of items) response.cookies.set(name, value, options);
      },
    },
  });

  let userId: string | null;
  try {
    userId = (await supabase.auth.getUser()).data.user?.id ?? null;
  } catch {
    userId = null;
  }
  let role = null;
  if (userId && !isPublicPath(pathname)) {
    try {
      const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle<{ role: string }>();
      role = toRole(data?.role);
    } catch {
      role = null;
    }
  }

  if (pathname === "/sign-in" && userId) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const decision = decide(!!userId, role, pathname);
  if (decision.kind === "sign-in") {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (decision.kind === "denied") {
    const url = request.nextUrl.clone();
    url.pathname = "/access-denied";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
