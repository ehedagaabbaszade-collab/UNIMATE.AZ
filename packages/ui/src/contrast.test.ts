import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS, FILE_TYPES, MODULE_TILES } from "./icons/paths";

const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Body of the first `{ ... }` after `selector {` (token blocks contain no nested braces). */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`block not found: ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = block(":root");
const darkMedia = block(':root:not([data-theme="light"])');
const darkAttr = block(':root[data-theme="dark"]');
const dark = { ...light, ...darkAttr };

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export function luminance(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// [foreground token, background token, minimum ratio]
const TEXT_PAIRS: Array<[string, string, number]> = [
  ["--text", "--bg", 4.5],
  ["--text", "--surface", 4.5],
  ["--text", "--surface-2", 4.5],
  ["--text", "--primary-soft", 4.5],
  ["--text-muted", "--bg", 4.5],
  ["--text-muted", "--surface", 4.5],
  ["--text-muted", "--surface-2", 4.5],
  ["--primary", "--bg", 4.5],
  ["--primary", "--surface", 4.5],
  ["--primary", "--primary-soft", 4.5],
  ["--primary-hover", "--bg", 4.5],
  ["--primary-hover", "--surface", 4.5],
  ["--on-primary", "--primary", 4.5],
  ["--on-primary", "--primary-hover", 4.5],
  ["--on-danger", "--danger", 4.5],
  ["--accent", "--bg", 4.5],
  ["--accent", "--accent-soft", 4.5],
  ["--danger", "--surface", 4.5],
  ["--danger", "--danger-soft", 4.5],
  ["--warning", "--warning-soft", 4.5],
  ["--info", "--info-soft", 4.5],
  ["--nav-text", "--nav-bg", 4.5],
  ["--nav-active-text", "--nav-active-bg", 4.5],
  ["--focus", "--bg", 3],
  ["--focus", "--surface", 3],
];

describe("brand tokens", () => {
  it("match the official board", () => {
    expect(light["--um-indigo"]).toBe(BRAND_COLORS.indigo.toLowerCase());
    expect(light["--um-purple"]).toBe(BRAND_COLORS.purple.toLowerCase());
    expect(light["--um-blue"]).toBe(BRAND_COLORS.blue.toLowerCase());
    expect(light["--um-cyan"]).toBe(BRAND_COLORS.cyan.toLowerCase());
    expect(light["--um-cloud"]).toBe(BRAND_COLORS.cloud.toLowerCase());
    expect(light["--um-mint"]).toBe(BRAND_COLORS.mint.toLowerCase());
    expect(light["--primary"]).toBe("#4f46e5"); // primary is the brand indigo
  });
  it("defines the gradient and icon tokens", () => {
    expect(light["--brand-gradient"]).toMatch(/indigo.*purple.*blue/);
    for (const k of ["--icon-xs", "--icon-sm", "--icon-md", "--icon-lg", "--icon-xl", "--icon-stroke"]) expect(light[k]).toBeTruthy();
    expect(light["--icon-stroke"]).toBe("1.75");
  });
  it("keeps the two dark blocks identical", () => {
    expect(darkMedia).toEqual(darkAttr);
    expect(Object.keys(darkAttr).length).toBeGreaterThan(20);
  });
  it("defines a dark equivalent for every themed colour that changes", () => {
    for (const k of ["--primary", "--primary-hover", "--primary-soft", "--on-primary", "--focus", "--nav-bg"]) expect(darkAttr[k], k).toBeTruthy();
  });
});

describe.each([
  ["light", light],
  ["dark", dark],
] as const)("text contrast (%s theme)", (_name, tokens) => {
  it.each(TEXT_PAIRS)("%s on %s >= %s:1", (fg, bg, min) => {
    const f = tokens[fg];
    const b = tokens[bg];
    expect(f, fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(b, bg).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(f!, b!), `${fg} ${f} on ${bg} ${b}`).toBeGreaterThanOrEqual(min);
  });
});

describe("icon colours", () => {
  it("module tile gradient stops keep >= 3:1 against the white glyph", () => {
    for (const [name, stops] of Object.entries(MODULE_TILES)) for (const c of stops) expect(contrast("#FFFFFF", c), `${name} ${c}`).toBeGreaterThanOrEqual(3);
  });
  it("file tiles that carry a text label keep >= 4.5:1 against white", () => {
    for (const [kind, { color, label }] of Object.entries(FILE_TYPES)) if (label) expect(contrast("#FFFFFF", color), kind).toBeGreaterThanOrEqual(4.5);
  });
  it("documents why blue and cyan are decorative only", () => {
    expect(contrast(BRAND_COLORS.blue, "#FFFFFF")).toBeLessThan(4.5);
    expect(contrast(BRAND_COLORS.cyan, "#FFFFFF")).toBeLessThan(4.5);
  });
});
