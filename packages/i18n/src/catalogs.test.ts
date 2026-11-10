import { describe, expect, it } from "vitest";
import { LOCALES, catalogs, messageArgs, pluralCategory } from "./index";

const entriesOf = (o: unknown, prefix = ""): Array<[string, string]> =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : entriesOf(v, `${prefix}${k}.`),
  );
const keysOf = (o: unknown) => entriesOf(o).map(([k]) => k).sort();

describe("message catalogs", () => {
  const base = keysOf(catalogs.en);
  const en = new Map(entriesOf(catalogs.en));

  it("supports az (default), tr, en and ru", () => {
    expect([...LOCALES]).toEqual(["az", "tr", "en", "ru"]);
    expect(Object.keys(catalogs).sort()).toEqual(["az", "en", "ru", "tr"]);
  });
  it("is not empty", () => expect(base.length).toBeGreaterThan(300));

  for (const l of LOCALES) {
    it(`${l}: exactly the same keys as en (no missing, no extra)`, () => {
      const keys = keysOf(catalogs[l]);
      expect(base.filter((k) => !keys.includes(k)), `missing in ${l}`).toEqual([]);
      expect(keys.filter((k) => !base.includes(k)), `extra in ${l}`).toEqual([]);
    });
    it(`${l}: no empty values and the same placeholders (argument names) as en`, () => {
      for (const [k, v] of entriesOf(catalogs[l])) {
        expect(v.trim().length, `${l}:${k} is empty`).toBeGreaterThan(0);
        expect(messageArgs(v), `${l}:${k} placeholders`).toEqual(messageArgs(en.get(k)!));
      }
    });
    it(`${l}: braces are balanced (no stray or unparsed placeholder)`, () => {
      for (const [k, v] of entriesOf(catalogs[l])) {
        let depth = 0;
        for (const c of v) {
          if (c === "{") depth++;
          if (c === "}") depth--;
          expect(depth, `${l}:${k} unbalanced braces`).toBeGreaterThanOrEqual(0);
        }
        expect(depth, `${l}:${k} unbalanced braces`).toBe(0);
      }
    });
  }

  it("ru is real Russian, not an English fallback", () => {
    const same = entriesOf(catalogs.ru).filter(([k, v]) => v === en.get(k) && /[A-Za-z]{4,}/.test(v));
    // A few legitimately identical strings (brand names) are fine; a wholesale English copy is not.
    expect(same.length, same.map(([k]) => k).join(", ")).toBeLessThan(5);
  });

  it("every plural message defines `other`, and Russian categories resolve", () => {
    for (const l of LOCALES) for (const [k, v] of entriesOf(catalogs[l])) if (v.includes(", plural,")) expect(v, `${l}:${k}`).toContain("other");
    expect(pluralCategory("ru", 3)).toBe("few");
  });
});
