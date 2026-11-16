import { describe, expect, it } from "vitest";
import { effectivePlan } from "./demo-plan";

describe("effectivePlan", () => {
  it("falls back to the server plan when no demo plan is set", () => expect(effectivePlan(null, "PLUS")).toBe("PLUS"));
  it("prefers the demo plan", () => {
    expect(effectivePlan("PRO", "FREE")).toBe("PRO");
    expect(effectivePlan("FREE", "PRO")).toBe("FREE");
  });
});
