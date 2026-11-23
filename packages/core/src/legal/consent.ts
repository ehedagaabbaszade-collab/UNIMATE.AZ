export type LegalErrorKind = "underage" | "future" | "invalid" | "birth_required" | "consent" | "generic";

/** Classifies a Supabase error raised by the signup trigger / legal RPCs; null when it is unrelated. */
export function legalErrorKind(err: { message?: string } | null | undefined): LegalErrorKind | null {
  const m = err?.message ?? "";
  if (m.includes("UNDERAGE")) return "underage";
  if (m.includes("CONSENT_REQUIRED")) return "consent";
  if (m.includes("BIRTH_DATE_REQUIRED")) return "birth_required";
  if (m.includes("INVALID_BIRTH_DATE")) return "invalid";
  // The trigger's exception text is hidden behind this generic message by Supabase Auth.
  if (m.includes("Database error saving new user")) return "generic";
  return null;
}

/** True when the legal RPCs are not deployed yet (remote DB not migrated): the gate must fail open only then. */
export const isFunctionMissing = (err: { code?: string } | null | undefined): boolean => err?.code === "PGRST202" || err?.code === "42883";

/** Gate outcome for the status RPC errors: only a missing function (pre-migration) passes; any other error blocks with a retry. */
export function gateDecision(errs: Array<{ code?: string; status?: number } | null | undefined>): "check" | "skip" | "block" {
  const bad = errs.filter((e): e is { code?: string; status?: number } => !!e);
  if (!bad.length) return "check";
  return bad.every((e) => isFunctionMissing(e) || e.status === 404) ? "skip" : "block";
}

export interface LegalGate {
  needsBirth: boolean;
  /** Required consent types that need (re)acceptance. */
  pending: string[];
  marketing: boolean;
}

export function legalGate(profile: Array<{ has_birth_date: boolean }> | null, consents: Array<{ consent_type: string; granted: boolean; needs_action: boolean }> | null): LegalGate {
  return {
    needsBirth: !profile?.[0]?.has_birth_date,
    pending: (consents ?? []).filter((c) => c.needs_action).map((c) => c.consent_type),
    marketing: !!consents?.find((c) => c.consent_type === "marketing")?.granted,
  };
}

/** auth.signUp options.data fragment. */
export function signUpLegalMeta(birthDate: string, marketing: boolean, platform: "web" | "ios" | "android") {
  return { birth_date: birthDate, consents: ["terms", "privacy_notice", "ai_disclaimer", ...(marketing ? ["marketing"] : [])], platform };
}
