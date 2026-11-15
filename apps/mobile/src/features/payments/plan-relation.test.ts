import { describe, expect, it } from "vitest";
import { planLosses, planRelation } from "./plan-relation";

describe("planRelation", () => {
  it("compares tiers", () => {
    expect(planRelation("FREE", "FREE")).toBe("current");
    expect(planRelation("FREE", "PLUS")).toBe("upgrade");
    expect(planRelation("PLUS", "PRO")).toBe("upgrade");
    expect(planRelation("PRO", "PLUS")).toBe("downgrade");
    expect(planRelation("PLUS", "FREE")).toBe("downgrade");
  });
  it("lists losses from entitlements", () => {
    expect(planLosses("PLUS", "FREE").some((l) => l.kind === "ai")).toBe(true);
    expect(planLosses("FREE", "FREE")).toEqual([]);
  });
});
