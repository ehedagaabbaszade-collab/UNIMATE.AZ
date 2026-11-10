import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatRelativeTime, formatTime } from "./index";

// Intl output uses NBSP / NNBSP in places; compare with plain spaces. The time zone is pinned: tests must not depend on the machine.
const sp = (s: string) => s.replace(/[  ]/g, " ");
const d = new Date("2026-03-05T14:30:00Z");
const tz = { timeZone: "Asia/Baku" } as const;

describe("dates and times", () => {
  it("medium date per locale", () => {
    expect(sp(formatDate("az", d, { dateStyle: "medium", ...tz }))).toBe("5 mar 2026");
    expect(sp(formatDate("tr", d, { dateStyle: "medium", ...tz }))).toBe("5 Mar 2026");
    expect(sp(formatDate("en", d, { dateStyle: "medium", ...tz }))).toBe("5 Mar 2026");
    expect(sp(formatDate("ru", d, { dateStyle: "medium", ...tz }))).toBe("5 мар. 2026 г.");
  });
  it("long date uses full month names", () => {
    expect(sp(formatDate("az", d, { dateStyle: "long", ...tz }))).toBe("5 mart 2026");
    expect(sp(formatDate("tr", d, { dateStyle: "long", ...tz }))).toBe("5 Mart 2026");
    expect(sp(formatDate("en", d, { dateStyle: "long", ...tz }))).toBe("5 March 2026");
    expect(sp(formatDate("ru", d, { dateStyle: "long", ...tz }))).toBe("5 марта 2026 г.");
  });
  it("24-hour time and date-time", () => {
    for (const l of ["az", "tr", "en", "ru"] as const) expect(formatTime(l, d, { timeStyle: "short", ...tz })).toBe("18:30");
    expect(sp(formatDateTime("en", d, { dateStyle: "medium", timeStyle: "short", ...tz }))).toContain("18:30");
  });
  it("accepts ISO strings and timestamps", () => {
    expect(formatDate("en", "2026-03-05T14:30:00Z", { dateStyle: "short", ...tz })).toBe(formatDate("en", d.getTime(), { dateStyle: "short", ...tz }));
  });
});

describe("relative time (now is injected)", () => {
  const now = new Date("2026-03-05T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const day = 86_400_000;
  it("per locale", () => {
    expect(formatRelativeTime("en", ago(3 * day), now)).toBe("3 days ago");
    expect(formatRelativeTime("az", ago(3 * day), now)).toBe("3 gün öncə");
    expect(formatRelativeTime("tr", ago(3 * day), now)).toBe("3 gün önce");
    expect(formatRelativeTime("ru", ago(3 * day), now)).toBe("3 дня назад");
    expect(formatRelativeTime("ru", ago(5 * day), now)).toBe("5 дней назад");
    expect(formatRelativeTime("en", new Date(now.getTime() + day), now)).toBe("tomorrow");
    expect(formatRelativeTime("ru", new Date(now.getTime() + day), now)).toBe("завтра");
  });
  it("picks the unit", () => {
    expect(formatRelativeTime("en", ago(30_000), now)).toBe("30 seconds ago");
    expect(formatRelativeTime("en", ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(formatRelativeTime("en", ago(2 * 3_600_000), now)).toBe("2 hours ago");
    expect(formatRelativeTime("en", ago(400 * day), now)).toBe("last year");
  });
});

describe("numbers, percent and AZN", () => {
  it("number separators", () => {
    expect(sp(formatNumber("az", 1234567.891))).toBe("1.234.567,891");
    expect(sp(formatNumber("tr", 1234567.891))).toBe("1.234.567,891");
    expect(sp(formatNumber("en", 1234567.891))).toBe("1,234,567.891");
    expect(sp(formatNumber("ru", 1234567.891))).toBe("1 234 567,891");
  });
  it("percent takes a fraction", () => {
    expect(sp(formatPercent("en", 0.256))).toBe("25.6%");
    expect(sp(formatPercent("az", 0.256))).toBe("25,6%");
    expect(sp(formatPercent("tr", 0.256))).toBe("%25,6");
    expect(sp(formatPercent("ru", 0.256))).toBe("25,6 %");
  });
  it("AZN is the default currency; az shows the manat sign", () => {
    expect(sp(formatCurrency("az", 1234.5))).toBe("1.234,50 ₼");
    expect(sp(formatCurrency("en", 1234.5))).toBe("AZN 1,234.50");
    expect(sp(formatCurrency("tr", 1234.5))).toBe("AZN 1.234,50");
    expect(sp(formatCurrency("ru", 1234.5))).toBe("1 234,50 AZN");
    expect(sp(formatCurrency("en", 5, "USD"))).toContain("$5.00");
  });
});
