import { LOCALES, type MessageKey } from "@unimate/i18n";
import { z } from "zod";
import { parityIssues, stringLeaves, type ParityIssue } from "./template-params";

/** Mirrors admin_set_notification_template / admin_set_system_content. The database re-checks everything. */
export const templateSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_.]{1,80}$/, "admin.content.errKey"),
  locale: z.enum(LOCALES),
  title: z.string().trim().min(1, "admin.common.fieldRequired").max(200, "admin.common.fieldTooLong"),
  body: z
    .string()
    .max(2000, "admin.common.fieldTooLong")
    .transform((v) => (v.trim() ? v : null)),
});

export const contentKeySchema = z.string().trim().regex(/^[a-z0-9_.-]{1,100}$/, "admin.content.errKey");

export type JsonParse = { ok: true; value: unknown } | { ok: false; error: MessageKey };
/** The system-content editor holds JSON: any non-null value up to 200 KB. */
export function parseContentBody(text: string): JsonParse {
  if (new TextEncoder().encode(text).length > 200_000) return { ok: false, error: "admin.common.fieldTooLong" };
  try {
    const v: unknown = JSON.parse(text);
    return v === null ? { ok: false, error: "admin.content.errJson" } : { ok: true, value: v };
  } catch {
    return { ok: false, error: "admin.content.errJson" };
  }
}

export interface ParityVerdict {
  /** Mismatches of the locale being saved against the reference: these block the save. */
  blocking: ParityIssue | null;
  /** Other locales that no longer match once this edit lands (shown as a warning; they are edited separately). */
  warnings: ParityIssue[];
}
/**
 * `others` = the current texts of the other locales of the same key; `edited` = the texts being saved.
 * Editing az (the reference) can never block: it can only create warnings for the translations that now lag behind.
 */
export function parityVerdict(others: Partial<Record<(typeof LOCALES)[number], string[]>>, locale: (typeof LOCALES)[number], edited: string[]): ParityVerdict {
  const issues = parityIssues({ ...others, [locale]: edited });
  const blocking = issues.find((i) => i.locale === locale) ?? null;
  return { blocking, warnings: issues.filter((i) => i.locale !== locale) };
}
export const contentTexts = (body: unknown): string[] => stringLeaves(body);
