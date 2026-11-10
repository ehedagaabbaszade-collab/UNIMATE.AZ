import { z } from "zod";
import type { MessageKey } from "@unimate/i18n";

/** Zod error messages are i18n keys; the UI translates them. */
const k = (key: MessageKey) => ({ error: key });

const email = z.email(k("validation.email"));
const password = z.string(k("validation.required")).min(10, k("validation.passwordMin")).max(200, k("validation.titleMax"));
const optionalUuid = z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable());

export const signInSchema = z.object({ email, password: z.string(k("validation.required")).min(1, k("validation.required")) });

export const signUpSchema = z
  .object({
    displayName: z.string().trim().min(1, k("validation.required")).max(80, k("validation.nameMax")),
    email,
    password,
    confirmPassword: z.string(),
    universityId: optionalUuid,
    majorId: optionalUuid,
  })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], error: "validation.passwordMatch" });

export const forgotSchema = z.object({ email });
export const resetSchema = z
  .object({ password, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ["confirmPassword"], error: "validation.passwordMatch" });

export const profileNameSchema = z.object({ displayName: z.string().trim().min(1, k("validation.required")).max(80, k("validation.nameMax")) });

const title = z.string().trim().min(1, k("validation.required")).max(200, k("validation.titleMax"));
const timeStr = z.string().regex(/^\d{2}:\d{2}$/, k("validation.date"));

export const timetableSchema = z
  .object({
    title,
    weekday: z.coerce.number(k("validation.number")).int().min(1).max(7),
    startTime: timeStr,
    endTime: timeStr,
    location: z.string().trim().max(200, k("validation.titleMax")).optional().transform((v) => v || null),
  })
  .refine((v) => v.endTime > v.startTime, { path: ["endTime"], error: "validation.timeOrder" });

export const taskSchema = z.object({
  title,
  dueAt: z.string().optional().transform((v) => (v ? v : null)).pipe(z.string().refine((s) => !Number.isNaN(Date.parse(s)), k("validation.date")).nullable()),
  priority: z.coerce.number(k("validation.number")).int().min(1).max(3),
});

export const examSchema = z.object({
  title,
  startsAt: z.string(k("validation.required")).min(1, k("validation.required")).refine((s) => !Number.isNaN(Date.parse(s)), k("validation.date")),
  durationMinutes: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number(k("validation.number")).int().min(1).max(720).nullable()),
  location: z.string().trim().max(200, k("validation.titleMax")).optional().transform((v) => v || null),
  weight: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number(k("validation.number")).min(0).max(100).nullable()),
});

export const questionSchema = z.object({ question: z.string().trim().min(1, k("validation.question")).max(2000, k("validation.question")) });

export const gpaRowSchema = z.object({
  name: z.string().max(100).optional(),
  credits: z.number(k("validation.number")).min(0, k("validation.credits")).max(60),
  score: z.number(k("validation.number")).min(0, k("validation.score")).max(100, k("validation.score")).optional(),
  letter: z.string().optional(),
});

/** Collects the first error per field path as an i18n key. */
export function fieldErrors(err: z.ZodError): Record<string, MessageKey> {
  const out: Record<string, MessageKey> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "_form");
    if (!(key in out)) out[key] = (issue.message.startsWith("validation.") ? issue.message : "validation.required") as MessageKey;
  }
  return out;
}
