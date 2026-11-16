import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { MODE_COOKIE, homeFor, parseMode } from "@/lib/mode";
import { isAuthOnlyPath, isProtectedPath } from "@/lib/paths";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * Next 16 "proxy" (formerly middleware): refreshes the Supabase session cookies and redirects
 * unauthenticated visitors away from protected routes. When the backend is not configured it passes
 * requests through so the app can render its "backend not configured" state.
 * Authorization is still enforced by RLS and by the (app) layout's server-side verified-claims check.
 */
export async function proxy(request: NextRequest) {
  const env = getSupabaseEnv();
  if (!env) return NextResponse.next({ request });

  const { pathname } = request.nextUrl;
  if (!isProtectedPath(pathname) && !isAuthOnlyPath(pathname) && pathname !== "/reset-password") {
    return NextResponse.next({ request });
  }

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

  let signedIn: boolean;
  try {
    // getClaims verifies the JWT locally with the project's signing keys (no Auth round trip; symmetric keys fall back to one).
    const { data } = await supabase.auth.getClaims();
    signedIn = !!data?.claims.sub;
  } catch {
    signedIn = false;
  }

  if (!signedIn && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    url.searchParams.set("next", pathname + request.nextUrl.search); // keep deep links like /planner?tab=exams; sign-in passes it through safeNext
    return NextResponse.redirect(url);
  }
  if (signedIn && isAuthOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = homeFor(parseMode(request.cookies.get(MODE_COOKIE)?.value));
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && (pathname === "/teacher" || pathname.startsWith("/teacher/")) && request.cookies.get(MODE_COOKIE)?.value !== "teacher") {
    // A teacher deep link must render in the teacher shell even with a stale student cookie.
    response.cookies.set(MODE_COOKIE, "teacher", { path: "/", maxAge: 31536000, sameSite: "lax" });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
