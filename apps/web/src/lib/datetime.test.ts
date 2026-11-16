import { describe, expect, it } from "vitest";
import { parseLocalDateTime } from "./datetime";

describe("parseLocalDateTime", () => {
  it("reads datetime-local values in Asia/Baku", () => {
    expect(parseLocalDateTime("2026-12-01T10:00")).toBe("2026-12-01T06:00:00.000Z");
  });
  it("rejects impossible dates", () => {
    expect(parseLocalDateTime("2026-02-31T10:00")).toBeNull();
  });
});
