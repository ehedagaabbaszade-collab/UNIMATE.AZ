import { describe, expect, it } from "vitest";
import { dayKey, parseAzn, summarize, type BudgetEntry } from "./budget";

describe("parseAzn", () => {
  it("accepts comma or dot decimals and returns qəpik", () => {
    expect(parseAzn("12,50")).toBe(1250);
    expect(parseAzn("12.5")).toBe(1250);
    expect(parseAzn(" 1 200 ")).toBe(120000);
    expect(parseAzn("0,05")).toBe(5);
  });
  it("rejects zero, negatives, junk and 3 decimals", () => {
    for (const bad of ["0", "-3", "abc", "1.234", "", "1,2,3"]) expect(parseAzn(bad)).toBeNull();
  });
});

describe("summarize", () => {
  const today = new Date(2026, 10, 21); // 21 Nov: 10 days left incl. today
  const e = (id: string, kind: "income" | "expense", amount: number, category: string, date: string) => ({ id, kind, amount, category, date }) as BudgetEntry;
  const entries = [
    e("1", "income", 15000, "scholarship", "2026-11-01"),
    e("2", "expense", 3000, "food", "2026-11-03"),
    e("3", "expense", 1000, "transport", "2026-11-05"),
    e("4", "expense", 2000, "food", "2026-11-20"),
    e("5", "expense", 9999, "fun", "2026-10-30"), // other month
  ];

  it("totals the current month only and ranks categories", () => {
    const s = summarize(entries, today);
    expect(s).toMatchObject({ income: 15000, expense: 6000, balance: 9000, daysLeft: 10, perDay: 900 });
    expect(s.byCategory.map((c) => c.category)).toEqual(["food", "transport"]);
    expect(s.byCategory[0]!.share).toBeCloseTo(5 / 6);
  });
  it("uses the monthly limit when set and never goes negative", () => {
    expect(summarize(entries, today, 5000).perDay).toBe(0);
    expect(summarize([], today).perDay).toBeNull();
  });
  it("formats local day keys", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
