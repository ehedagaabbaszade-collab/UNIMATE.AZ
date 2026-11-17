/** Student budget in AZN. Amounts are integer qəpik (1 AZN = 100 qəpik) so sums never drift. */
export const EXPENSE_CATEGORIES = ["food", "transport", "rent", "education", "phone", "fun", "health", "other"] as const;
export const INCOME_CATEGORIES = ["scholarship", "family", "job", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export type BudgetEntry =
  | { id: string; kind: "expense"; amount: number; category: ExpenseCategory; date: string; note?: string }
  | { id: string; kind: "income"; amount: number; category: IncomeCategory; date: string; note?: string };

/** "12,50" / "12.5" / "12" -> 1250. Null for anything that is not a positive amount with at most 2 decimals. */
export function parseAzn(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const q = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return q > 0 ? q : null;
}

/** Local calendar month key, e.g. "2026-11". */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** Local calendar date, e.g. "2026-11-14". */
export const dayKey = (d: Date) => `${monthKey(d)}-${String(d.getDate()).padStart(2, "0")}`;

export interface BudgetSummary {
  income: number;
  expense: number;
  balance: number;
  byCategory: Array<{ category: ExpenseCategory; amount: number; share: number }>;
  /** What can still be spent per day for the rest of the month (null when no plan and no income). */
  perDay: number | null;
  daysLeft: number;
}

/**
 * Month summary. The spending plan is `monthlyLimit` when set, otherwise the month's income.
 * perDay = (plan - spent) / days left including today, floored to whole qəpik, never negative.
 */
export function summarize(entries: readonly BudgetEntry[], today: Date, monthlyLimit: number | null = null): BudgetSummary {
  const key = monthKey(today);
  const month = entries.filter((e) => e.date.startsWith(key));
  const income = month.filter((e) => e.kind === "income").reduce((n, e) => n + e.amount, 0);
  const expense = month.filter((e) => e.kind === "expense").reduce((n, e) => n + e.amount, 0);
  const totals = new Map<ExpenseCategory, number>();
  for (const e of month) if (e.kind === "expense") totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
  const byCategory = [...totals.entries()]
    .map(([category, amount]) => ({ category, amount, share: expense ? amount / expense : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - today.getDate() + 1;
  const plan = monthlyLimit ?? (income > 0 ? income : null);
  const perDay = plan === null ? null : Math.max(0, Math.floor((plan - expense) / daysLeft));
  return { income, expense, balance: income - expense, byCategory, perDay, daysLeft };
}
