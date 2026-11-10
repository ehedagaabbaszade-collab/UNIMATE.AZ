import { describe, expect, it } from "vitest";
import { LOCALES, catalogs, createTranslator, formatDate, formatNumber, interpolate, lookup, toLocale, toProfileLocale } from "./index";

const keysOf = (o: unknown, prefix = ""): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : keysOf(v, `${prefix}${k}.`),
  );
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort().join(",");
const entriesOf = (o: unknown, prefix = ""): Array<[string, string]> =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : entriesOf(v, `${prefix}${k}.`),
  );

describe("message catalogs", () => {
  const base = keysOf(catalogs.en).sort();
  it("has all four locales, az first", () => {
    expect([...LOCALES]).toEqual(["az", "en", "ru", "tr"]);
  });
  for (const l of LOCALES) {
    it(`${l} has exactly the same keys as en`, () => {
      expect(keysOf(catalogs[l]).sort()).toEqual(base);
    });
    it(`${l} has no empty strings and the same placeholders as en`, () => {
      const en = new Map(entriesOf(catalogs.en));
      for (const [k, v] of entriesOf(catalogs[l])) {
        expect(v.trim().length, `${l}:${k} empty`).toBeGreaterThan(0);
        expect(placeholders(v), `${l}:${k} placeholders`).toBe(placeholders(en.get(k)!));
      }
    });
  }
});

describe("translator and formatting", () => {
  it("interpolates and falls back to the key", () => {
    expect(interpolate("Hi {name}", { name: "Aysel" })).toBe("Hi Aysel");
    expect(interpolate("Hi {name}")).toBe("Hi {name}");
    // single pass: a substituted value is never re-expanded, and inherited keys are not placeholders
    expect(interpolate("{a} {b}", { a: "{b}", b: "x" })).toBe("{b} x");
    expect(interpolate("{constructor}", { a: 1 })).toBe("{constructor}");
    expect(lookup(catalogs.en, "nope.nothing")).toBe("nope.nothing");
    expect(createTranslator("en")("common.of", { a: 1, b: 2 })).toBe("1 of 2");
  });
  it("defaults to az and maps tr to en for profiles", () => {
    expect(toLocale("xx")).toBe("az");
    expect(toLocale(undefined)).toBe("az");
    expect(toProfileLocale("tr")).toBe("en");
    expect(toProfileLocale("ru")).toBe("ru");
  });
  it("formats numbers and dates per locale", () => {
    expect(formatNumber("en", 1234.5)).toBe("1,234.5");
    expect(formatNumber("ru", 1234.5)).not.toBe(formatNumber("en", 1234.5));
    const d = new Date("2026-03-05T12:00:00Z");
    expect(formatDate("en", d, { month: "long", timeZone: "UTC" })).toBe("March");
    expect(formatDate("ru", d, { month: "long", timeZone: "UTC" })).toBe("март");
    expect(formatDate("tr", d, { month: "long", timeZone: "UTC" })).toBe("Mart");
  });
});
