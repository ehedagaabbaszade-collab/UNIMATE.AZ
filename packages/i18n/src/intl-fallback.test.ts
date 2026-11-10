import { afterEach, describe, expect, it, vi } from "vitest";
import { formatList, formatRelativeTime } from "./format";
import { fallbackList, fallbackPluralCategory, fallbackRelativeTime } from "./intl-fallback";
import { LOCALES, bcp47 } from "./locales";
import { formatMessage, pluralCategory } from "./message";

/** Simulates Hermes: Intl exists but PluralRules / RelativeTimeFormat / ListFormat do not. */
function hermesIntl() {
  const real = Intl;
  vi.stubGlobal("Intl", {
    Collator: real.Collator,
    NumberFormat: real.NumberFormat,
    DateTimeFormat: real.DateTimeFormat,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fallbackPluralCategory matches native CLDR for integers", () => {
  for (const l of LOCALES) {
    it(l, () => {
      const native = new Intl.PluralRules(bcp47(l));
      for (let n = 0; n <= 200; n++) expect(fallbackPluralCategory(l, n), `${l} ${n}`).toBe(native.select(n));
    });
  }
});

describe("without Intl.PluralRules / RelativeTimeFormat / ListFormat (Hermes)", () => {
  it("pluralCategory does not throw and is correct", () => {
    hermesIntl();
    expect(typeof Intl.PluralRules).toBe("undefined");
    expect(pluralCategory("az", 1)).toBe("one");
    expect(pluralCategory("az", 5)).toBe("other");
    expect(pluralCategory("tr", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
    expect(pluralCategory("ru", 21)).toBe("one");
    expect(pluralCategory("ru", 3)).toBe("few");
    expect(pluralCategory("ru", 11)).toBe("many");
  });

  it("formatMessage plural works", () => {
    hermesIntl();
    const msg = "{n, plural, one {# sənəd} other {# sənəd}}";
    expect(formatMessage(msg, "az", { n: 1 })).toContain("1");
    const en = "{n, plural, one {# file} other {# files}}";
    expect(formatMessage(en, "en", { n: 1 })).toBe("1 file");
    expect(formatMessage(en, "en", { n: 3 })).toBe("3 files");
  });

  it("number and date formatting keep working", () => {
    hermesIntl();
    expect(() => new Intl.NumberFormat("az").format(1240)).not.toThrow();
    expect(() => new Intl.DateTimeFormat("tr").format(new Date())).not.toThrow();
  });

  it("formatRelativeTime and formatList do not throw in any locale", () => {
    hermesIntl();
    const now = new Date("2026-11-10T12:00:00Z");
    for (const l of LOCALES) {
      expect(formatRelativeTime(l, new Date("2026-11-07T12:00:00Z"), now)).toMatch(/3/);
      expect(formatList(l, ["a", "b", "c"])).toContain("a");
    }
  });
});

describe("fallback strings", () => {
  it("relative time", () => {
    expect(fallbackRelativeTime("az", -3, "day")).toBe("3 gün əvvəl");
    expect(fallbackRelativeTime("tr", 2, "hour")).toBe("2 saat sonra");
    expect(fallbackRelativeTime("en", -1, "day")).toBe("1 day ago");
    expect(fallbackRelativeTime("en", 2, "hour")).toBe("in 2 hours");
    expect(fallbackRelativeTime("ru", -2, "day")).toBe("2 дня назад");
    expect(fallbackRelativeTime("ru", 5, "day")).toBe("через 5 дней");
    expect(fallbackRelativeTime("az", 0, "second")).toBe("indi");
  });
  it("lists", () => {
    expect(fallbackList("az", ["a", "b"])).toBe("a və b");
    expect(fallbackList("en", ["a", "b", "c"])).toBe("a, b, and c");
    expect(fallbackList("ru", ["a", "b", "c"])).toBe("a, b и c");
    expect(fallbackList("tr", [])).toBe("");
  });
});
