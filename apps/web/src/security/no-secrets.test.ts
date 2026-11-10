// Guards the rule "the web app only ever uses the public anon key": no service-role / secret key material may be
// referenced in apps/web source, env files, or the built output (.next). Run `npm run build -w apps/web` first to
// include the build scan; without a build the .next scan is skipped (and says so).
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(__dirname, "..", "..");
const SELF = path.resolve(__dirname, "no-secrets.test.ts");

// Patterns are assembled from fragments so this file never contains the literal strings it forbids.
const j = (...p: string[]) => p.join("");
const FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: "service-role env var", re: new RegExp(j("SUPABASE_", "SERVICE", "_ROLE"), "i") },
  { name: "service_role identifier", re: new RegExp(j("service", "_role"), "i") },
  { name: "service-role (hyphen/camel)", re: new RegExp(j("service", "[-]?", "Role"), "i") },
  { name: "new-style secret key prefix", re: new RegExp(j("sb_", "secret", "_")) },
  { name: "database connection string", re: new RegExp(j("postgres(ql)?", ":\\/\\/[^\\s\"']+:[^\\s\"']+@")) },
  { name: "worker secret", re: new RegExp(j("WORKER", "_SECRET")) },
  { name: "provider API key var", re: new RegExp(j("(OPENAI|ANTHROPIC|GEMINI)", "_API_KEY")) },
];
// The built output also contains third-party library code (supabase-js itself refuses secret keys in browsers, so its
// bundle legitimately mentions the key prefix and role names). For .next we therefore check for secret VALUES and
// env-var names rather than bare identifiers.
const BUILD_FORBIDDEN: Array<{ name: string; re: RegExp }> = [
  { name: "service-role env var", re: new RegExp(j("SUPABASE_", "SERVICE", "_ROLE"), "i") },
  { name: "new-style secret key value", re: new RegExp(j("sb_", "secret", "_[A-Za-z0-9_-]{16,}")) },
  { name: "database connection string", re: new RegExp(j("postgres(ql)?", "://[^\\s\"']+:[^\\s\"']+@")) },
  { name: "worker secret", re: new RegExp(j("WORKER", "_SECRET")) },
  { name: "provider API key var", re: new RegExp(j("(OPENAI|ANTHROPIC|GEMINI)", "_API_KEY")) },
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function* walk(dir: string, skip: (p: string) => boolean): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (skip(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, skip);
    else yield full;
  }
}

function scanFile(file: string, patterns = FORBIDDEN): string[] {
  const text = readFileSync(file, "utf8");
  const hits: string[] = [];
  for (const { name, re } of patterns) if (re.test(text)) hits.push(`${name} in ${path.relative(WEB_ROOT, file)}`);
  for (const m of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(m[0].split(".")[1]!, "base64url").toString("utf8")) as { role?: string };
      if (payload.role && payload.role !== "anon") hits.push(`JWT with role "${payload.role}" in ${path.relative(WEB_ROOT, file)}`);
    } catch {
      /* not a JWT */
    }
  }
  return hits;
}

const TEXT_EXT = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".html", ".txt", ".rsc", ".map", ".md", ".mts"]);

describe("no service-role or secret material in apps/web", () => {
  it("source files", () => {
    const hits: string[] = [];
    for (const f of walk(path.join(WEB_ROOT, "src"), () => false)) {
      if (path.resolve(f) === SELF || !TEXT_EXT.has(path.extname(f))) continue;
      hits.push(...scanFile(f));
    }
    expect(hits).toEqual([]);
  });

  it("config and env files", () => {
    const hits: string[] = [];
    for (const name of readdirSync(WEB_ROOT)) {
      const full = path.join(WEB_ROOT, name);
      if (!statSync(full).isFile()) continue;
      if (name.startsWith(".env") || name.endsWith(".mjs") || name.endsWith(".json")) hits.push(...scanFile(full));
    }
    expect(hits).toEqual([]);
  });

  const NEXT_DIR = path.join(WEB_ROOT, ".next");
  const hasBuild = existsSync(path.join(NEXT_DIR, "BUILD_ID"));
  it.skipIf(!hasBuild)("build output (.next) [skipped when there is no build: run `npm run build -w apps/web`]", () => {
    const hits: string[] = [];
    const skip = (p: string) => /[\\/]\.next[\\/](cache|dev|trace)/.test(p) || p.endsWith("trace");
    for (const f of walk(NEXT_DIR, skip)) {
      if (!TEXT_EXT.has(path.extname(f)) || statSync(f).size > 15 * 1024 * 1024) continue;
      hits.push(...scanFile(f, BUILD_FORBIDDEN));
    }
    expect(hits).toEqual([]);
  });

  it("only the public env vars (Supabase URL/anon key, site URL) are read from process.env in app source", () => {
    const allowed = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SITE_URL", "NODE_ENV"]);
    const bad: string[] = [];
    for (const f of walk(path.join(WEB_ROOT, "src"), () => false)) {
      if (path.resolve(f) === SELF || ![".ts", ".tsx"].includes(path.extname(f))) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!allowed.has(m[1]!)) bad.push(`${m[1]} in ${path.relative(WEB_ROOT, f)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("scanner self-check (it must actually catch leaks)", () => {
  const plant = (content: string) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "um-scan-"));
    const file = path.join(dir, "x.js");
    writeFileSync(file, content);
    return file;
  };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  it("flags a privileged env var, a secret key value and a service JWT", () => {
    expect(scanFile(plant(j("process.env.SUPABASE_", "SERVICE", "_ROLE_KEY")), BUILD_FORBIDDEN).length).toBeGreaterThan(0);
    expect(scanFile(plant(j("sb_", "secret", "_abcdefghijklmnopqrstuvwx")), BUILD_FORBIDDEN).length).toBeGreaterThan(0);
    const jwt = `${b64({ alg: "HS256" })}.${b64({ role: j("service", "_role"), iss: "supabase" })}.abcdefghijklmnop`;
    expect(scanFile(plant(`const k="${jwt}"`), BUILD_FORBIDDEN).join()).toContain("JWT with role");
  });
  it("accepts an anon JWT", () => {
    const jwt = `${b64({ alg: "HS256" })}.${b64({ role: "anon", iss: "supabase" })}.abcdefghijklmnop`;
    expect(scanFile(plant(`const k="${jwt}"`), BUILD_FORBIDDEN)).toEqual([]);
  });
});
