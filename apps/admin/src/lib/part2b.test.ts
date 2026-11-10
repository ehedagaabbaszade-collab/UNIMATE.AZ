import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { budgetSchema, modelSchema, providerSchema, routeSchema } from "./ai-schemas";
import { auditCsv, parseAuditFilter } from "./audit-filter";
import { contentKeySchema, parseContentBody, parityVerdict, templateSchema } from "./content-schemas";
import type { AuditRow } from "./rpc";

const U = "11111111-1111-4111-8111-111111111111";
const blank = { actor: "", action: "", entityType: "", entityId: "", from: "", to: "" };

describe("audit filter", () => {
  it("accepts an empty filter and converts dates to an inclusive range", () => {
    const r = parseAuditFilter({ ...blank, actor: U, action: "ai_config.", from: "2026-01-02", to: "2026-01-03" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Date(r.filter.to).getTime() - new Date(r.filter.from).getTime()).toBe(2 * 24 * 3600 * 1000);
      expect(r.filter.actor).toBe(U);
    }
    expect(parseAuditFilter(blank)).toEqual({ ok: true, filter: blank });
  });
  it("rejects bad actor, action, dates and reversed ranges", () => {
    const r = parseAuditFilter({ ...blank, actor: "nope", action: "a b%", from: "2026-13-40", to: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["action", "actor", "from", "to"]);
    expect(parseAuditFilter({ ...blank, from: "2026-02-02", to: "2026-02-01" }).ok).toBe(false);
  });
  it("exports redacted, formula-safe CSV of the current view", () => {
    const row: AuditRow = { id: 7, actor_id: U, action: "=cmd", entity_type: "user", entity_id: "+1", metadata: { api_key: "sk-1", reason: "mail a@b.co", note: "@x" }, created_at: "2026-01-01T00:00:00Z" };
    const csv = auditCsv([row], ["id", "when", "actor", "action", "type", "target", "details"]);
    const [head, line] = csv.split("\r\n");
    expect(head).toBe("id,when,actor,action,type,target,details");
    expect(line).toContain("'=cmd");
    expect(line).toContain("'+1");
    expect(line).not.toContain("sk-1");
    expect(line).not.toContain("a@b.co");
    expect(line).toContain("[redacted]");
  });
});

describe("AI form schemas", () => {
  it("provider: name pattern and no credential-like labels", () => {
    expect(providerSchema.safeParse({ name: "openrouter", kind: "openai", enabled: true, baseUrlLabel: "gateway" }).success).toBe(true);
    expect(providerSchema.safeParse({ name: "Bad Name", kind: "openai", enabled: true, baseUrlLabel: "" }).success).toBe(false);
    for (const label of ["https://x.test", "me@x", "my-api-key", "secret sauce", "token"]) expect(providerSchema.safeParse({ name: "p", kind: "openai", enabled: true, baseUrlLabel: label }).success, label).toBe(false);
    expect(providerSchema.parse({ name: "p", kind: "anthropic", enabled: false, baseUrlLabel: "" }).baseUrlLabel).toBeNull();
  });
  const model = { providerId: U, model: "gpt-x", tier: "small", input: "0.15", output: "0.60", cached: "0.075", maxOutputTokens: "4096", enabled: true, approvedFallback: false };
  it("model: converts USD to micro-USD and mirrors the RPC rules", () => {
    expect(modelSchema.parse(model)).toMatchObject({ input: 150_000, output: 600_000, cached: 75_000, maxOutputTokens: 4096 });
    expect(modelSchema.safeParse({ ...model, input: "0" }).success).toBe(false);
    expect(modelSchema.safeParse({ ...model, output: "0" }).success).toBe(true);
    expect(modelSchema.safeParse({ ...model, cached: "0.2" }).success).toBe(false);
    expect(modelSchema.safeParse({ ...model, maxOutputTokens: "0" }).success).toBe(false);
    expect(modelSchema.safeParse({ ...model, maxOutputTokens: "1000001" }).success).toBe(false);
    expect(modelSchema.safeParse({ ...model, tier: "huge" }).success).toBe(false);
    expect(modelSchema.safeParse({ ...model, input: "1e3" }).success).toBe(false);
  });
  it("route: tasks include career tasks; at most 5 fallbacks", () => {
    const r = { task: "cv_feedback", plan: "pro", primary: U, fallbacks: [], rateLimit: "20" };
    expect(routeSchema.safeParse(r).success).toBe(true);
    expect(routeSchema.safeParse({ ...r, task: "interview_prep" }).success).toBe(true);
    expect(routeSchema.safeParse({ ...r, task: "nope" }).success).toBe(false);
    expect(routeSchema.safeParse({ ...r, rateLimit: "0" }).success).toBe(false);
    expect(routeSchema.safeParse({ ...r, fallbacks: Array(6).fill(U) }).success).toBe(false);
  });
  it("budget: key rules per scope", () => {
    const ok = (scope: string, key: string) => budgetSchema.safeParse({ scope, key, period: "day", limit: "5" }).success;
    expect(ok("global", "*")).toBe(true);
    expect(ok("global", "free")).toBe(false);
    expect(ok("plan", "pro")).toBe(true);
    expect(ok("plan", "*")).toBe(false);
    expect(ok("user", "*")).toBe(true);
    expect(ok("user", U)).toBe(true);
    expect(ok("user", "someone")).toBe(false);
    expect(budgetSchema.parse({ scope: "global", key: "*", period: "month", limit: "12.5" }).limit).toBe(12_500_000);
  });
});

describe("content / template validation", () => {
  it("template schema mirrors the RPC", () => {
    expect(templateSchema.safeParse({ key: "welcome", locale: "ru", title: "Hi {name}", body: "" }).success).toBe(true);
    expect(templateSchema.parse({ key: "welcome", locale: "en", title: "T", body: "  " }).body).toBeNull();
    expect(templateSchema.safeParse({ key: "Bad-Key", locale: "en", title: "T", body: "" }).success).toBe(false);
    expect(templateSchema.safeParse({ key: "k", locale: "de", title: "T", body: "" }).success).toBe(false);
    expect(templateSchema.safeParse({ key: "k", locale: "en", title: "", body: "" }).success).toBe(false);
    expect(templateSchema.safeParse({ key: "k", locale: "en", title: "T", body: "x".repeat(2001) }).success).toBe(false);
    expect(contentKeySchema.safeParse("legal.terms-v1").success).toBe(true);
  });
  it("content body must be non-null JSON", () => {
    expect(parseContentBody('{"a":"x"}').ok).toBe(true);
    expect(parseContentBody("null").ok).toBe(false);
    expect(parseContentBody("{").ok).toBe(false);
  });
  it("parity verdict: non-az mismatches block, az edits only warn", () => {
    const others = { az: ["Salam {name}"], en: ["Hi {name}"] };
    expect(parityVerdict(others, "tr", ["Merhaba {name}"])).toEqual({ blocking: null, warnings: [] });
    const bad = parityVerdict(others, "tr", ["Merhaba {ad}"]);
    expect(bad.blocking).toEqual({ locale: "tr", missing: ["name"], extra: ["ad"] });
    const az = parityVerdict({ en: ["Hi {name}"], tr: ["Merhaba {name}"] }, "az", ["Salam {name} {n}"]);
    expect(az.blocking).toBeNull();
    expect(az.warnings.map((w) => w.locale)).toEqual(["tr", "en"]);
  });
});

describe("RPC wrappers only call functions that exist in the migrations", () => {
  const sqlDir = path.resolve(__dirname, "../../../../supabase/migrations");
  const sql = readdirSync(sqlDir).map((f) => readFileSync(path.join(sqlDir, f), "utf8")).join("\n");
  const src = readFileSync(path.resolve(__dirname, "rpc.ts"), "utf8");
  const called = [...new Set([...src.matchAll(/rpc(?:Page)?\(\s*sb,\s*"([a-z_0-9]+)"/g)].map((m) => m[1]!))];
  it("finds the part 2 calls", () => expect(called).toEqual(expect.arrayContaining(["admin_ai_set_route", "admin_revert_config", "admin_requeue_job", "admin_retention_cohorts", "admin_ai_sweep_reservations"])));
  for (const fn of called) {
    it(`${fn} is defined in a migration`, () => {
      expect(new RegExp(`create (or replace )?function public\\.${fn}\\(`).test(sql), `${fn} missing`).toBe(true);
    });
  }
});
