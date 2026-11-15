import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";
import { catalogs } from "@unimate/i18n";

/**
 * Static scan: user-facing text in apps/web JSX must come from translation keys.
 * Flags (via a real TSX parse, not regexes):
 *   - JSX text containing letters                         <p>Save</p>
 *   - string literals rendered as JSX children            {ok ? "Yes" : "No"}, {x && "text"}
 *   - literal values of user-facing attributes            aria-label, placeholder, title, alt, label, ...
 *   - literal first argument of toast(...)
 * Strings without letters (symbols, numbers, punctuation) are fine. Test files are skipped.
 */
export interface Violation {
  file: string;
  line: number;
  text: string;
}

const ATTRS = new Set(["aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "aria-valuetext", "placeholder", "title", "alt", "label", "hint", "description", "legend"]);
/** Explicit allowlist: text that is a name or code, not translatable copy. Keep it small and justified. */
const ALLOWED_TEXT = new Set([
  "UNIMATE", // brand name
  "UNIMATE AI", // product/brand name
  "UniMate",
  "XP", // gamification unit shown as-is in all four languages
  "GPA",
  "OCR",
  "PDF",
  "DOCX",
  "PPTX",
  "Ctrl K", // keyboard key names, printed on the keys in every locale
  "Esc",
]);
const ALLOWED_WORDS = [...ALLOWED_TEXT].sort((a, b) => b.length - a.length);
/** Letters left after removing allowlisted names ("© UNIMATE" is fine; "© UNIMATE students" is not). */
const flagged = (s: string) => /\p{L}/u.test(ALLOWED_WORDS.reduce((acc, w) => acc.replaceAll(w, ""), s));
/** Attributes that never carry user-facing prose. Any OTHER attribute holding a multi-word literal is flagged too. */
const NON_PROSE = new Set(["className", "style", "id", "href", "src", "type", "name", "value", "htmlFor", "role", "lang", "key", "rel", "target", "method", "autoComplete", "inputMode", "d", "viewBox", "fill", "stroke", "xmlns", "pattern", "accept", "variant", "size", "tone", "dir", "sizes", "srcSet", "action", "data-theme"]);
const PROSE = /\p{L}+\s+\p{L}+/u;

type N = { type: string; loc?: { start: { line: number } }; [k: string]: unknown };

export function scanSource(code: string, file: string): Violation[] {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true });
  const out: Violation[] = [];
  const add = (n: N, text: string) => out.push({ file, line: n.loc?.start.line ?? 0, text: text.trim().slice(0, 60) });

  /** Literal strings that would be rendered if `expr` is a JSX child. */
  const literalsRendered = (expr: N | null | undefined): Array<[N, string]> => {
    if (!expr) return [];
    if (expr.type === "StringLiteral") return [[expr, expr.value as string]];
    if (expr.type === "TemplateLiteral" && (expr.expressions as unknown[]).length === 0)
      return [[expr, ((expr.quasis as Array<{ value: { cooked: string } }>)[0]?.value.cooked) ?? ""]];
    if (expr.type === "ConditionalExpression") return [...literalsRendered(expr.consequent as N), ...literalsRendered(expr.alternate as N)];
    if (expr.type === "LogicalExpression") return literalsRendered(expr.right as N);
    return [];
  };

  const walk = (node: unknown, parentType: string | null): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((c) => walk(c, parentType));
    const n = node as N;
    if (typeof n.type === "string") {
      if (n.type === "JSXText" && flagged(n.value as string)) add(n, n.value as string);
      if (n.type === "JSXExpressionContainer" && (parentType === "JSXElement" || parentType === "JSXFragment")) {
        for (const [lit, text] of literalsRendered(n.expression as N)) if (flagged(text)) add(lit, text);
      }
      if (n.type === "JSXAttribute") {
        const name = (n.name as { name?: string }).name ?? "";
        const value = n.value as N | null;
        if ((ATTRS.has(name) || (!NON_PROSE.has(name) && !name.startsWith("data-") && PROSE.test(value?.type === "StringLiteral" ? (value.value as string) : ""))) && value) {
          const lits = value.type === "StringLiteral" ? [[value, value.value as string] as [N, string]] : value.type === "JSXExpressionContainer" ? literalsRendered(value.expression as N) : [];
          for (const [lit, text] of lits) if (flagged(text)) add(lit, `${name}="${text}"`);
        }
      }
      if (n.type === "CallExpression") {
        const callee = n.callee as N & { name?: string };
        const first = (n.arguments as N[])[0];
        if (callee.type === "Identifier" && callee.name === "toast" && first) for (const [lit, text] of literalsRendered(first)) if (flagged(text)) add(lit, `toast("${text}")`);
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "extra") walk(v, typeof n.type === "string" ? n.type : parentType);
  };
  walk(ast.program, null);
  return out;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" || name === "node_modules" ? [] : listFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

describe("scanner (self-test)", () => {
  it("flags JSX text, rendered literals, attributes and toast literals", () => {
    const v = scanSource(
      `export const A = () => (<div title="Hello" aria-label={"Close"}><p>Save</p>{ok ? "Yes" : t("a")}{x && "Loading"}<img alt="" /></div>);
       function f(){ toast("Saved", "success"); toast(t("x")); }`,
      "x.tsx",
    );
    expect(v.map((x) => x.text).sort()).toEqual(['Loading', 'Save', 'Yes', 'aria-label="Close"', 'title="Hello"', 'toast("Saved")'].sort());
  });
  it("accepts keys, symbols, numbers, brand names and non-user attributes", () => {
    const v = scanSource(
      `export const A = () => (<div className="box big" id="main" lang="az"><b>UNIMATE</b> <span>—</span><span>{n}%</span><a href="/legal">{t("x")}</a><i>·</i>&nbsp;<p>{"+"}{count} / {total}</p></div>);`,
      "x.tsx",
    );
    expect(v).toEqual([]);
  });
});

describe("hardcoded user-facing strings in apps/web", () => {
  const root = path.resolve(__dirname, "..");
  const files = listFiles(root);
  it("scans a meaningful number of files", () => expect(files.length).toBeGreaterThan(30));
  it("finds none", () => {
    const all = files.flatMap((f) => scanSource(readFileSync(f, "utf8"), path.relative(root, f).replaceAll("\\", "/")));
    expect(all.map((v) => `${v.file}:${v.line}  ${v.text}`)).toEqual([]);
  });
});

describe("catalog completeness (no ru-less key)", () => {
  const keys = (o: unknown, p = ""): string[] => Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : keys(v, `${p}${k}.`)));
  it("ru has every en key", () => {
    const ru = new Set(keys(catalogs.ru));
    expect(keys(catalogs.en).filter((k) => !ru.has(k))).toEqual([]);
  });
});
