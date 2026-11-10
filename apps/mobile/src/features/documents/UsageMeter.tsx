import type { Feature } from "@unimate/core";
import { formatList } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { View } from "react-native";
import { AppText, Badge, Card, ErrorState, Skeleton } from "../../components/ui";
import type { SubscriptionRow, UsageCounterRow } from "../../lib/db";
import { dayStart, monthStart, summariseUsage } from "../../lib/usage";
import { unwrap, useAsync } from "../../lib/use-async";
import { useTheme } from "../../theme/ThemeProvider";
import { radii } from "../../theme/tokens";
import { useUser } from "../../state/session";

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const { theme } = useTheme();
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={{ flex: 1, gap: 6 }} accessible accessibilityRole="progressbar" accessibilityLabel={`${label}: ${value}/${max}`} accessibilityValue={{ min: 0, max, now: Math.min(value, max) }}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <View style={{ height: 8, borderRadius: radii.pill, backgroundColor: theme.cardStrong, overflow: "hidden" }}>
        <View style={{ width: `${pct * 100}%`, height: 8, backgroundColor: pct >= 1 ? theme.danger : theme.primary }} />
      </View>
      <AppText variant="label">
        {value}/{max}
      </AppText>
    </View>
  );
}

/** Read-only usage and plan (subscriptions + usage_counters). No billing UI. */
export function UsageMeter() {
  const { t, locale } = useI18n();
  const { supabase: sb } = useUser();
  const usage = useAsync(async () => {
    const now = new Date();
    // Effective plan from the server (my_plan(): honours expiry and manual grants), the same value the AI limits use.
    const [plan, counters] = await Promise.all([sb.rpc("my_plan"), sb.from("usage_counters").select("kind,period_start,n").in("period_start", [dayStart(now), monthStart(now)])]);
    if (plan.error) throw new Error(plan.error.message);
    const sub: SubscriptionRow = { plan: String(plan.data ?? "free") as SubscriptionRow["plan"], status: "active", current_period_end: null };
    return summariseUsage(sub, unwrap(counters) as UsageCounterRow[], now);
  }, []);

  if (usage.loading) return <Skeleton height={110} />;
  if (usage.error || !usage.data) return <ErrorState title={t("usage.unavailable")} />;
  const u = usage.data;
  const features = formatList(locale, u.limits.features.map((f: Feature) => t(`usage.feature.${f}`)));
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <AppText variant="heading">{t("usage.title")}</AppText>
        <Badge tone="primary">{t(`usage.plan.${u.plan}`)}</Badge>
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        <Meter label={t("usage.messages")} value={u.aiMessagesToday} max={u.limits.aiMessagesPerDay} />
        <Meter label={t("usage.docs")} value={u.docsThisMonth} max={u.limits.docsPerMonth} />
      </View>
      <AppText variant="caption" muted>
        {t("usage.maxPages", { n: u.limits.maxPages })} · {t("usage.features", { list: features })}
      </AppText>
      <AppText variant="caption" muted>
        {t("usage.periodNote")}
      </AppText>
    </Card>
  );
}
