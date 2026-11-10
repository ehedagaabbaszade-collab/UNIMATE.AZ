import { describe, expect, it } from "vitest";
import { dropReviewed, parseReviewResult } from "./review";

describe("review_flashcard result", () => {
  it("parses a reviewed card with xp and the server schedule", () => {
    expect(parseReviewResult({ reviewed: true, awarded: 25, reason: null, due_at: "2026-11-11T08:00:00Z", interval_days: 1, ease: 2.5, repetitions: 1 })).toMatchObject({ reviewed: true, awarded: 25, due_at: "2026-11-11T08:00:00Z" });
  });
  it("parses the not_due answer (nothing changed, nothing awarded)", () => {
    expect(parseReviewResult({ reviewed: false, awarded: 0, reason: "not_due", due_at: "2026-11-11T08:00:00Z" })).toMatchObject({ reviewed: false, awarded: 0, reason: "not_due" });
  });
  it("rejects malformed payloads", () => {
    expect(parseReviewResult(null)).toBeNull();
    expect(parseReviewResult({ awarded: 1 })).toBeNull();
    expect(parseReviewResult({ reviewed: true, awarded: -5 })).toBeNull();
  });
});

describe("dropReviewed", () => {
  it("removes exactly the answered card", () => {
    expect(dropReviewed([{ id: "a" }, { id: "b" }, { id: "c" }], "b").map((c) => c.id)).toEqual(["a", "c"]);
    expect(dropReviewed([{ id: "a" }], "zzz")).toEqual([{ id: "a" }]);
  });
});
