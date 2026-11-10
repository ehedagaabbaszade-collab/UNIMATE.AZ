import { describe, expect, it } from "vitest";
import { createTranslator, formatMessage, messageArgs, pluralCategory, t, tryTranslate, type Locale } from "./index";

describe("ICU-lite placeholders", () => {
  it("substitutes in a single pass and leaves unknown names", () => {
    expect(formatMessage("Hi {name}", "en", { name: "Aysel" })).toBe("Hi Aysel");
    expect(formatMessage("Hi {name}", "en")).toBe("Hi {name}");
    expect(formatMessage("{a} {b}", "en", { a: "{b}", b: "x" })).toBe("{b} x");
    expect(formatMessage("{constructor}", "en", { a: 1 })).toBe("{constructor}");
    expect(formatMessage("{n}", "en", { n: 0 })).toBe("0");
  });
  it("keeps literal braces that are not valid placeholders", () => {
    expect(formatMessage("a { b", "en", { b: 1 })).toBe("a { b");
    expect(formatMessage("{ not valid }", "en", {})).toBe("{ not valid }");
  });
  it("messageArgs lists nested argument names", () => {
    expect(messageArgs("{n, plural, one {# {what}} other {# things}} for {who}")).toEqual(["n", "what", "who"]);
  });
});

describe("plural rules", () => {
  const msg = "{n, plural, =0 {нет файлов} one {# файл} few {# файла} many {# файлов} other {# файла}}";
  it("ru: one / few / many / other and exact matches", () => {
    const out = (n: number) => formatMessage(msg, "ru", { n });
    expect(out(0)).toBe("нет файлов");
    expect(out(1)).toBe("1 файл");
    expect(out(21)).toBe("21 файл");
    expect(out(2)).toBe("2 файла");
    expect(out(4)).toBe("4 файла");
    expect(out(5)).toBe("5 файлов");
    expect(out(11)).toBe("11 файлов");
    expect(out(12)).toBe("12 файлов");
    expect(out(22)).toBe("22 файла");
    expect(out(100)).toBe("100 файлов");
    expect(out(1.5)).toBe("1,5 файла");
  });
  it("categories per locale", () => {
    for (const l of ["az", "tr", "en"] as Locale[]) {
      expect(pluralCategory(l, 1)).toBe("one");
      expect(pluralCategory(l, 2)).toBe("other");
    }
    expect(pluralCategory("ru", 1)).toBe("one");
    expect(pluralCategory("ru", 3)).toBe("few");
    expect(pluralCategory("ru", 7)).toBe("many");
    expect(pluralCategory("ru", 1.5)).toBe("other");
  });
  it("en/az one-other, and falls back to other when a category is absent", () => {
    const en = "{n, plural, one {# card} other {# cards}}";
    expect(formatMessage(en, "en", { n: 1 })).toBe("1 card");
    expect(formatMessage(en, "en", { n: 2 })).toBe("2 cards");
    expect(formatMessage(en, "en", { n: 1000 })).toBe("1,000 cards");
    expect(formatMessage("{n, plural, one {bir} other {# dənə}}", "az", { n: 1 })).toBe("bir");
    expect(formatMessage("{n, plural, one {a} other {# b}}", "ru", { n: 3 })).toBe("3 b");
  });
  it("select; a choice without its param stays as written", () => {
    expect(formatMessage("{g, select, f {she} other {they}}", "en", { g: "f" })).toBe("she");
    expect(formatMessage("{g, select, f {she} other {they}}", "en", { g: "x" })).toBe("they");
    expect(formatMessage("{n, plural, other {#}}", "en", {})).toBe("{n, plural, other {#}}");
  });
});

describe("t()", () => {
  it("translates per locale, applies catalog plurals, falls back to the key", () => {
    expect(t("en", "common.of", { a: 1, b: 2 })).toBe("1 of 2");
    expect(t("ru", "usage.maxPages", { n: 1 })).toBe("До 1 страницы на документ");
    expect(t("ru", "usage.maxPages", { n: 3 })).toBe("До 3 страниц на документ");
    expect(t("en", "documents.pages", { n: 1 })).toBe("1 page");
    expect(t("en", "documents.pages", { n: 12 })).toBe("12 pages");
    expect(createTranslator("tr")("nav.settings")).toBe("Ayarlar");
    expect(t("az", "nope.nothing" as never)).toBe("nope.nothing");
    expect(tryTranslate("en", "documents.status.ready", "?")).toBe("Ready");
    expect(tryTranslate("en", "documents.status.zzz", "?")).toBe("?");
    expect(tryTranslate("en", "documents", "?")).toBe("?");
  });
});
