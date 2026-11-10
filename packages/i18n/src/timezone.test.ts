import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "./format";
import { addDays, formatZonedInput, zonedDay, zonedDayStart, zonedDayStartOffset, zonedParts, zonedToUtc } from "./timezone";

describe("Asia/Baku calendar", () => {
  it("late evening UTC is already the next day in Baku", () => {
    const at = new Date("2026-11-10T21:30:00Z"); // 01:30 on the 11th in Baku
    expect(zonedDay(at)).toBe("2026-11-11");
    expect(zonedParts(at)).toMatchObject({ day: 11, hour: 1, minute: 30, isoWeekday: 3 });
  });
  it("round-trips wall time and never rolls over invalid dates silently", () => {
    const d = zonedToUtc(2026, 11, 10, 9, 0);
    expect(d.toISOString()).toBe("2026-11-10T05:00:00.000Z");
    expect(formatZonedInput(d)).toBe("2026-11-10 09:00");
    const feb31 = zonedToUtc(2026, 2, 31, 0, 0);
    expect(zonedParts(feb31).day).not.toBe(31);
  });
  it("day starts and date-only arithmetic", () => {
    const at = new Date("2026-11-10T21:30:00Z");
    expect(zonedDayStart(at).toISOString()).toBe("2026-11-10T20:00:00.000Z");
    expect(zonedDayStartOffset(at, -6).toISOString()).toBe("2026-11-04T20:00:00.000Z");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("formatters use the app time zone, not the runtime's", () => {
    const at = new Date("2026-11-10T21:30:00Z");
    expect(formatDate("en", at, { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("11/11/2026");
    expect(formatDateTime("en", at, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toContain("01:30");
  });
});
