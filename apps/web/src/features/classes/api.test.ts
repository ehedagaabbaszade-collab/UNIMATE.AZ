import { describe, expect, it } from "vitest";
import { classErrorKey, clock, secondsLeft, submissionPath } from "./api";

describe("classes api helpers", () => {
  it("maps server messages to specific error keys", () => {
    expect(classErrorKey("only the class teacher can do this")).toBe("notTeacher");
    expect(classErrorKey("teachers cannot take their own class work")).toBe("teacherCannotTake");
    expect(classErrorKey("you already took this exam")).toBe("alreadyTaken");
    expect(classErrorKey("already submitted")).toBe("alreadyTaken");
    expect(classErrorKey("the exam is not open")).toBe("notOpen");
    expect(classErrorKey("already graded")).toBe("alreadyGraded");
    expect(classErrorKey("not found")).toBe("notFound");
    expect(classErrorKey("grade must be 0-100")).toBe("invalid");
    expect(classErrorKey("connection reset")).toBe("generic");
  });
  it("builds a storage path the server accepts: own folder, assignment folder, no traversal or odd characters", () => {
    const p = submissionPath("u1", "a1", "../Hesabat (son) ə.pdf", 42);
    expect(p.startsWith("u1/a1/42-")).toBe(true);
    expect(p).not.toContain("..");
    expect(p.split("/")).toHaveLength(3);
    expect(p).toMatch(/^[\w/.-]+$/);
    expect(submissionPath("u1", "a1", "", 1)).toBe("u1/a1/1-file");
  });
  it("counts down from the server deadline and formats it", () => {
    expect(secondsLeft("2026-01-01T00:01:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(60);
    expect(secondsLeft("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:05:00Z"))).toBe(0);
    expect(clock(65)).toBe("01:05");
    expect(clock(3725)).toBe("1:02:05");
  });
});
