import { z } from "zod";
import type { MessageKey } from "@unimate/i18n";
import { APP_ROLES } from "./guard";

/**
 * Form schemas. Messages are i18n KEYS (never prose). They mirror the database checks so users get instant feedback;
 * the database remains the authority (its checks and role gates cannot be bypassed from the client).
 */
const req = (max: number) => z.string().trim().min(1, "admin.common.fieldRequired").max(max, "admin.common.fieldTooLong");
const opt = (max: number) => z.string().trim().max(max, "admin.common.fieldTooLong").optional().transform((v) => (v ? v : null));
const uuid = z.string().uuid("admin.common.fieldRequired");

export const reasonSchema = z.string().trim().min(3, "admin.common.reasonInvalid").max(500, "admin.common.reasonInvalid");
export const optionalReasonSchema = z.string().trim().max(500, "admin.common.reasonInvalid").optional().transform((v) => (v ? v : null));

/** https only, with a host; no credentials (mirrors public.career_https_url). */
export function isHttpsUrl(v: string): boolean {
  if (v.length > 2000 || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password;
  } catch {
    return false;
  }
}
const httpsUrl = z.string().trim().refine(isHttpsUrl, "admin.career.websiteInvalid");

export const roleChangeSchema = z.object({ role: z.enum(APP_ROLES), reason: reasonSchema });

export const PLANS = ["free", "plus", "pro"] as const;
/** `until` is a datetime-local string; it must parse and be in the future (admin_grant_plan re-checks). */
export function parseFutureDate(v: string, now: Date = new Date()): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || d.getTime() <= now.getTime() ? null : d;
}
export const grantPlanSchema = (now: Date = new Date()) =>
  z
    .object({ plan: z.enum(PLANS), until: z.string(), reason: reasonSchema })
    .superRefine((v, ctx) => {
      // Free just ends a manual grant: no expiry needed. Paid plans REQUIRE a future expiry.
      if (v.plan !== "free" && !parseFutureDate(v.until, now)) ctx.addIssue({ code: "custom", path: ["until"], message: "admin.users.untilInvalid" });
    })
    .transform((v) => ({ plan: v.plan, until: v.plan === "free" ? null : parseFutureDate(v.until, now)!.toISOString(), reason: v.reason }));

export const suspendSchema = z.object({ reason: reasonSchema });

export const institutionSchema = z.object({
  name: z.string().trim().min(2, "admin.common.fieldRequired").max(200, "admin.common.fieldTooLong"),
  shortName: opt(30),
  city: opt(100),
  type: z.enum(["university", "college"]),
  ownership: z.enum(["state", "private"]),
  affiliated: z.string().trim().max(200, "admin.common.fieldTooLong").optional().transform((v) => (v ? v : null)),
  reason: reasonSchema,
});
export const facultySchema = z.object({ universityId: uuid, name: z.string().trim().min(2, "admin.common.fieldRequired").max(200, "admin.common.fieldTooLong"), reason: reasonSchema });
export const majorSchema = z.object({
  facultyId: uuid,
  name: z.string().trim().min(2, "admin.common.fieldRequired").max(200, "admin.common.fieldTooLong"),
  degree: z.enum(["bachelor", "master", "phd"]),
  reason: reasonSchema,
});
export const courseSchema = z.object({
  universityId: uuid,
  majorId: z.string().optional().transform((v) => (v ? v : null)).pipe(z.string().uuid().nullable()),
  code: req(30),
  title: z.string().trim().min(2, "admin.common.fieldRequired").max(200, "admin.common.fieldTooLong"),
  credits: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v.replace(",", ".")) : null))
    .pipe(z.number().min(0, "admin.academic.creditsInvalid").max(30, "admin.academic.creditsInvalid").nullable().refine((n) => n === null || Number.isFinite(n), "admin.academic.creditsInvalid")),
  reason: reasonSchema,
});

export const OPPORTUNITY_KINDS = ["internship", "junior_job", "scholarship", "exchange", "competition", "hackathon", "career_event"] as const;
export const LANGS = ["az", "tr", "en", "ru"] as const;
export const organizationSchema = z.object({
  name: req(200),
  description: opt(4000),
  website: z.string().trim().optional().transform((v) => (v ? v : null)).pipe(httpsUrl.nullable()),
  verified: z.boolean(),
});
export const opportunitySchema = z.object({
  organizationId: uuid,
  kind: z.enum(OPPORTUNITY_KINDS),
  title: req(200),
  description: opt(10000),
  requirements: opt(4000),
  location: opt(200),
  remote: z.boolean(),
  deadline: z.string().trim().optional().transform((v) => (v ? v : null)).pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "admin.common.fieldRequired").nullable()),
  applyUrl: httpsUrl,
  skills: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1).max(50, "admin.common.fieldTooLong")).max(30, "admin.common.fieldTooLong")),
  languages: z.array(z.enum(LANGS)).max(4),
  sourceNote: opt(500),
});

export const PROMPT_NAME = /^[A-Za-z0-9_.:-]{1,100}$/;
export const promptSchema = z.object({
  name: z.string().trim().regex(PROMPT_NAME, "admin.prompts.nameInvalid"),
  template: z.string().refine((v) => v.trim().length >= 1 && v.length <= 50000, "admin.prompts.templateInvalid"),
  model: opt(100),
  activate: z.boolean(),
  reason: reasonSchema,
});

export const signInSchema = z.object({
  email: z.string().trim().email("admin.common.fieldRequired"),
  password: z.string().min(1, "admin.common.fieldRequired"),
});

/** First error message (an i18n key) per field, for forms. */
export function fieldErrors(error: z.ZodError): Record<string, MessageKey> {
  const out: Record<string, MessageKey> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = (typeof issue.message === "string" && issue.message.startsWith("admin.") ? issue.message : "admin.common.fieldRequired") as MessageKey;
  }
  return out;
}

/** Turns a FormData into a plain object; checkboxes become booleans, repeated keys arrays. */
export function formObject(fd: FormData, booleans: readonly string[] = [], arrays: readonly string[] = []): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of new Set(fd.keys())) {
    const all = fd.getAll(k).filter((v): v is string => typeof v === "string");
    o[k] = arrays.includes(k) ? all : (all[0] ?? "");
  }
  for (const b of booleans) o[b] = fd.get(b) === "on" || fd.get(b) === "true";
  for (const a of arrays) if (!(a in o)) o[a] = [];
  return o;
}
