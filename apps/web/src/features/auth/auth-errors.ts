import { legalErrorKind } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";

const LEGAL_KEYS = { underage: "consent.errUnderage", future: "consent.errFuture", invalid: "consent.errInvalid", birth_required: "consent.errBirthRequired", consent: "consent.errConsent", generic: "consent.errGeneric" } as const satisfies Record<string, MessageKey>;

/** Maps Supabase Auth failures to i18n keys without echoing server text. */
export function authErrorKey(err: { message?: string; status?: number; code?: string }, fallback: MessageKey): MessageKey {
  const msg = (err.message ?? "").toLowerCase();
  const code = err.code ?? "";
  const legal = legalErrorKind(err);
  if (legal) return LEGAL_KEYS[legal];
  if (err.status === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || msg.includes("rate limit")) return "auth.rateLimited";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) return "auth.emailNotConfirmed";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "auth.invalidCredentials";
  return fallback;
}
