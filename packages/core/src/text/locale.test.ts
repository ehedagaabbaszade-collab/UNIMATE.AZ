import { describe, expect, it } from "vitest";
import { caseFold, lowerCase, normalizeForSearch, upperCase } from "./locale";

describe("locale casing", () => {
  it("az/tr: I -> ı and İ -> i", () => {
    expect(lowerCase("ISTANBUL", "tr")).toBe("ıstanbul");
    expect(lowerCase("İSTANBUL", "tr")).toBe("istanbul");
    expect(lowerCase("İSTANBUL", "az")).toBe("istanbul");
    expect(lowerCase("ƏĞÖÜÇŞ", "az")).toBe("əğöüçş");
  });
  it("az/tr uppercase: i -> İ, ı -> I", () => {
    expect(upperCase("istanbul", "az")).toBe("İSTANBUL");
    expect(upperCase("ığdır", "tr")).toBe("IĞDIR");
    expect(upperCase("əğöüçş", "az-AZ")).toBe("ƏĞÖÜÇŞ");
  });
  it("default locale uses standard mapping", () => {
    expect(lowerCase("TITLE")).toBe("title");
    expect(upperCase("title", "en")).toBe("TITLE");
    expect(lowerCase("ПРИВЕТ", "ru")).toBe("привет");
    expect(upperCase("привет", "ru")).toBe("ПРИВЕТ");
  });
  it("caseFold is locale-aware and idempotent", () => {
    expect(caseFold("DİYARBAKIR", "tr")).toBe("diyarbakır");
    expect(caseFold("Straße")).toBe("strasse");
    expect(caseFold(caseFold("İI", "az"), "az")).toBe("iı");
  });
});

describe("normalizeForSearch", () => {
  it("keeps az letters distinct by default", () => {
    expect(normalizeForSearch("Əhməd Ğəfər Ölkə Üzüm Çay Şəkər", { locale: "az" })).toBe(
      "əhməd ğəfər ölkə üzüm çay şəkər",
    );
  });
  it("strips other diacritics but keeps az letters", () => {
    expect(normalizeForSearch("Café Résumé naïve")).toBe("cafe resume naive");
    expect(normalizeForSearch("Café Əli", { locale: "az" })).toBe("cafe əli");
  });
  it("folds az letters when asked", () => {
    // ğ ö ü ç ş decompose and fold; ə and ı have no decomposition and remain.
    expect(normalizeForSearch("Ğ ö ü ç ş", { keepAzLetters: false })).toBe("g o u c s");
  });
  it("NFC-normalises decomposed input", () => {
    expect(normalizeForSearch("ö")).toBe("ö");
    expect(normalizeForSearch("ü")).toBe("ü");
  });
  it("handles Russian and English and collapses whitespace", () => {
    expect(normalizeForSearch("  Привет   МИР \n Hello ")).toBe("привет мир hello");
  });
  it("can keep diacritics entirely", () => {
    expect(normalizeForSearch("Café", { stripDiacritics: false })).toBe("café");
  });
});
