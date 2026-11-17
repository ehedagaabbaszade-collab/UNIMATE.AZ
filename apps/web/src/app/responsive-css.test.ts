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
});
