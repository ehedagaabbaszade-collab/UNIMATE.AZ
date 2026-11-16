"use client";

import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, dayKey, monthKey, parseAzn, summarize, type BudgetEntry } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Card, EmptyState, Input, Select } from "@unimate/ui";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { useUser } from "@/components/user";
import { newId, useLocalValue } from "@/lib/local-value";
import s from "./BudgetPage.module.css";

const base = { id: z.string(), amount: z.number().int().positive().max(1_000_000_000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(80).optional() };
const entrySchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("expense"), category: z.enum(EXPENSE_CATEGORIES) }),
  z.object({ ...base, kind: z.literal("income"), category: z.enum(INCOME_CATEGORIES) }),
]);
const storeSchema = z.object({ entries: z.array(entrySchema).max(5000), monthlyLimit: z.number().int().positive().nullable() });
type Store = z.infer<typeof storeSchema>;
const EMPTY: Store = { entries: [], monthlyLimit: null };

export function BudgetPage() {
  const { t, currency, date } = useI18n();
  const user = useUser();
  const store = useLocalValue(`um.budget.${user.id}`, storeSchema, EMPTY);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState<string>("food");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [limitText, setLimitText] = useState("");

  const today = new Date();
  const thisMonth = monthKey(today);
  const summary = summarize(store.value.entries, today, store.value.monthlyLimit); // cheap; recomputed each render so it never goes stale after midnight
  const month = useMemo(() => store.value.entries.filter((e) => e.date.startsWith(thisMonth)).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [store.value.entries, thisMonth]);
  const azn = (q: number) => {
    const digits = q % 100 === 0 ? 0 : 2;
    return currency(q / 100, "AZN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const cats = kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  useEffect(() => setLimitText(store.value.monthlyLimit ? String(store.value.monthlyLimit / 100) : ""), [store.value.monthlyLimit]);

  function add() {
    const q = parseAzn(amount);
    if (q === null) return setError(t("budget.amountInvalid"));
    const entry = { id: newId(), kind, amount: q, category, date: dayKey(new Date()), ...(note.trim() ? { note: note.trim().slice(0, 80) } : {}) } as BudgetEntry;
    if (!store.update((st) => ({ ...st, entries: [...st.entries, entry].slice(-5000) }))) return setError(t("common.genericError"));
    setError(null);
    setAmount("");
    setNote("");
  }

  if (!store.ready) return null;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("budget.title")}</h1>
      </div>

      <div className={s.hero}>
        <small>{date(today, { month: "long", year: "numeric" })}</small>
        <div>
          <small>{t("budget.balance")}</small>
          <div className={s.balance}>{azn(summary.balance)}</div>
        </div>
        <div className={s.split}>
          <div>
            <small>{t("budget.income")}</small>
            <div className={s.amount}>{azn(summary.income)}</div>
          </div>
          <div>
            <small>{t("budget.expense")}</small>
            <div className={s.amount}>{azn(summary.expense)}</div>
          </div>
        </div>
        <div className={s.perDay}>{summary.perDay === null ? t("budget.perDayNone") : t("budget.perDay", { amount: azn(summary.perDay), n: summary.daysLeft })}</div>
      </div>

      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <h2>{t("budget.addTitle")}</h2>
          <Select
            label={t("budget.kind")}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as "expense" | "income";
              setKind(k);
              setCategory(k === "expense" ? "food" : "scholarship");
            }}
          >
            <option value="expense">{t("budget.expense")}</option>
            <option value="income">{t("budget.income")}</option>
          </Select>
          <Input label={t("budget.amount")} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" maxLength={10} placeholder="0,00" error={error ?? undefined} />
          <Select label={t("budget.category")} value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c} value={c}>{t(`budget.cat.${c}`)}</option>
            ))}
          </Select>
          <Input label={t("budget.note")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
          <div>
            <Button type="submit">{kind === "expense" ? t("budget.addExpense") : t("budget.addIncome")}</Button>
          </div>
        </form>
      </Card>

      {summary.byCategory.length > 0 ? (
        <Card>
          <div className="stack">
            <h2>{t("budget.byCategory")}</h2>
            {summary.byCategory.map((c) => (
              <div key={c.category} className="stack">
                <div className="row row--between">
                  <span>{t(`budget.cat.${c.category}`)}</span>
                  <span>{azn(c.amount)}</span>
                </div>
                <div className={s.bar} aria-hidden="true">
                  <div className={s.fill} style={{ transform: `scaleX(${c.share})` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="stack">
        <h2>{t("budget.thisMonth")}</h2>
        {month.length === 0 ? (
          <EmptyState title={t("budget.emptyTitle")} description={t("budget.emptyBody")} />
        ) : (
          month.slice(0, 50).map((e) => (
            <div key={e.id} className="list-item">
              <div className="list-item__main">
                <span className="list-item__title">{e.note ?? t(`budget.cat.${e.category}`)}</span>
                <span className="list-item__meta">
                  {e.note ? `${t(`budget.cat.${e.category}`)}, ` : ""}
                  {date(new Date(`${e.date}T12:00:00`), { day: "numeric", month: "short" })}
                </span>
              </div>
              <span className={e.kind === "income" ? s.income : s.amount}>
                {e.kind === "income" ? "+" : "−"}
                {azn(e.amount)}
              </span>
              <Button variant="ghost" size="sm" aria-label={t("budget.removeA11y", { amount: azn(e.amount) })} onClick={() => store.update((st) => ({ ...st, entries: st.entries.filter((x) => x.id !== e.id) }))}>
                {t("budget.remove")}
              </Button>
            </div>
          ))
        )}
      </div>

      <Card>
        <div className="stack">
          <h2>{t("budget.limitTitle")}</h2>
          <p className="um-hint">{t("budget.limitBody")}</p>
          <Input label={t("budget.limit")} value={limitText} onChange={(e) => setLimitText(e.target.value)} inputMode="decimal" maxLength={10} />
          <div className="row">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const q = parseAzn(limitText);
                if (q !== null) store.update((st) => ({ ...st, monthlyLimit: q }));
              }}
            >
              {t("common.save")}
            </Button>
            {store.value.monthlyLimit ? (
              <Button variant="ghost" size="sm" onClick={() => store.update((st) => ({ ...st, monthlyLimit: null }))}>
                {t("budget.clearLimit")}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <p className="um-hint">{t("budget.privacy")}</p>
    </div>
  );
}
