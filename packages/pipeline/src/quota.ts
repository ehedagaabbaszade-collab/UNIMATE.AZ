import { PLANS, checkQuota, type PlanId, type QuotaAction, type QuotaDenyReason } from "@unimate/core";
import { PipelineError } from "./errors";
import { dayStart, monthStart } from "./quota-periods";
import type { Repository, UsageKind } from "./repository";

export class QuotaExceededError extends PipelineError {
  readonly reason: QuotaDenyReason;
  readonly limit: number | undefined;
  constructor(reason: QuotaDenyReason, message: string, limit?: number) {
    super("quota_exceeded", message, false);
    this.name = "QuotaExceededError";
    this.reason = reason;
    this.limit = limit;
  }
}

/** A successfully consumed unit that can be given back if the work it paid for fails. release() is idempotent. */
export interface Reservation {
  release(): Promise<void>;
}
const NOOP: Reservation = { release: async () => {} };

/**
 * checkQuota (core) decides static rules (plan, pages, features) and produces the denial message;
 * the database decides the counts atomically. Two parallel callers at limit-1 can never both pass.
 */
export async function consumeQuota(repo: Repository, userId: string, plan: PlanId, action: QuotaAction, now: Date): Promise<Reservation> {
  const deny = (r: Extract<ReturnType<typeof checkQuota>, { allowed: false }>) => {
    throw new QuotaExceededError(r.reason, r.message, r.limit);
  };

  // Static checks with zeroed counters: only plan/pages/feature rules can fail here.
  const staticCheck = checkQuota(plan, { aiMessagesToday: 0, docsThisMonth: 0 }, action);
  if (!staticCheck.allowed) return deny(staticCheck);

  let kind: UsageKind;
  let period: string;
  let limit: number;
  if (action.type === "ai_message") {
    kind = "ai_message";
    period = dayStart(now);
    limit = PLANS[plan].aiMessagesPerDay;
  } else if (action.type === "upload_doc") {
    kind = "upload_doc";
    period = monthStart(now);
    limit = PLANS[plan].docsPerMonth;
  } else return NOOP; // use_feature has no counter

  const n = await repo.bumpUsage(userId, kind, period, limit);
  if (n === null) {
    // Atomic denial. Re-derive the precise reason/message from the real counters.
    const usage = await repo.getUsage(userId, now);
    const r = checkQuota(plan, usage, action);
    if (!r.allowed) return deny(r);
    // Counters moved (e.g. released) between the two statements: report a generic denial.
    throw new QuotaExceededError(kind === "ai_message" ? "ai_messages_exceeded" : "docs_exceeded", "Quota exceeded", limit);
  }
  let released = false;
  return {
    release: async () => {
      if (released) return; // set before awaiting: concurrent/repeated calls give back at most one unit
      released = true;
      await repo.releaseUsage(userId, kind, period);
    },
  };
}
