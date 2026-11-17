import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_PREF, contrast, palettes, resolveMode } from "./tokens";
import { CONTENT_MAX, contentWidth, gridColumns, heroFontSize } from "./tokens";

describe("theme tokens", () => {
  it("defaults to dark (the approved mockup look) and resolves system", () => {
    expect(DEFAULT_THEME_PREF).toBe("system");
    expect(resolveMode("system", "light")).toBe("light");
    expect(resolveMode("system", null)).toBe("dark");
    expect(resolveMode("light", "dark")).toBe("light");
  });
  it("body text pairs reach 4.5:1 in both themes", () => {
    for (const p of Object.values(palettes)) {
      expect(contrast(p.text, p.bgGradient[0]), `${p.mode} text/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.text, p.bgGradient[2]), `${p.mode} text/bg end`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textMuted, p.bgGradient[0]), `${p.mode} muted/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textMuted, p.bgGradient[2]), `${p.mode} muted/bg end`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("button label contrast and brand primary (light) are accessible", () => {
    expect(contrast(palettes.light.onPrimary, palettes.light.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palettes.dark.onPrimary, palettes.dark.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palettes.dark.active, palettes.dark.bgGradient[0])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palettes.light.active, palettes.light.bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("responsive layout", () => {
  it("scales the hero title between small phones and tablets", () => {
    expect(heroFontSize(320)).toBe(35);
    expect(heroFontSize(390)).toBe(42);
    expect(heroFontSize(1024)).toBe(48);
    expect(heroFontSize(200)).toBe(32);
  });
  it("caps content width and adds grid columns on wide screens", () => {
    expect(contentWidth(375)).toBe(343);
    expect(contentWidth(1024)).toBe(CONTENT_MAX);
    expect([contentWidth(320), contentWidth(430), contentWidth(820)].map(gridColumns)).toEqual([3, 3, 5]);
    expect(gridColumns(500)).toBe(4);
  });
});
