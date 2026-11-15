import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, dayKey, monthKey, parseAzn, summarize, type BudgetEntry } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { z } from "zod";
import { AppText, Button, Card, EmptyState, ExpandCard, Input, Reveal, Segmented, SkeletonCard } from "../../components/ui";
import { newId, useLocalValue } from "../../lib/local-store";
import { haptic, useReducedMotion } from "../../lib/motion";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";

const base = { id: z.string(), amount: z.number().int().positive().max(1_000_000_000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(80).optional() };
const entrySchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("expense"), category: z.enum(EXPENSE_CATEGORIES) }),
  z.object({ ...base, kind: z.literal("income"), category: z.enum(INCOME_CATEGORIES) }),
]);
const storeSchema = z.object({ entries: z.array(entrySchema).max(5000), monthlyLimit: z.number().int().positive().nullable() });
type Store = z.infer<typeof storeSchema>;
const EMPTY: Store = { entries: [], monthlyLimit: null };

function ShareBar({ share, color }: { share: number; color: string }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const anim = useRef(new Animated.Value(reduced ? share : 0)).current;
  useEffect(() => {
    if (reduced) anim.setValue(share);
    else Animated.timing(anim, { toValue: share, duration: 520, useNativeDriver: true }).start();
  }, [share, reduced, anim]);
  return (
    <View style={{ height: 6, borderRadius: radii.pill, backgroundColor: theme.cardStrong, overflow: "hidden" }}>
      <Animated.View style={{ height: 6, width: "100%", borderRadius: radii.pill, backgroundColor: color, transformOrigin: "left", transform: [{ scaleX: anim }] }} />
    </View>
  );
}

export function BudgetScreen() {
  const { t, currency, date } = useI18n();
  const { theme } = useTheme();
  const { user } = useUser();
  const store = useLocalValue(`um.budget.${user.id}`, storeSchema, EMPTY);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [category, setCategory] = useState<string>("food");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [limitText, setLimitText] = useState("");

  const today = new Date();
  const summary = useMemo(() => summarize(store.value.entries, today, store.value.monthlyLimit), [store.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const month = useMemo(() => store.value.entries.filter((e) => e.date.startsWith(monthKey(today))).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [store.value.entries]); // eslint-disable-line react-hooks/exhaustive-deps
  // Both bounds explicit: Hermes throws when maximumFractionDigits is below the currency default minimum (2).
  const azn = (q: number) => {
    const digits = q % 100 === 0 ? 0 : 2;
    return currency(q / 100, "AZN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  const cats = kind === "expense" ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const barColors = [theme.primary, "#7C3AED", "#3B82F6", "#06B6DA", theme.success, theme.warning, theme.danger, theme.textMuted];

  useEffect(() => setLimitText(store.value.monthlyLimit ? String(store.value.monthlyLimit / 100) : ""), [store.value.monthlyLimit]);

  function add() {
    const q = parseAzn(amount);
    if (q === null) {
      haptic.error();
      return setError(t("budget.amountInvalid"));
    }
    const entry = { id: newId(), kind, amount: q, category, date: dayKey(new Date()), ...(note.trim() ? { note: note.trim().slice(0, 80) } : {}) } as BudgetEntry;
    if (!store.update((s) => ({ ...s, entries: [...s.entries, entry].slice(-5000) }))) {
      haptic.error();
      return setError(t("common.genericError"));
    }
    setError(null);
    haptic.success();
    setAmount("");
    setNote("");
  }

  if (!store.ready) return <SkeletonCard lines={3} />;

  return (
    <View style={{ gap: spacing.lg }}>
      <Reveal>
        <LinearGradient colors={[...theme.gradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radii.xl, padding: spacing.lg, gap: spacing.sm }}>
          <AppText variant="caption" style={{ color: "#EEF0FF", fontWeight: "600" }}>
            {date(today, { month: "long", year: "numeric" })}
          </AppText>
          <View accessible accessibilityLabel={`${t("budget.balance")}: ${azn(summary.balance)}`}>
            <AppText variant="caption" style={{ color: "#EEF0FF" }}>
              {t("budget.balance")}
            </AppText>
            <AppText variant="display" style={{ color: "#FFFFFF", fontSize: 36 }}>
              {azn(summary.balance)}
            </AppText>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.lg }}>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" style={{ color: "#EEF0FF" }}>
                {t("budget.income")}
              </AppText>
              <AppText variant="heading" style={{ color: "#FFFFFF" }}>
                {azn(summary.income)}
              </AppText>
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="caption" style={{ color: "#EEF0FF" }}>
                {t("budget.expense")}
              </AppText>
              <AppText variant="heading" style={{ color: "#FFFFFF" }}>
                {azn(summary.expense)}
              </AppText>
            </View>
          </View>
          <View style={{ marginTop: spacing.xs, padding: spacing.md, borderRadius: radii.lg, backgroundColor: "rgba(255,255,255,0.14)" }}>
            <AppText style={{ color: "#FFFFFF", fontWeight: "600" }}>
              {summary.perDay === null ? t("budget.perDayNone") : t("budget.perDay", { amount: azn(summary.perDay), n: summary.daysLeft })}
            </AppText>
          </View>
        </LinearGradient>
      </Reveal>

      <Card>
        <AppText variant="heading">{t("budget.addTitle")}</AppText>
        <Segmented
          label={t("budget.kind")}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategory(k === "expense" ? "food" : "scholarship");
          }}
          options={[
            { value: "expense", label: t("budget.expense") },
            { value: "income", label: t("budget.income") },
          ]}
        />
        <Input label={t("budget.amount")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" maxLength={10} placeholder="0,00" error={error ?? undefined} />
        <Segmented label={t("budget.category")} value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: t(`budget.cat.${c}`) }))} />
        <Input label={t("budget.note")} value={note} onChangeText={setNote} maxLength={80} />
        <Button title={kind === "expense" ? t("budget.addExpense") : t("budget.addIncome")} onPress={add} />
      </Card>

      {summary.byCategory.length > 0 ? (
        <Card>
          <AppText variant="heading">{t("budget.byCategory")}</AppText>
          {summary.byCategory.map((c, i) => (
            <View key={c.category} style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <AppText variant="label">{t(`budget.cat.${c.category}`)}</AppText>
                <AppText variant="label">{azn(c.amount)}</AppText>
              </View>
              <ShareBar share={c.share} color={barColors[i % barColors.length]!} />
            </View>
          ))}
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <AppText variant="heading">{t("budget.thisMonth")}</AppText>
        {month.length === 0 ? (
          <EmptyState title={t("budget.emptyTitle")} description={t("budget.emptyBody")} />
        ) : (
          month.slice(0, 50).map((e) => (
            <Card key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }}>
              <View style={{ flex: 1 }}>
                <AppText variant="label">{e.note ?? t(`budget.cat.${e.category}`)}</AppText>
                <AppText variant="caption" muted>
                  {e.note ? `${t(`budget.cat.${e.category}`)}, ` : ""}
                  {date(new Date(`${e.date}T12:00:00`), { day: "numeric", month: "short" })}
                </AppText>
              </View>
              <AppText variant="heading" style={{ color: e.kind === "income" ? theme.success : theme.text }}>
                {e.kind === "income" ? "+" : "−"}
                {azn(e.amount)}
              </AppText>
              <Button
                small
                variant="ghost"
                title={t("budget.remove")}
                accessibilityLabel={t("budget.removeA11y", { amount: azn(e.amount) })}
                onPress={() => store.update((s) => ({ ...s, entries: s.entries.filter((x) => x.id !== e.id) }))}
              />
            </Card>
          ))
        )}
      </View>

      <ExpandCard label={t("budget.limitTitle")} header={<AppText variant="heading">{t("budget.limitTitle")}</AppText>}>
        <AppText variant="caption" muted>
          {t("budget.limitBody")}
        </AppText>
        <Input label={t("budget.limit")} value={limitText} onChangeText={setLimitText} keyboardType="decimal-pad" maxLength={10} />
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Button
            small
            variant="secondary"
            title={t("common.save")}
            onPress={() => {
              const q = parseAzn(limitText);
              if (q === null) return haptic.error();
              haptic.success();
              store.update((s) => ({ ...s, monthlyLimit: q }));
            }}
          />
          {store.value.monthlyLimit ? <Button small variant="ghost" title={t("budget.clearLimit")} onPress={() => store.update((s) => ({ ...s, monthlyLimit: null }))} /> : null}
        </View>
      </ExpandCard>

      <AppText variant="caption" muted>
        {t("budget.privacy")}
      </AppText>
    </View>
  );
}
