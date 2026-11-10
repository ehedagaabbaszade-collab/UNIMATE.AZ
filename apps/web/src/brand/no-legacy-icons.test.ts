import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
const isTest = (p: string) => /\.test\.[tj]sx?$/.test(p);

const WEB = walk(join(ROOT, "apps/web/src")).filter((p) => /\.(tsx?|css)$/.test(p) && !isTest(p));
const UI = walk(join(ROOT, "packages/ui/src")).filter((p) => /\.(tsx?|css)$/.test(p) && !isTest(p));
const ALL = [...WEB, ...UI];
const read = (p: string) => readFileSync(p, "utf8");

describe("no legacy icons remain (one icon per function: packages/ui/src/icons)", () => {
  it("the old apps/web icon module is gone", () => {
    expect(existsSync(join(ROOT, "apps/web/src/components/icons.tsx"))).toBe(false);
  });
  it("nothing imports it or the old LogoMark", () => {
    for (const p of ALL) {
      const src = read(p);
      expect(src, rel(p)).not.toMatch(/components\/icons["']/);
      expect(src, rel(p)).not.toMatch(/\bLogoMark\b|\b(Home|Docs|Cards|Planner|Focus|Gpa|Settings|Upload|SignOut)Icon\b/);
    }
  });
  it("apps/web has no inline <svg> (use <Icon name=... />)", () => {
    for (const p of WEB) expect(read(p), rel(p)).not.toMatch(/<svg\b/);
  });
  it("packages/ui draws svg only in icons/Icon.tsx and the ProgressRing", () => {
    for (const p of UI) {
      const r = rel(p);
      if (r === "packages/ui/src/icons/Icon.tsx" || r === "packages/ui/src/primitives.tsx") continue;
      expect(read(p), r).not.toMatch(/<svg\b/);
    }
    // primitives.tsx: exactly one svg (ProgressRing)
    expect((read(join(ROOT, "packages/ui/src/primitives.tsx")).match(/<svg\b/g) ?? []).length).toBe(1);
  });
  it("no glyph characters or emoji used as icons in components", () => {
    const GLYPHS = /[×✓✔✕✗✘✖★☆▶►◀▲▼⚠⭐❌✅❤♥🔥🏆🎓📅📄📁🔔⚙]/u;
    for (const p of ALL.filter((f) => f.endsWith(".tsx"))) expect(read(p), rel(p)).not.toMatch(GLYPHS);
  });
  it("legacy pre-brand colours are gone from styles and components", () => {
    for (const p of ALL) expect(read(p), rel(p)).not.toMatch(/#6d5dfb|#4a3fd0|#5a48f0|#8b7eff/i);
  });
});
