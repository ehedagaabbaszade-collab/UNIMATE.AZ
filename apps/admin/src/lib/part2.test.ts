import { describe, expect, it } from "vitest";
import { AI_TASKS, diffSnapshots, formatUsd, meterTone, microToUsdString, parseUsdToMicro, ratePct, routeIssues, utilisationPct, type ModelLite } from "./ai-config";
import { parseConfigValue } from "./config-keys";
import { csvCell, toCsv } from "./csv";
import { REDACTED, redact } from "./redact";
import { completeness, parityIssues, placeholders, sampleFor, stringLeaves } from "./template-params";
import { renderNotification } from "@unimate/i18n";
import { NAV, atLeast, canAccess, navFor } from "./guard";

const model = (o: Partial<ModelLite> & { id: string }): ModelLite => ({
  model: o.id,
  tier: "standard",
  input_micro_usd_per_mtok: 1_000_000,
  output_micro_usd_per_mtok: 2_000_000,
  cached_input_micro_usd_per_mtok: 100_000,
  enabled: true,
  approved_fallback: true,
  ...o,
});

describe("USD <-> micro-USD", () => {
  it("parses plain decimals only", () => {
    expect(parseUsdToMicro("1.25")).toBe(1_250_000);
    expect(parseUsdToMicro("0.000001")).toBe(1);
    expect(parseUsdToMicro("15")).toBe(15_000_000);
    for (const bad of ["", "-1", "1e3", "1,5", "1.1234567", ".5", "abc", "1 2", "9999999"]) expect(parseUsdToMicro(bad), bad).toBeNull();
  });
  it("formats and round-trips", () => {
    expect(microToUsdString(1_250_000)).toBe("1.25");
    expect(microToUsdString(150)).toBe("0.00015");
    expect(formatUsd(0)).toBe("$0.00");
    for (const s of ["0.10", "2.50", "12.00", "0.00015"]) expect(microToUsdString(parseUsdToMicro(s)!)).toBe(s);
  });
});

describe("budget utilisation", () => {
  it("counts spent + reserved against the hard limit", () => {
    expect(utilisationPct(500, 250, 1000)).toBe(75);
    expect(utilisationPct(1, 0, 3)).toBe(33.33);
    expect(utilisationPct(0, 0, 0)).toBeNull();
  });
  it("tones: <70 success, 70-89 warning, >=90 or unlimited-blocked danger", () => {
    expect(meterTone(10)).toBe("success");
    expect(meterTone(70)).toBe("warning");
    expect(meterTone(89.99)).toBe("warning");
    expect(meterTone(90)).toBe("danger");
    expect(meterTone(null)).toBe("danger");
  });
  it("rates", () => {
    expect(ratePct(1, 8)).toBe(12.5);
    expect(ratePct(0, 0)).toBe(0);
  });
});

describe("route validation mirrors ai_validate_routes", () => {
  const primary = model({ id: "p", tier: "premium", input_micro_usd_per_mtok: 3_000_000, output_micro_usd_per_mtok: 6_000_000, cached_input_micro_usd_per_mtok: 300_000 });
  it("accepts approved, cheaper-or-equal fallbacks", () => {
    expect(routeIssues(primary, [model({ id: "a", tier: "small", input_micro_usd_per_mtok: 100_000 }), model({ id: "b", tier: "premium", input_micro_usd_per_mtok: 3_000_000, output_micro_usd_per_mtok: 6_000_000, cached_input_micro_usd_per_mtok: 300_000 })])).toEqual([]);
  });
  it("rejects costlier (any price or tier), unapproved, disabled, duplicate and self fallbacks", () => {
    const small = model({ id: "s", tier: "small", input_micro_usd_per_mtok: 100_000, output_micro_usd_per_mtok: 200_000, cached_input_micro_usd_per_mtok: 10_000 });
    expect(routeIssues(small, [primary])).toContain("admin.routes.errCostlier");
    expect(routeIssues(small, [model({ id: "x", tier: "standard", input_micro_usd_per_mtok: 1, output_micro_usd_per_mtok: 1, cached_input_micro_usd_per_mtok: 1 })])).toContain("admin.routes.errCostlier");
    expect(routeIssues(small, [model({ id: "y", output_micro_usd_per_mtok: 300_000, tier: "small", input_micro_usd_per_mtok: 1, cached_input_micro_usd_per_mtok: 1 })])).toContain("admin.routes.errCostlier");
    expect(routeIssues(primary, [model({ id: "u", tier: "small", approved_fallback: false, input_micro_usd_per_mtok: 1, output_micro_usd_per_mtok: 1, cached_input_micro_usd_per_mtok: 1 })])).toContain("admin.routes.errNotApproved");
    expect(routeIssues(primary, [model({ id: "d", tier: "small", enabled: false, input_micro_usd_per_mtok: 1, output_micro_usd_per_mtok: 1, cached_input_micro_usd_per_mtok: 1 })])).toContain("admin.routes.errDisabled");
    expect(routeIssues(primary, [primary])).toContain("admin.routes.errSame");
    const f = model({ id: "f", tier: "small", input_micro_usd_per_mtok: 1, output_micro_usd_per_mtok: 1, cached_input_micro_usd_per_mtok: 1 });
    expect(routeIssues(primary, [f, f])).toContain("admin.routes.errDuplicate");
    expect(routeIssues(undefined, [])).toEqual(["admin.routes.errPrimary"]);
  });
  it("covers the cv_feedback and interview_prep tasks", () => {
    expect(AI_TASKS).toContain("cv_feedback");
    expect(AI_TASKS).toContain("interview_prep");
  });
});

describe("config version diff", () => {
  const row = (id: string, o: Record<string, unknown> = {}) => ({ id, updated_at: "t", ...o });
  it("reports added, removed and changed rows and ignores timestamps", () => {
    const prev = { models: [row("m1", { enabled: true }), row("m2")], budgets: [row("b1", { hard_limit_micro_usd: 5 })] };
    const next = { models: [{ ...row("m1", { enabled: false }), updated_at: "later" }, row("m3")], budgets: [{ ...row("b1", { hard_limit_micro_usd: 5 }), updated_at: "later" }] };
    expect(diffSnapshots(prev, next)).toEqual([
      { entity: "models", id: "m1", change: "changed", fields: ["enabled"] },
      { entity: "models", id: "m3", change: "added", fields: [] },
      { entity: "models", id: "m2", change: "removed", fields: [] },
    ]);
  });
  it("has nothing to compare for the oldest version", () => expect(diffSnapshots(null, { models: [row("m1")] })).toEqual([]));
});

describe("CSV export escaping", () => {
  it("neutralises formula starters (= + - @ tab CR)", () => {
    for (const c of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1"]) expect(csvCell(c).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
  });
  it("quotes commas, quotes and newlines; leaves plain text and numbers alone", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("l1\nl2")).toBe('"l1\nl2"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(null)).toBe("");
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
  it("joins rows with CRLF", () => expect(toCsv([["a", "=b"], [1, null]])).toBe("a,'=b\r\n1,"));
});

describe("redaction", () => {
  it("masks sensitive keys at any depth and secrets inside strings", () => {
    const out = redact({
      reason: "ok",
      old: { api_key: "sk-123", nested: [{ Password: "x", note: "mail bob@example.com now" }] },
      auth: "Bearer abc.def-ghi",
      jwt_like: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig",
      count: 3,
    }) as Record<string, any>;
    expect(out.reason).toBe("ok");
    expect(out.old.api_key).toBe(REDACTED);
    expect(out.old.nested[0].Password).toBe(REDACTED);
    expect(out.old.nested[0].note).toBe("mail [redacted-email] now");
    expect(out.auth).toBe("Bearer [redacted-token]");
    expect(out.jwt_like).toBe(REDACTED);
    expect(out.count).toBe(3);
    expect(JSON.stringify(redact({ x: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig" }))).toContain("[redacted-token]");
  });
  it("truncates long strings and deep trees, keeps ordinary keys (key, scope)", () => {
    expect((redact("x".repeat(900)) as string).length).toBe(501);
    let deep: unknown = "end";
    for (let i = 0; i < 12; i++) deep = { a: deep };
    expect(JSON.stringify(redact(deep))).toContain("[truncated]");
    expect(redact({ key: "k", scope: "plan" })).toEqual({ key: "k", scope: "plan" });
  });
});

describe("system config validators", () => {
  it("accepts valid values for known keys", () => {
    expect(parseConfigValue("signup.enabled", "true")).toEqual({ ok: true, value: true });
    expect(parseConfigValue("uploads.max_file_mb", "25")).toEqual({ ok: true, value: 25 });
    expect(parseConfigValue("maintenance.mode", '{"enabled":true}')).toEqual({ ok: true, value: { enabled: true } });
    expect(parseConfigValue("support.contact_url", '"https://example.az/help"').ok).toBe(true);
  });
  it("rejects bad JSON, wrong types, out-of-range, extra fields, non-https and unknown keys", () => {
    expect(parseConfigValue("signup.enabled", "{")).toEqual({ ok: false, error: "admin.config.errJson" });
    expect(parseConfigValue("signup.enabled", '"yes"')).toEqual({ ok: false, error: "admin.config.errValue" });
    expect(parseConfigValue("uploads.max_file_mb", "0").ok).toBe(false);
    expect(parseConfigValue("uploads.max_file_mb", "2.5").ok).toBe(false);
    expect(parseConfigValue("uploads.max_file_mb", "201").ok).toBe(false);
    expect(parseConfigValue("maintenance.mode", '{"enabled":true,"x":1}').ok).toBe(false);
    expect(parseConfigValue("support.contact_url", '"http://example.az"').ok).toBe(false);
    expect(parseConfigValue("nope", "1")).toEqual({ ok: false, error: "admin.config.errUnknownKey" });
    expect(parseConfigValue("constructor", "1").ok).toBe(false);
  });
});

describe("template placeholders", () => {
  it("extracts unique sorted params and string leaves", () => {
    expect(placeholders("Hi {name}, {n} left, {name}!")).toEqual(["n", "name"]);
    expect(placeholders("no params {} {a b}")).toEqual(["a b"]);
    expect(stringLeaves({ a: "x {p}", b: ["y {q}", { c: "z" }], d: 1 })).toEqual(["x {p}", "y {q}", "z"]);
  });
  it("flags locales whose placeholders differ from az; absent locales are fine", () => {
    expect(parityIssues({ az: ["Salam {name}"], en: ["Hi {name}"] })).toEqual([]);
    expect(parityIssues({ az: ["Salam {name} {n}"], tr: ["Merhaba {name}"], ru: ["Привет {name} {n} {x}"] })).toEqual([
      { locale: "tr", missing: ["n"], extra: [] },
      { locale: "ru", missing: [], extra: ["x"] },
    ]);
    expect(parityIssues({ en: ["{a}"], ru: ["{b}"] })).toEqual([{ locale: "ru", missing: ["a"], extra: ["b"] }]);
    expect(parityIssues({})).toEqual([]);
  });
  it("completeness matrix lists missing locales", () => {
    const m = completeness([
      { key: "welcome", locale: "az" },
      { key: "welcome", locale: "en" },
      { key: "a.b", locale: "ru" },
    ]);
    expect(m.map((r) => r.key)).toEqual(["a.b", "welcome"]);
    expect(m[1]!.missing).toEqual(["tr", "ru"]);
    expect(m[0]!.has).toEqual({ az: false, tr: false, en: false, ru: true });
  });
  it("preview through the shared renderer HTML-escapes substituted values", () => {
    const tpl = { key: "k", translations: { en: { title: "Hi {name}", body: "{count} new" } } } as const;
    const r = renderNotification(tpl as never, sampleFor(["name", "count"]), "en");
    expect(r.title).toBe("Hi Aysel &lt;b&gt;&amp;&lt;/b&gt; Co");
    expect(r.body).toBe("3 new");
    expect(sampleFor(["zzz"])).toEqual({ zzz: "[zzz]" });
  });
});

describe("navigation gating for part 2", () => {
  const part2 = ["/ai/models", "/ai/routes", "/ai/budgets", "/ai/versions", "/ai/cost", "/analytics", "/audit", "/config", "/content", "/jobs"];
  it("every part 2 route is in the nav and admin-only", () => {
    for (const p of part2) {
      expect(NAV.some((n) => n.href === p), p).toBe(true);
      expect(canAccess("moderator", p), p).toBe(false);
      expect(canAccess("student", p), p).toBe(false);
      expect(canAccess("admin", p), p).toBe(true);
      expect(canAccess("super_admin", p), p).toBe(true);
    }
    expect(navFor("moderator").map((n) => n.href)).toEqual(["/", "/moderation"]);
    expect(atLeast("admin", "admin")).toBe(true);
  });
  it("unknown nested routes stay deny-by-default for moderators", () => {
    expect(canAccess("moderator", "/ai/unknown")).toBe(false);
  });
});
