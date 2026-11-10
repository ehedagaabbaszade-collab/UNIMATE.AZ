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
    expect(tabModules().map((m) => m.tabRoute)).toEqual(["study", "planner"]);
    expect(tileLayout().tiles.map((m) => m.id)[0]).toBe("aiStudy");
    const campus: ModuleEntry = { id: "campus", href: "/campus", tabRoute: "campus", icon: "campus", module: "campus", labelKey: "brand.module.campus", tabOrder: 2, tabPriority: 2, tileOrder: 5, hero: { order: 3, bodyKey: "mobile.home.heroAiBody", ctaKey: "mobile.home.heroAiCta" } };
    const all = [...MODULES, campus];
    expect(tabModules(all).map((m) => m.id)).toEqual(["aiStudy", "campus", "planner"]);
    expect(tileLayout(all).tiles.map((m) => m.id)).toContain("campus");
    expect(heroModules(all).at(-1)?.id).toBe("campus");
  });
  it("keeps the bar at 5 tabs (Home + 3 modules + Profile): Planner gives way, and its file is declared hidden", () => {
    const mk = (id: string, order: number, priority: number, tile: number): ModuleEntry => ({ id, href: `/${id}`, tabRoute: id, icon: "campus", module: "campus", labelKey: "brand.module.campus", tabOrder: order, tabPriority: priority, tileOrder: tile });
    const all = [...MODULES, mk("campus", 2, 2, 5), mk("career", 3, 3, 7)];
    expect(tabModules(all).map((m) => m.id)).toEqual(["aiStudy", "campus", "career"]);
    expect(overflowTabModules(all).map((m) => m.id)).toEqual(["planner"]);
  });
  it("Home grid is 3x3: more than 9 tiles become 8 plus an overflow list", () => {
    const extra = (n: number): ModuleEntry => ({ id: `x${n}`, href: `/x${n}`, icon: "campus", module: "campus", labelKey: "brand.module.campus", tileOrder: 20 + n });
    expect(tileLayout().overflow).toEqual([]);
    const all = [...MODULES, extra(1), extra(2), extra(3)]; // 7 + 3 = 10 tiles
    const { tiles, overflow } = tileLayout(all);
    expect(tiles).toHaveLength(8);
    expect(overflow).toHaveLength(2);
    expect(tileLayout([...MODULES, extra(1), extra(2)]).tiles).toHaveLength(9); // exactly 9: no overflow
  });
  it("never lists planned modules before their screens exist", () => {
    for (const id of ["campus", "notes", "career"]) expect(MODULES.some((m) => m.id === id)).toBe(false);
  });
});
