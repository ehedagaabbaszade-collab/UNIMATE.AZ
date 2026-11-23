import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES, catalogs, messageArgs } from "@unimate/i18n";

const flat = (o: unknown, p = ""): Array<[string, string]> =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [[`${p}${k}`, v] as [string, string]] : flat(v, `${p}${k}.`)));
const adminOf = (l: (typeof LOCALES)[number]) => new Map(flat((catalogs[l] as unknown as { admin: unknown }).admin, "admin."));

describe("admin.* i18n parity (az, tr, en, ru)", () => {
  const en = adminOf("en");
  it("has a meaningful number of admin keys", () => expect(en.size).toBeGreaterThan(300));
  for (const l of LOCALES) {
    it(`${l}: exactly the en admin keys, no empty values, same placeholders`, () => {
      const m = adminOf(l);
      expect([...en.keys()].filter((k) => !m.has(k))).toEqual([]);
      expect([...m.keys()].filter((k) => !en.has(k))).toEqual([]);
      for (const [k, v] of m) {
        expect(v.trim().length, `${l}:${k}`).toBeGreaterThan(0);
        expect(messageArgs(v), `${l}:${k}`).toEqual(messageArgs(en.get(k)!));
      }
    });
  }
  it("non-English admin copy is actually translated (not an English copy)", () => {
    for (const l of ["az", "tr", "ru"] as const) {
      const m = adminOf(l);
      const same = [...m].filter(([k, v]) => v === en.get(k) && /[A-Za-z]{5,}/.test(v));
      expect(same.length, `${l}: ${same.map(([k]) => k).join(", ")}`).toBeLessThan(20); // cognates and names (Admin, Status, Model, Prompt, Anthropic, Premium, endonyms like English/Türkçe) are legitimately identical
    }
  });
});

describe("every admin key used in source exists", () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(f);
    }
  };
  walk(root);
  const en = adminOf("en");
  it("literal keys resolve", () => {
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/["'`](admin\.[A-Za-z0-9_.]+)["'`]/g)) {
        if (!en.has(m[1]!)) missing.push(`${m[1]} in ${path.relative(root, f)}`);
      }
    }
    expect(missing).toEqual([]);
  });
  it("templated keys (admin.x.${var}) resolve for every member of their group", () => {
    // Groups that are indexed by a runtime value: each member the app can pass must exist.
    const groups: Record<string, string[]> = {
      "admin.role.": ["student", "moderator", "admin", "super_admin"],
      "admin.users.planName.": ["free", "plus", "pro"],
      "admin.users.source.": ["paid", "manual"],
      "admin.users.subStatus.": ["active", "trialing", "past_due", "canceled", "expired"],
      "admin.docStatus.": ["pending_upload", "uploaded", "processing", "ready", "failed"],
      "admin.academic.type.": ["university", "college"],
      "admin.academic.ownership.": ["state", "private"],
      "admin.academic.source.": ["official", "wikipedia", "unverified", "verified"],
      "admin.academic.degree.": ["bachelor", "master", "phd"],
      "admin.moderation.reportStatus.": ["open", "reviewing", "actioned", "dismissed"],
      "admin.moderation.kind.": ["post", "comment", "resource", "user", "community", "event"],
      "admin.moderation.visibility.": ["public", "private"],
      "admin.universities.status.": ["pending", "approved", "rejected", "none"],
      "admin.career.kind.": ["internship", "junior_job", "scholarship", "exchange", "competition", "hackathon", "career_event"],
      "admin.career.status.": ["draft", "published", "archived"],
      "admin.ai.kind.": ["openai", "anthropic"],
      "admin.ai.tier.": ["small", "standard", "premium"],
      "admin.ai.task.": ["extract_cleanup", "summarize", "rag", "chat", "quiz", "flashcards", "exam_simulation", "embed", "cv_feedback", "interview_prep"],
      "admin.ai.scope.": ["global", "plan", "user"],
      "admin.ai.period.": ["day", "month"],
      "admin.cost.group.": ["model", "provider", "task", "plan"],
      "admin.versions.change.": ["added", "removed", "changed"],
      "admin.versions.entity.": ["providers", "models", "routes", "budgets"],
      "admin.content.locale.": ["az", "tr", "en", "ru"],
      "admin.jobs.kind.": ["extract_text", "chunk", "embed", "summarize", "generate_quiz", "generate_flashcards"],
      "admin.jobs.state.": ["queued", "running", "succeeded", "failed", "dead"],
    };
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/`(admin\.[A-Za-z0-9_.]+\.)\$\{/g)) used.add(m[1]!);
    for (const p of used) expect(groups[p], `unknown dynamic group ${p}`).toBeDefined();
    for (const [p, members] of Object.entries(groups)) for (const mem of members) expect(en.has(p + mem), p + mem).toBe(true);
  });
});
