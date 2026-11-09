import { z } from "zod";

/**
 * Allowlist of languages the pipeline accepts: az (default), tr, en, ru (user decision: Russian stays). The value is
 * interpolated into prompts, so free text would be a prompt-injection channel.
 *
 * Two independent settings share it:
 *  - outputLanguage: what the AI writes in (defaults to the user's profiles.locale),
 *  - sourceLanguage: what the document is written in (optional; informational + part of the generation cache key).
 */
export const LANGUAGES = ["az", "tr", "en", "ru"] as const;
export type StudyLanguage = (typeof LANGUAGES)[number];
export const LanguageSchema = z.enum(LANGUAGES);
export const LANGUAGE_NAMES: Record<StudyLanguage, string> = { az: "Azerbaijani", tr: "Turkish", en: "English", ru: "Russian" };

/** Validated language code, or a thrown ZodError-free RangeError message handled by callers. */
export function parseLanguage(l: unknown): StudyLanguage | null {
  const p = LanguageSchema.safeParse(l);
  return p.success ? p.data : null;
}
