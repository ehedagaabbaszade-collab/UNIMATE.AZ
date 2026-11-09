export type PlanId = "FREE" | "PLUS" | "PRO" | "GROUP";
export type Feature = "ocr" | "flashcards" | "quiz" | "export" | "group_sharing" | "priority_models";

/** Monthly prices in AZN. GROUP pricing is unspecified (negotiated). */
export const PLUS_PRICE_AZN = 4.99;
export const PRO_PRICE_AZN = 9.99;
export const PRICE_AZN = { FREE: 0, PLUS: PLUS_PRICE_AZN, PRO: PRO_PRICE_AZN } as const;

export interface PlanLimits {
  aiMessagesPerDay: number;
  docsPerMonth: number;
  maxPages: number;
  features: readonly Feature[];
}

/** Limit values are assumptions; tune freely. */
export const PLANS: Record<PlanId, PlanLimits> = {
  FREE: { aiMessagesPerDay: 10, docsPerMonth: 3, maxPages: 30, features: ["flashcards"] },
  PLUS: { aiMessagesPerDay: 60, docsPerMonth: 20, maxPages: 150, features: ["flashcards", "quiz", "ocr"] },
  PRO: { aiMessagesPerDay: 200, docsPerMonth: 80, maxPages: 500, features: ["flashcards", "quiz", "ocr", "export", "priority_models"] },
  GROUP: { aiMessagesPerDay: 120, docsPerMonth: 50, maxPages: 300, features: ["flashcards", "quiz", "ocr", "export", "group_sharing"] },
};

export interface PlanUsage {
  aiMessagesToday: number;
  docsThisMonth: number;
}
export type QuotaAction =
  | { type: "ai_message" }
  | { type: "upload_doc"; pages: number }
  | { type: "use_feature"; feature: Feature };

export type QuotaDenyReason =
  | "ai_messages_exceeded"
  | "docs_exceeded"
  | "pages_exceeded"
  | "feature_not_in_plan"
  | "invalid_input";
export type QuotaResult =
  | { allowed: true }
  | { allowed: false; reason: QuotaDenyReason; message: string; limit?: number };

export function checkQuota(plan: PlanId, usage: PlanUsage, action: QuotaAction): QuotaResult {
  if (typeof plan !== "string" || !Object.hasOwn(PLANS, plan))
    return { allowed: false, reason: "invalid_input", message: "Unknown plan" };
  const lim = PLANS[plan];
  const validCount = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!usage || !validCount(usage.aiMessagesToday) || !validCount(usage.docsThisMonth))
    return { allowed: false, reason: "invalid_input", message: "Invalid usage counters" };
  switch (action.type) {
    case "ai_message":
      return usage.aiMessagesToday < lim.aiMessagesPerDay
        ? { allowed: true }
        : { allowed: false, reason: "ai_messages_exceeded", message: "Daily AI message limit reached", limit: lim.aiMessagesPerDay };
    case "upload_doc":
      if (typeof action.pages !== "number" || !Number.isSafeInteger(action.pages) || action.pages < 1)
        return { allowed: false, reason: "invalid_input", message: "Invalid page count" };
      if (action.pages > lim.maxPages)
        return { allowed: false, reason: "pages_exceeded", message: "Document has too many pages for this plan", limit: lim.maxPages };
      return usage.docsThisMonth < lim.docsPerMonth
        ? { allowed: true }
        : { allowed: false, reason: "docs_exceeded", message: "Monthly document limit reached", limit: lim.docsPerMonth };
    case "use_feature":
      return lim.features.includes(action.feature)
        ? { allowed: true }
        : { allowed: false, reason: "feature_not_in_plan", message: `Feature "${action.feature}" is not included in ${plan}` };
    default:
      return { allowed: false, reason: "invalid_input", message: "Unknown action" };
  }
}
