import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/paths";
import { getServerClient } from "@/lib/supabase/server";

/** Completes email-confirmation and password-recovery links (PKCE `code` or `token_hash` flows). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const supabase = await getServerClient();
  if (!supabase) return NextResponse.redirect(`${origin}/sign-in?error=callback`);

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  let ok = false;
  if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  return NextResponse.redirect(ok ? `${origin}${next}` : `${origin}/sign-in?error=callback`);
}
