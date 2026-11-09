import type { MessageKey } from "@/i18n";

/** Maps Supabase Auth failures to i18n keys without echoing server text. */
export function authErrorKey(err: { message?: string; status?: number; code?: string }, fallback: MessageKey): MessageKey {
  const msg = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";
  if (err.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || msg.includes("rate limit")) return "auth.rateLimited";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "auth.emailNotConfirmed";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "auth.invalidCredentials";
  return fallback;
}
