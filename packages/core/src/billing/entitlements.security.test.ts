import { describe, expect, it } from "vitest";
import { checkQuota, type PlanId, type PlanUsage, type QuotaAction } from "./entitlements";

// Module under test: checkQuota in billing/entitlements.ts (existing tests: entitlements.test.ts).
// Instruction: "return invalid_input unless counters are finite non-negative safe integers; default case
// for unknown action.type; Object.hasOwn for plan lookup; pages must be integer >=1."
const zero = { aiMessagesToday: 0, docsThisMonth: 0 };
const ai: QuotaAction = { type: "ai_message" };
const invalid = { allowed: false, reason: "invalid_input" };

describe("entitlements security regressions", () => {
  it("rejects non-integer, negative, null and string counters", () => {
    for (const bad of [null, "0", -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      expect(checkQuota("FREE", { ...zero, aiMessagesToday: bad } as unknown as PlanUsage, ai)).toMatchObject(invalid);
      expect(checkQuota("FREE", { ...zero, docsThisMonth: bad } as unknown as PlanUsage, ai)).toMatchObject(invalid);
    }
    expect(checkQuota("FREE", null as unknown as PlanUsage, ai)).toMatchObject(invalid);
  });
  it("rejects unknown action types", () => {
    expect(checkQuota("FREE", zero, { type: "bogus" } as unknown as QuotaAction)).toMatchObject(invalid);
  });
  it("plan lookup ignores inherited properties", () => {
    for (const p of ["constructor", "__proto__", "toString"]) {
      expect(checkQuota(p as PlanId, zero, ai)).toMatchObject(invalid);
    }
  });
  it("pages must be integer >= 1", () => {
    for (const pages of [0, 1.5, -1, Infinity, "3" as unknown as number]) {
      expect(checkQuota("PRO", zero, { type: "upload_doc", pages })).toMatchObject(invalid);
    }
    expect(checkQuota("PRO", zero, { type: "upload_doc", pages: 1 })).toEqual({ allowed: true });
  });
});
