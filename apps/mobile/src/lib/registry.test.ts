import { ICON_PATHS } from "@unimate/ui/icons";
import { catalogs } from "@unimate/i18n";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PINS, MAX_PINS, MODULES, heroModules, moduleHref, pinnedModules, tabRouteOf, tileLayout, type ModuleEntry } from "./registry";

const lookup = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], catalogs.en);

describe("module registry", () => {
  it("has unique ids and hrefs, real icons and real catalog keys", () => {
    expect(new Set(MODULES.map((m) => m.id)).size).toBe(MODULES.length);
    expect(new Set(MODULES.map((m) => m.href)).size).toBe(MODULES.length);
    for (const m of MODULES) {
      expect(ICON_PATHS[m.icon], m.id).toBeDefined();
      expect(typeof lookup(m.labelKey), `${m.id} label`).toBe("string");
      if (m.hero) {
        expect(typeof lookup(m.hero.bodyKey)).toBe("string");
        expect(typeof lookup(m.hero.ctaKey)).toBe("string");
      }
      expect(m.module || m.tileColors || m.tileOrder === undefined, `${m.id} needs tile colours`).toBeTruthy();
    }
  });
  it("derives tiles and heroes in order, and adding an entry makes it appear everywhere", () => {
    expect(tileLayout().tiles.map((m) => m.id)[0]).toBe("aiStudy");
    const extra: ModuleEntry = { id: "jobs2", href: "/jobs2", icon: "career", module: "career", labelKey: "brand.module.career", tileOrder: 11, hero: { order: 3, bodyKey: "mobile.home.heroAiBody", ctaKey: "mobile.home.heroAiCta" } };
    const all = [...MODULES, extra];
    expect(tileLayout(all).tiles.length + tileLayout(all).overflow.length).toBe(tileLayout().tiles.length + tileLayout().overflow.length + 1);
    expect(heroModules(all).at(-1)?.id).toBe("jobs2");
  });
  it("tab bar: Home + pins (default AI Study, Career, Campus) + More, every module has a tab file", () => {
    expect(pinnedModules(DEFAULT_PINS).map((m) => m.id)).toEqual(["aiStudy", "career", "campus"]);
    expect(pinnedModules(["nope", "planner", "gpa", "focus", "notes"]).map((m) => m.id)).toEqual(["planner", "gpa", "focus"]); // unknown dropped, capped
    expect(MAX_PINS + 2).toBe(5); // iOS shows 5 tabs before its own "More"
    for (const m of MODULES) expect(existsSync(join(__dirname, "../../app/(app)/(tabs)", `${tabRouteOf(m)}.tsx`)), m.id).toBe(true);
  });
  it("Home grid is 3x3: more than 9 tiles become 8 plus an overflow list", () => {
    const extra = (n: number): ModuleEntry => ({ id: `x${n}`, href: `/x${n}`, icon: "campus", module: "campus", labelKey: "brand.module.campus", tileOrder: 20 + n });
    const base = MODULES.filter((m) => m.tileOrder !== undefined).length; // 11 registered tiles
    const all = [...MODULES, extra(1), extra(2), extra(3)];
    const { tiles, overflow } = tileLayout(all);
    expect(tiles).toHaveLength(8);
    expect(overflow).toHaveLength(base + 3 - 8);
    expect(tileLayout(MODULES).tiles.map((m) => m.id)).toEqual(["aiStudy", "quiz", "flashcards", "planner", "courses", "notes", "focus", "budget"]);
  });

  it("opens an unpinned tab module on its stack page, never the hidden tab", () => {
    const career = MODULES.find((m) => m.id === "career")!;
    const budget = MODULES.find((m) => m.id === "budget")!;
    expect(moduleHref(career, ["aiStudy", "campus"])).toBe("/module/career");
    expect(moduleHref(career, ["career"])).toBe("/career");
    expect(moduleHref(budget, [])).toBe("/budget");
  });
});
