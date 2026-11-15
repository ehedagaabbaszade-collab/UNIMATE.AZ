import { PLANS, type PlanId } from "@unimate/core";

const TIER: Record<PlanId, number> = { FREE: 0, PLUS: 1, PRO: 2, GROUP: 3 };

export type PlanRelation = "current" | "upgrade" | "downgrade";

/** How `target` relates to the plan the student is on now. */
export function planRelation(current: PlanId, target: PlanId): PlanRelation {
  const d = TIER[target] - TIER[current];
  return d === 0 ? "current" : d > 0 ? "upgrade" : "downgrade";
}

export interface Loss {
  kind: "ai" | "docs" | "pages" | "feat";
  from?: number;
  to?: number;
  feature?: string;
}

/** What the student gives up moving from `from` to the lower `to`, from the real entitlements. */
export function planLosses(from: PlanId, to: PlanId): Loss[] {
  const a = PLANS[from];
  const b = PLANS[to];
  const out: Loss[] = [];
  if (a.aiMessagesPerDay > b.aiMessagesPerDay) out.push({ kind: "ai", from: a.aiMessagesPerDay, to: b.aiMessagesPerDay });
  if (a.docsPerMonth > b.docsPerMonth) out.push({ kind: "docs", from: a.docsPerMonth, to: b.docsPerMonth });
  if (a.maxPages > b.maxPages) out.push({ kind: "pages", from: a.maxPages, to: b.maxPages });
  for (const f of a.features) if (!b.features.includes(f)) out.push({ kind: "feat", feature: f });
  return out;
}
