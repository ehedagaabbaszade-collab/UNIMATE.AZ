import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

/**
 * Static scan (same idea as apps/web/src/i18n/hardcoded.test.ts): user-facing text in the mobile app must come from
 * catalog keys. Flags, via a real TSX parse: JSX text with letters, string literals rendered as children, and literal
 * values of user-facing props (accessibilityLabel/Hint, placeholder, title, label, hint, description, ...).
 * Also flags literal first arguments of toast()/Alert.alert().
 */
const ATTRS = new Set(["accessibilityLabel", "accessibilityHint", "accessibilityValue", "placeholder", "title", "label", "hint", "description", "aria-label"]);
const ALLOWED = ["UNIMATE.AZ", "UNIMATE", "XP", "GPA", "PDF", "DOCX", "PPTX"].sort((a, b) => b.length - a.length);
const flagged = (s: string) => /\p{L}/u.test(ALLOWED.reduce((acc, w) => acc.replaceAll(w, ""), s));

type N = { type: string; loc?: { start: { line: number } }; [k: string]: unknown };
export interface Violation {
  file: string;
  line: number;
  text: string;
}

export function scanSource(code: string, file: string): Violation[] {
  const ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true });
  const out: Violation[] = [];
  const add = (n: N, text: string) => out.push({ file, line: n.loc?.start.line ?? 0, text: text.trim().slice(0, 60) });
  const literals = (e: N | null | undefined): Array<[N, string]> => {
    if (!e) return [];
    if (e.type === "StringLiteral") return [[e, e.value as string]];
    if (e.type === "TemplateLiteral" && (e.expressions as unknown[]).length === 0) return [[e, (e.quasis as Array<{ value: { cooked: string } }>)[0]?.value.cooked ?? ""]];
    if (e.type === "ConditionalExpression") return [...literals(e.consequent as N), ...literals(e.alternate as N)];
    if (e.type === "LogicalExpression") return literals(e.right as N);
    return [];
  };
  const walk = (node: unknown, parent: string | null): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((c) => walk(c, parent));
    const n = node as N;
    if (typeof n.type === "string") {
      if (n.type === "JSXText" && flagged(n.value as string)) add(n, n.value as string);
      if (n.type === "JSXExpressionContainer" && (parent === "JSXElement" || parent === "JSXFragment")) for (const [l, t] of literals(n.expression as N)) if (flagged(t)) add(l, t);
      if (n.type === "JSXAttribute") {
        const name = (n.name as { name?: string }).name ?? "";
        const v = n.value as N | null;
        if (ATTRS.has(name) && v) {
          const lits = v.type === "StringLiteral" ? ([[v, v.value as string]] as Array<[N, string]>) : v.type === "JSXExpressionContainer" ? literals(v.expression as N) : [];
          for (const [l, t] of lits) if (flagged(t)) add(l, `${name}="${t}"`);
        }
      }
      if (n.type === "CallExpression") {
        const c = n.callee as N & { name?: string; object?: { name?: string }; property?: { name?: string } };
        const first = (n.arguments as N[])[0];
        const isToast = c.type === "Identifier" && c.name === "toast";
        const isAlert = c.type === "MemberExpression" && c.object?.name === "Alert" && c.property?.name === "alert";
        if ((isToast || isAlert) && first) for (const [l, t] of literals(first)) if (flagged(t)) add(l, `${isToast ? "toast" : "Alert"}("${t}")`);
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "extra") walk(v, typeof n.type === "string" ? n.type : parent);
  };
  walk(ast.program, null);
  return out;
}

const root = path.resolve(__dirname, "../..");
function list(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : list(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

describe("mobile hardcoded-string scan", () => {
  it("self-test: flags literals, accepts keys/symbols/brand names", () => {
    const bad = scanSource(`export const A = () => (<View accessibilityLabel="Close" ><Text>Save</Text>{ok ? "Yes" : t("a")}</View>); function f(){ toast("Saved"); Alert.alert("Sure"); }`, "x.tsx");
    expect(bad.map((v) => v.text).sort()).toEqual(['Alert("Sure")', 'Save', 'Yes', 'accessibilityLabel="Close"', 'toast("Saved")'].sort());
    expect(scanSource(`export const A = () => (<View><Text>UNIMATE.AZ</Text><Text>{"→"}</Text><Text>{n}%</Text><Text>{t("x")}</Text></View>);`, "x.tsx")).toEqual([]);
  });
  it("app/ and src/ contain no hardcoded user-facing strings", () => {
    const files = [...list(path.join(root, "app")), ...list(path.join(root, "src"))];
    expect(files.length).toBeGreaterThan(20);
    const v = files.flatMap((f) => scanSource(readFileSync(f, "utf8"), path.relative(root, f)));
    expect(v.map((x) => `${x.file}:${x.line} ${x.text}`)).toEqual([]);
  });
});
