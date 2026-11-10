import { ICON_PATHS } from "@unimate/ui/icons";
import { catalogs } from "@unimate/i18n";
import { describe, expect, it } from "vitest";
import { MODULES, heroModules, overflowTabModules, tabModules, tileLayout, type ModuleEntry } from "./registry";

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
  it("derives tabs, tiles and heroes in order, and adding an entry makes it appear everywhere", () => {
    expect(tabModules().map((m) => m.tabRoute)).toEqual(["study", "campus", "career"]);
    expect(tileLayout().tiles.map((m) => m.id)[0]).toBe("aiStudy");
    const extra: ModuleEntry = { id: "jobs2", href: "/jobs2", tabRoute: "jobs2", icon: "career", module: "career", labelKey: "brand.module.career", tabOrder: 4, tabPriority: 0, tileOrder: 11, hero: { order: 3, bodyKey: "mobile.home.heroAiBody", ctaKey: "mobile.home.heroAiCta" } };
    const all = [...MODULES, extra];
    expect(tabModules(all).map((m) => m.id)).toEqual(["aiStudy", "campus", "jobs2"]); // capped at 3 module tabs, by priority
    expect(tileLayout(all).tiles.length + tileLayout(all).overflow.length).toBe(tileLayout().tiles.length + 1);
    expect(heroModules(all).at(-1)?.id).toBe("jobs2");
  });
  it("The bar is AI Study, Campus, Career (mockup); Notes and Planner are stack screens, not tabs", () => {
    const campus = MODULES.find((m) => m.id === "campus")!;
    expect(campus).toMatchObject({ href: "/campus", tabRoute: "campus", icon: "campus", module: "campus", labelKey: "brand.module.campus" });
    expect(tabModules().map((m) => m.id)).toEqual(["aiStudy", "campus", "career"]);
    expect(overflowTabModules()).toEqual([]);
    expect(tileLayout().tiles.some((m) => m.id === "planner")).toBe(true); // Planner stays one tap away on the Home grid
    expect(tabModules().length + 2).toBe(5); // Home + 3 modules + Profile
  });
  it("Home grid is 3x3: more than 9 tiles become 8 plus an overflow list", () => {
    const extra = (n: number): ModuleEntry => ({ id: `x${n}`, href: `/x${n}`, icon: "campus", module: "campus", labelKey: "brand.module.campus", tileOrder: 20 + n });
    expect(tileLayout().overflow).toEqual([]);
    const all = [...MODULES, extra(1), extra(2), extra(3)]; // 9 + 3 = 12 tiles
    const { tiles, overflow } = tileLayout(all);
    expect(tiles).toHaveLength(8);
    expect(overflow).toHaveLength(4);
    expect(tileLayout(MODULES).tiles).toHaveLength(9); // exactly 9: no overflow
  });
});
