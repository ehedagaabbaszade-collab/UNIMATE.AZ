import { describe, expect, it } from "vitest";
import { STATUS_TONE, anyInFlight, isInFlight } from "./documents";

describe("document status", () => {
  it("polls only queued/processing documents", () => {
    expect(isInFlight("uploaded")).toBe(true);
    expect(isInFlight("processing")).toBe(true);
    for (const s of ["pending_upload", "ready", "failed"] as const) expect(isInFlight(s)).toBe(false);
    expect(anyInFlight([{ status: "ready" }, { status: "processing" }])).toBe(true);
    expect(anyInFlight([{ status: "ready" }])).toBe(false);
    expect(anyInFlight(undefined)).toBe(false);
  });
  it("has a tone for every status", () => expect(Object.keys(STATUS_TONE).sort()).toEqual(["failed", "pending_upload", "processing", "ready", "uploaded"]));
});
