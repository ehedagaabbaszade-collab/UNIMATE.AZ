import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCALES } from "./index";

const root = path.resolve(__dirname, "../../..");
const dir = path.join(root, "supabase", "templates");
const TYPES = ["confirm", "recovery", "magic_link", "invite", "email_change"] as const;
const read = (type: string, l: string) => readFileSync(path.join(dir, `${type}_${l}.html`), "utf8");
const ALLOWED_VARS = new Set([".SiteURL", ".ConfirmationURL", ".Email", ".NewEmail"]);

describe("supabase auth email templates", () => {
  it("exist for every type in every locale (20 files)", () => {
    for (const type of TYPES) for (const l of LOCALES) expect(existsSync(path.join(dir, `${type}_${l}.html`)), `${type}_${l}`).toBe(true);
  });
  for (const type of TYPES) {
    for (const l of LOCALES) {
      const html = read(type, l);
      it(`${type}_${l}: logo URL, action link, lang, native-review header`, () => {
        expect(html).toContain('src="{{ .SiteURL }}/brand/full-logo.png"');
        expect(html).toContain('href="{{ .ConfirmationURL }}"');
        expect(html).toContain(`<html lang="${l}"`);
        expect(html.slice(0, 400)).toMatch(/NATIVE-SPEAKER REVIEW NEEDED/);
        expect(html).toMatch(/<table role="presentation"/);
        expect(html).toMatch(/<meta name="viewport"/);
        expect(html).not.toMatch(/<script/i);
      });
      it(`${type}_${l}: only known template variables`, () => {
        const vars = [...html.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!);
        for (const v of vars) expect(ALLOWED_VARS.has(v), `${type}_${l}: ${v}`).toBe(true);
      });
    }
    it(`${type}: all four locales use the same variables`, () => {
      const vars = (l: string) => [...new Set([...read(type, l).matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((m) => m[1]!))].sort().join(",");
      for (const l of LOCALES) expect(vars(l), `${type}_${l}`).toBe(vars("az"));
    });
  }
  it("recovery mentions the account email, email_change the new address", () => {
    for (const l of LOCALES) {
      expect(read("recovery", l)).toContain("{{ .Email }}");
      expect(read("email_change", l)).toContain("{{ .NewEmail }}");
    }
  });
  it("copy is in the right language (script / letters, not an English copy)", () => {
    for (const type of TYPES) {
      expect(read(type, "ru")).toMatch(/[А-Яа-яЁё]{4,}/);
      expect(read(type, "az")).toMatch(/[əğıöüçşƏ]/);
      expect(read(type, "tr")).toMatch(/[ğıöüçş]/);
      expect(read(type, "en")).not.toMatch(/[А-Яа-я]/);
      expect(new Set(LOCALES.map((l) => read(type, l).match(/<h1[^>]*>(.*?)<\/h1>/)![1])).size).toBe(4);
    }
  });
});

describe("combined (conditional) template builder", () => {
  it("branches on .Data.locale and renders az when the locale is missing or unknown", async () => {
    const { combine } = (await import(pathToFileURL(path.join(root, "scripts", "build-auth-templates.mjs")).href)) as { combine: (t: string) => string };
    const out = combine("confirm");
    expect(out).toContain('{{ if and .Data .Data.locale (eq .Data.locale "tr") }}');
    expect(out).toContain('(eq .Data.locale "ru")');
    expect((out.match(/\{\{ if /g) ?? []).length).toBe(3);
    expect((out.match(/\{\{ end \}\}/g) ?? []).length).toBe(3);
    expect(out.indexOf("{{ else }}\n<!--")).toBeGreaterThan(0);
    // the az document is the final else
    const tail = out.slice(out.lastIndexOf("{{ else }}"));
    expect(tail).toContain('lang="az"');
    expect(tail).not.toContain('lang="ru"');
  });
});
