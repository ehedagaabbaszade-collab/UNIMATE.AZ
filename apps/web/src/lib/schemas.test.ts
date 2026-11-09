import { describe, expect, it } from "vitest";
import { examSchema, fieldErrors, forgotSchema, questionSchema, resetSchema, signInSchema, signUpSchema, taskSchema, timetableSchema } from "./schemas";

describe("auth schemas", () => {
  it("sign-in needs an email and a password", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    const bad = signInSchema.safeParse({ email: "nope", password: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(fieldErrors(bad.error)).toEqual({ email: "validation.email", password: "validation.required" });
  });
  it("sign-up enforces password length and confirmation, and treats empty selects as null", () => {
    const base = { displayName: "Aysel", email: "a@b.co", password: "longenough1", confirmPassword: "longenough1", universityId: "", majorId: "" };
    const ok = signUpSchema.safeParse(base);
    expect(ok.success && ok.data.universityId).toBe(null);
    const short = signUpSchema.safeParse({ ...base, password: "short", confirmPassword: "short" });
    expect(short.success).toBe(false);
    const mismatch = signUpSchema.safeParse({ ...base, confirmPassword: "different11" });
    if (!mismatch.success) expect(fieldErrors(mismatch.error).confirmPassword).toBe("validation.passwordMatch");
    else throw new Error("should fail");
    expect(signUpSchema.safeParse({ ...base, universityId: "not-a-uuid" }).success).toBe(false);
  });
  it("forgot/reset", () => {
    expect(forgotSchema.safeParse({ email: "x" }).success).toBe(false);
    expect(resetSchema.safeParse({ password: "longenough1", confirmPassword: "longenough1" }).success).toBe(true);
    expect(resetSchema.safeParse({ password: "longenough1", confirmPassword: "nope" }).success).toBe(false);
  });
});

describe("planner schemas", () => {
  it("timetable requires end after start and a weekday 1-7", () => {
    expect(timetableSchema.safeParse({ title: "Calc", weekday: "2", startTime: "09:00", endTime: "10:30", location: "" }).success).toBe(true);
    const r = timetableSchema.safeParse({ title: "Calc", weekday: "2", startTime: "10:00", endTime: "09:00" });
    if (!r.success) expect(fieldErrors(r.error).endTime).toBe("validation.timeOrder");
    else throw new Error("should fail");
    expect(timetableSchema.safeParse({ title: "Calc", weekday: "8", startTime: "09:00", endTime: "10:00" }).success).toBe(false);
  });
  it("task: due date optional, priority 1-3", () => {
    const ok = taskSchema.safeParse({ title: "Essay", dueAt: "", priority: "2" });
    expect(ok.success && ok.data.dueAt).toBe(null);
    expect(taskSchema.safeParse({ title: "Essay", dueAt: "2026-01-01T10:00:00.000Z", priority: "3" }).success).toBe(true);
    expect(taskSchema.safeParse({ title: "Essay", dueAt: "garbage", priority: "2" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "Essay", dueAt: "", priority: "9" }).success).toBe(false);
    expect(taskSchema.safeParse({ title: "  ", dueAt: "", priority: "2" }).success).toBe(false);
  });
  it("exam: optional numbers become null, bounds enforced", () => {
    const ok = examSchema.safeParse({ title: "Final", startsAt: "2026-06-01T08:00:00.000Z", durationMinutes: "", location: "", weight: "" });
    expect(ok.success && [ok.data.durationMinutes, ok.data.weight, ok.data.location]).toEqual([null, null, null]);
    expect(examSchema.safeParse({ title: "Final", startsAt: "2026-06-01T08:00:00.000Z", durationMinutes: "900", weight: "" }).success).toBe(false);
    expect(examSchema.safeParse({ title: "Final", startsAt: "2026-06-01T08:00:00.000Z", durationMinutes: "", weight: "101" }).success).toBe(false);
  });
  it("chat question length", () => {
    expect(questionSchema.safeParse({ question: "  " }).success).toBe(false);
    expect(questionSchema.safeParse({ question: "x".repeat(2001) }).success).toBe(false);
    expect(questionSchema.safeParse({ question: "What is mitosis?" }).success).toBe(true);
  });
});
