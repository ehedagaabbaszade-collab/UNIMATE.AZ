import { describe, expect, it } from "vitest";
import { formatLocalDateTime, isTime, parseLocalDateTime } from "./datetime";

describe("local date-time input", () => {
  it("round-trips real dates in local time", () => {
    const iso = parseLocalDateTime("2026-11-12 14:30");
    expect(iso).not.toBeNull();
    expect(formatLocalDateTime(new Date(iso!))).toBe("2026-11-12 14:30");
    expect(parseLocalDateTime("2026-11-12T14:30")).toBe(iso);
    expect(formatLocalDateTime(new Date(parseLocalDateTime("2026-11-12")!))).toBe("2026-11-12 00:00");
  });
  it("rejects impossible or malformed input", () => {
    for (const bad of ["", "12.11.2026", "2026-02-31 10:00", "2026-13-01", "2026-11-12 24:00", "2026-11-12 10:60", "2026-11-12 7:00"]) expect(parseLocalDateTime(bad), bad).toBeNull();
  });
  it("validates HH:mm", () => {
    expect(isTime("09:05")).toBe(true);
    expect(isTime("9:05")).toBe(false);
    expect(isTime("24:00")).toBe(false);
  });
});
