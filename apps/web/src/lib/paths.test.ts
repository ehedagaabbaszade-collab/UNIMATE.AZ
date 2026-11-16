import { describe, expect, it } from "vitest";
import { isAuthOnlyPath, isProtectedPath, safeNext } from "./paths";

describe("route classification", () => {
  it("protects app routes and their children only", () => {
    for (const p of ["/dashboard", "/documents", "/documents/abc", "/planner", "/focus", "/gpa", "/settings", "/onboarding", "/flashcards", "/teacher", "/teacher/classes", "/class/abc", "/classes", "/budget", "/study"]) expect(isProtectedPath(p)).toBe(true);
    for (const p of ["/", "/sign-in", "/legal/privacy", "/documents-x", "/auth/callback", "/reset-password"]) expect(isProtectedPath(p)).toBe(false);
  });
  it("bounces signed-in users from sign-in/up/forgot but not reset-password", () => {
    expect(isAuthOnlyPath("/sign-in")).toBe(true);
    expect(isAuthOnlyPath("/sign-up")).toBe(true);
    expect(isAuthOnlyPath("/forgot-password")).toBe(true);
    expect(isAuthOnlyPath("/reset-password")).toBe(false);
    expect(isAuthOnlyPath("/verify-email")).toBe(false);
  });
});

describe("safeNext (open redirect guard)", () => {
  it("accepts same-origin paths", () => {
    expect(safeNext("/documents/1?x=2")).toBe("/documents/1?x=2");
  });
  it("rejects absolute, protocol-relative, backslash and control-char targets", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/ok\nHost: x", "", null, undefined]) {
      expect(safeNext(bad as string | null | undefined)).toBe("/dashboard");
    }
  });
});
