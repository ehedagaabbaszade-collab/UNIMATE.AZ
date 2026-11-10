import { PLANS, type PlanId, type PlanLimits } from "@unimate/core";
import type { SubscriptionRow, UsageCounterRow } from "./db";

/** Same periods the pipeline uses (supabase/functions -> packages/pipeline/src/quota-periods.ts): UTC day / month. */
export const dayStart = (now: Date): string => now.toISOString().slice(0, 10);
export const monthStart = (now: Date): string => `${now.toISOString().slice(0, 7)}-01`;

const LIVE = new Set(["active", "trialing", "past_due"]);

/** subscriptions.plan is lowercase free/plus/pro; core PlanId is uppercase. No live row means FREE. */
export function planFromSubscription(sub: Pick<SubscriptionRow, "plan" | "status"> | null | undefined): PlanId {
  if (!sub || !LIVE.has(sub.status)) return "FREE";
  switch (sub.plan) {
    case "plus":
      return "PLUS";
    case "pro":
      return "PRO";
    default:
      return "FREE";
  }
}

export interface UsageSummary {
  plan: PlanId;
  limits: PlanLimits;
  aiMessagesToday: number;
  docsThisMonth: number;
}

export function summariseUsage(sub: SubscriptionRow | null, counters: UsageCounterRow[], now: Date): UsageSummary {
  const plan = planFromSubscription(sub);
  const day = dayStart(now);
  const month = monthStart(now);
  const n = (kind: UsageCounterRow["kind"], period: string) => counters.find((c) => c.kind === kind && c.period_start === period)?.n ?? 0;
  return { plan, limits: PLANS[plan], aiMessagesToday: n("ai_message", day), docsThisMonth: n("upload_doc", month) };
}
