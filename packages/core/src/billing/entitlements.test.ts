import { describe, expect, it } from "vitest";
import { PLANS, PLUS_PRICE_AZN, PRO_PRICE_AZN, checkQuota } from "./entitlements";

const zero = { aiMessagesToday: 0, docsThisMonth: 0 };

describe("entitlements", () => {
  it("price constants", () => {
    expect(PLUS_PRICE_AZN).toBe(4.99);
    expect(PRO_PRICE_AZN).toBe(9.99);
  });
  it("limits grow with plan tier", () => {
    expect(PLANS.PLUS.aiMessagesPerDay).toBeGreaterThan(PLANS.FREE.aiMessagesPerDay);
    expect(PLANS.PRO.maxPages).toBeGreaterThan(PLANS.PLUS.maxPages);
  });
  it("ai messages: allow below limit, deny at limit", () => {
    const lim = PLANS.FREE.aiMessagesPerDay;
    expect(checkQuota("FREE", { ...zero, aiMessagesToday: lim - 1 }, { type: "ai_message" })).toEqual({ allowed: true });
    const r = checkQuota("FREE", { ...zero, aiMessagesToday: lim }, { type: "ai_message" });
    expect(r).toMatchObject({ allowed: false, reason: "ai_messages_exceeded", limit: lim });
  });
  it("uploads: pages and docs limits", () => {
    expect(checkQuota("FREE", zero, { type: "upload_doc", pages: PLANS.FREE.maxPages })).toEqual({ allowed: true });
    expect(checkQuota("FREE", zero, { type: "upload_doc", pages: PLANS.FREE.maxPages + 1 })).toMatchObject({
      allowed: false,
      reason: "pages_exceeded",
    });
    expect(
      checkQuota("FREE", { ...zero, docsThisMonth: PLANS.FREE.docsPerMonth }, { type: "upload_doc", pages: 1 }),
    ).toMatchObject({ allowed: false, reason: "docs_exceeded" });
  });
  it("invalid page counts denied", () => {
    expect(checkQuota("PRO", zero, { type: "upload_doc", pages: -1 })).toMatchObject({ reason: "invalid_input" });
    expect(checkQuota("PRO", zero, { type: "upload_doc", pages: NaN })).toMatchObject({ reason: "invalid_input" });
  });
  it("features", () => {
    expect(checkQuota("FREE", zero, { type: "use_feature", feature: "export" })).toMatchObject({
      allowed: false,
      reason: "feature_not_in_plan",
    });
    expect(checkQuota("PRO", zero, { type: "use_feature", feature: "export" })).toEqual({ allowed: true });
    expect(checkQuota("GROUP", zero, { type: "use_feature", feature: "group_sharing" })).toEqual({ allowed: true });
  });
});
