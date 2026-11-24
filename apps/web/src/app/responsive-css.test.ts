import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((f) => {
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".module.css") ? [p] : [];
  });
const files = [join(__dirname, "globals.css"), join(__dirname, "select.css"), ...walk(join(root, "features"))];

describe("responsive css", () => {
  it.each(files)("no bare fr grid track: %s", (f) => {
    const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const bad = css
      .split("\n")
      .map((l) => l.replace(/minmax\([^()]*(\([^()]*\))?[^()]*\)/g, ""))
      .filter((l) => /grid-template-(columns|rows)|grid-auto-(columns|rows)/.test(l) && /\d\s*fr\b/.test(l));
    expect(bad).toEqual([]);
  });

  it("CV builder classes have no fixed width over 320px; sheet and touch rules exist", () => {
    const css = readFileSync(join(__dirname, "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const fixed = css
      .split("\n")
      .filter((l) => /\.cv[\w-]*/.test(l))
      .filter((l) => [...l.replace(/@media[^{]*/, "").matchAll(/(?<![-\w])(?:min-)?width\s*:\s*(\d+)px/g)].some((m) => Number(m[1]) > 320));
    expect(fixed).toEqual([]);
    expect(css).toContain(".cv-touch label.row { min-height: 44px; }");
    expect(css).toContain(".um-dialog:has(:is(.cv-wide, .cv-sheet)) { width: 100vw;");
  });
});

describe("phone layer", () => {
  const phone = readFileSync(join(__dirname, "phone.css"), "utf8");
  const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
  it("loads after globals.css with viewport-fit=cover", () => {
    expect(layout.indexOf('"./phone.css"')).toBeGreaterThan(layout.indexOf('"./globals.css"'));
    expect(layout).toContain('viewportFit: "cover"');
  });
  it.each([
    ["16px inputs (no iOS zoom)", /font-size:\s*max\(16px, 1em\)/],
    ["44px touch targets", /\.um-btn--sm[^{]*\{\s*min-height:\s*44px/],
    ["safe-area on fixed bars", /\.tabbar\s*\{[^}]*safe-area-inset-left/],
    ["bottom-sheet dialogs", /\.um-dialog:not\([^{]*\{[^}]*max-height:\s*92dvh/],
    ["tables scroll in own box", /\.um-card :where\(table\)[^}]*overflow-x:\s*auto/],
  ])("%s", (_n, re) => expect(phone).toMatch(re));
  it("uses dvh, never 100vh", () => {
    for (const f of files) expect(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\d?\s100vh/);
    expect(phone).not.toMatch(/100vh/);
  });
});
