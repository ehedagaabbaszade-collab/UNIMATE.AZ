import { LOCALES, t } from "@unimate/i18n";
import { describe, expect, it } from "vitest";
import { ACTIONS, NAV_GROUPS, PAGES, TAB_ITEMS, filterItems, fold } from "./nav";

describe("navigation model", () => {
  it("every page appears once, and the tab bar leaves room for More", () => {
    const hrefs = PAGES.map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(TAB_ITEMS.length).toBe(4);
    expect(NAV_GROUPS.flatMap((g) => g.items).length).toBe(10);
  });

  it("every label resolves in all four locales", () => {
    for (const l of LOCALES) for (const i of [...PAGES, ...ACTIONS]) expect(t(l, i.key)).not.toBe(i.key);
  });
});

describe("filterItems", () => {
  it("matches every word, ignoring case and diacritics (az)", () => {
    const hits = filterItems(ACTIONS, "SƏNƏD yük", (k) => t("az", k), "az");
    expect(hits.map((h) => h.key)).toEqual(["palette.uploadDoc"]);
    expect(filterItems(ACTIONS, "sened", (k) => t("az", k), "az").map((h) => h.key)).toEqual(["palette.uploadDoc"]);
  });

  it("handles Turkish dotted/dotless i and Russian", () => {
    expect(fold("İMTAHAN", "tr")).toBe("imtahan");
    expect(filterItems(ACTIONS, "сессию", (k) => t("ru", k), "ru").map((h) => h.key)).toEqual(["palette.startFocus"]);
  });

  it("returns everything for an empty query and nothing for a miss", () => {
    expect(filterItems(PAGES, "  ", (k) => t("en", k), "en")).toHaveLength(PAGES.length);
    expect(filterItems(PAGES, "zzzz", (k) => t("en", k), "en")).toEqual([]);
  });
});
