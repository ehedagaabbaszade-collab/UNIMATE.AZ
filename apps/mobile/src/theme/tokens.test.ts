import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_PREF, contrast, palettes, resolveMode } from "./tokens";

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
