import { bcp47, type Locale } from "./locales";

/** Values accepted by message arguments. */
export type Params = Readonly<Record<string, string | number>>;

/**
 * ICU-lite message syntax:
 *   {name}                                         simple argument
 *   {n, plural, =0 {none} one {# item} other {# items}}   plural (# = the number, locale formatted)
 *   {g, select, f {her} other {their}}             select
 * Plural categories come from Intl.PluralRules: az/tr/en use one|other, ru uses one|few|many|other.
 * Single pass: substituted values are never re-scanned. Unknown / missing arguments stay as written.
 */
type Node =
  | { t: "text"; v: string }
  | { t: "arg"; name: string; raw: string }
  | { t: "choice"; kind: "plural" | "select"; name: string; options: Map<string, Node[]>; raw: string };

const cache = new Map<string, Node[]>();

function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function parse(s: string): Node[] {
  const hit = cache.get(s);
  if (hit) return hit;
  const nodes: Node[] = [];
  let text = "";
  let i = 0;
  const flush = () => {
    if (text) nodes.push({ t: "text", v: text });
    text = "";
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch !== "{") {
      text += ch;
      i++;
      continue;
    }
    const end = matchBrace(s, i);
    if (end < 0) {
      text += s.slice(i);
      break;
    }
    const raw = s.slice(i, end + 1);
    const inner = s.slice(i + 1, end);
    const simple = /^\s*(\w+)\s*$/.exec(inner);
    const choice = /^\s*(\w+)\s*,\s*(plural|select)\s*,([\s\S]*)$/.exec(inner);
    if (simple) {
      flush();
      nodes.push({ t: "arg", name: simple[1]!, raw });
    } else if (choice) {
      const options = parseOptions(choice[3]!);
      if (options?.has("other")) {
        flush();
        nodes.push({ t: "choice", kind: choice[2] as "plural" | "select", name: choice[1]!, options, raw });
      } else text += raw;
    } else text += raw;
    i = end + 1;
  }
  flush();
  if (cache.size > 2000) cache.clear();
  cache.set(s, nodes);
  return nodes;
}

function parseOptions(s: string): Map<string, Node[]> | null {
  const out = new Map<string, Node[]>();
  let i = 0;
  while (i < s.length) {
    const m = /^\s*(=\d+|\w+)\s*\{/.exec(s.slice(i));
    if (!m) return /^\s*$/.test(s.slice(i)) ? out : null;
    const open = i + m[0].length - 1;
    const close = matchBrace(s, open);
    if (close < 0) return null;
    out.set(m[1]!, parse(s.slice(open + 1, close)));
    i = close + 1;
  }
  return out;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();
const rules = (l: Locale) => {
  let r = pluralRules.get(l);
  if (!r) pluralRules.set(l, (r = new Intl.PluralRules(bcp47(l))));
  return r;
};

/** Plural category for `n` in `locale` (one|few|many|other|zero|two). */
export const pluralCategory = (locale: Locale, n: number): Intl.LDMLPluralRule => rules(locale).select(n);

function render(nodes: Node[], locale: Locale, params: Params, hash: string | null): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += hash === null ? n.v : n.v.replaceAll("#", hash);
    else if (n.t === "arg") out += Object.hasOwn(params, n.name) ? String(params[n.name]) : n.raw;
    else if (!Object.hasOwn(params, n.name)) out += n.raw;
    else if (n.kind === "plural") {
      const num = Number(params[n.name]);
      const opt = n.options.get(`=${num}`) ?? n.options.get(pluralCategory(locale, num)) ?? n.options.get("other")!;
      out += render(opt, locale, params, new Intl.NumberFormat(bcp47(locale)).format(num));
    } else {
      const opt = n.options.get(String(params[n.name])) ?? n.options.get("other")!;
      out += render(opt, locale, params, hash);
    }
  }
  return out;
}

export function formatMessage(template: string, locale: Locale, params?: Params): string {
  if (!params) return template;
  // "#" is only special inside plural options (render() gets the formatted number as `hash`).
  return render(parse(template), locale, params, null);
}

/** Names of all arguments a template uses (including those nested in plural/select options), sorted. */
export function messageArgs(template: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.t === "text") continue;
      names.add(n.name);
      if (n.t === "choice") for (const o of n.options.values()) walk(o);
    }
  };
  walk(parse(template));
  return [...names].sort();
}
