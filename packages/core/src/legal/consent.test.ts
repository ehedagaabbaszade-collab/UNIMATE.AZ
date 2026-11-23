import { describe, expect, it } from "vitest";
import { gateDecision, isFunctionMissing, legalErrorKind, legalGate, signUpLegalMeta } from "./consent";

describe("legal consent helpers", () => {
  it("classifies server errors", () => {
    expect(legalErrorKind({ message: "x UNDERAGE" })).toBe("underage");
    expect(legalErrorKind({ message: "Database error saving new user" })).toBe("generic");
    expect(legalErrorKind({ message: "other" })).toBeNull();
  });
  it("detects a missing function only", () => {
    expect(isFunctionMissing({ code: "PGRST202" })).toBe(true);
    expect(isFunctionMissing({ code: "28000" })).toBe(false);
  });
  it("fails closed except for a missing function", () => {
    expect(gateDecision([null, null])).toBe("check");
    expect(gateDecision([{ code: "PGRST202" }, { status: 404 }])).toBe("skip");
    expect(gateDecision([null, { status: 503 }])).toBe("block");
    expect(gateDecision([{ code: "PGRST202" }, { code: "28000" }])).toBe("block");
  });
  it("builds the gate", () => {
    expect(legalGate([{ has_birth_date: false }], [{ consent_type: "terms", granted: false, needs_action: true }, { consent_type: "marketing", granted: true, needs_action: false }])).toEqual({ needsBirth: true, pending: ["terms"], marketing: true });
  });
  it("builds signup metadata", () => {
    expect(signUpLegalMeta("2000-01-01", false, "web").consents).toEqual(["terms", "privacy_notice", "ai_disclaimer"]);
  });
});
