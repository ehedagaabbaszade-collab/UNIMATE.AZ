"use client";

import { Badge, Card, ErrorState, ProgressRing, Skeleton } from "@unimate/ui";
import type { Feature } from "@unimate/core";
import { formatList } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { SubscriptionRow, UsageCounterRow } from "@/lib/db";
import { dayStart, monthStart, summariseUsage } from "@/lib/usage";
import { unwrap, useAsync } from "@/lib/use-async";

export function UsageMeter() {
  const { t, locale } = useI18n();
  const usage = useAsync(async () => {
    const sb = getBrowserClient();
    const now = new Date();
    const [sub, counters] = await Promise.all([
      sb.from("subscriptions").select("plan,status,current_period_end").in("status", ["active", "trialing", "past_due"]).limit(1).maybeSingle(),
      sb.from("usage_counters").select("kind,period_start,n").in("period_start", [dayStart(now), monthStart(now)]),
    ]);
    if (sub.error) throw new Error(sub.error.message);
    return summariseUsage((sub.data as SubscriptionRow | null) ?? null, unwrap(counters) as UsageCounterRow[], now);
  }, []);

  if (usage.loading) return <Skeleton height={120} />;
  if (usage.error || !usage.data) return <ErrorState title={t("usage.unavailable")} />;
  const u = usage.data;
  const features = formatList(locale, u.limits.features.map((f: Feature) => t(`usage.feature.${f}`)));
  return (
    <Card>
      <div className="row row--between">
        <h2>{t("usage.title")}</h2>
        <Badge tone="primary">{t(`usage.plan.${u.plan}`)}</Badge>
      </div>
      <div className="row" style={{ marginTop: "var(--space-4)", gap: "var(--space-6)" }}>
        <div className="row">
          <ProgressRing value={u.aiMessagesToday} max={u.limits.aiMessagesPerDay} label={`${t("usage.messages")}: ${u.aiMessagesToday}/${u.limits.aiMessagesPerDay}`} size={84}>
            <span style={{ fontSize: "var(--text-sm)" }}>
              {u.aiMessagesToday}/{u.limits.aiMessagesPerDay}
            </span>
          </ProgressRing>
          <span className="um-muted">{t("usage.messages")}</span>
        </div>
        <div className="row">
          <ProgressRing value={u.docsThisMonth} max={u.limits.docsPerMonth} label={`${t("usage.docs")}: ${u.docsThisMonth}/${u.limits.docsPerMonth}`} size={84}>
            <span style={{ fontSize: "var(--text-sm)" }}>
              {u.docsThisMonth}/{u.limits.docsPerMonth}
            </span>
          </ProgressRing>
          <span className="um-muted">{t("usage.docs")}</span>
        </div>
      </div>
      <p className="um-muted" style={{ marginTop: "var(--space-3)", fontSize: "var(--text-sm)" }}>
        {t("usage.maxPages", { n: u.limits.maxPages })} · {t("usage.features", { list: features })}
      </p>
      <p className="um-hint" style={{ marginTop: "var(--space-1)" }}>
        {t("usage.periodNote")}
      </p>
    </Card>
  );
}
