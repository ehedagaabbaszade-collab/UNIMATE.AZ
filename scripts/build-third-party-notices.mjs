// Collects the production dependency tree of web/admin/mobile (walking node_modules) and writes attribution notices.
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

// Resolve `name` as Node would: nearest node_modules walking up from `from`.
function resolveDir(name, from) {
  for (let d = from; ; d = dirname(d)) {
    const p = join(d, "node_modules", name);
    if (existsSync(join(p, "package.json"))) return realpathSync(p);
    if (dirname(d) === d) return null;
  }
}

const seenDirs = new Set();
const pkgs = new Map(); // name@version -> { dir, pkg }
function visit(dir, record) {
  if (seenDirs.has(dir)) return;
  seenDirs.add(dir);
  const pkg = readJson(join(dir, "package.json"));
  if (record && pkg.name && !pkg.name.startsWith("@unimate/")) pkgs.set(`${pkg.name}@${pkg.version}`, { dir, pkg });
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      const d = resolveDir(dep, dir); // uninstalled optional/peer deps (other platforms) are skipped
      if (d) visit(d, !dep.startsWith("@unimate/"));
    }
  }
}
for (const app of ["web", "admin", "mobile"]) visit(join(root, "apps", app), false);

const licenseOf = (p) => {
  const l = p.license ?? p.licenses;
  if (!l) return "";
  if (typeof l === "string") return l;
  if (Array.isArray(l)) return l.map((x) => x.type ?? x).join(" OR ");
  return l.type ?? "";
};
const urlOf = (p) => {
  let u = typeof p.repository === "string" ? p.repository : p.repository?.url ?? p.homepage ?? "";
  u = u.replace(/^git\+/, "").replace(/^git:\/\//, "https://").replace(/^github:/, "https://github.com/").replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = `https://github.com/${u}`;
  return u.replace(/^ssh:\/\/git@/, "https://").replace(/^git@github\.com:/, "https://github.com/");
};
const textFiles = (dir, re) =>
  readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).map((e) => readFileSync(join(dir, e.name), "utf8").trim());

const list = [...pkgs.values()]
  .map(({ dir, pkg }) => ({
    name: pkg.name, version: pkg.version, license: licenseOf(pkg), url: urlOf(pkg),
    text: textFiles(dir, /^(licen[sc]e|copying)/i), notice: textFiles(dir, /^notice/i),
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

let out = "# Third-party notices\n\nUNIMATE.AZ includes the open-source components listed below. Each is distributed under its own license; the notices are reproduced as required.\n";
for (const p of list) {
  out += `\n---\n\n## ${p.name}@${p.version}\n\nLicense: ${p.license || "UNKNOWN"}\nSource: ${p.url || "n/a"}\n`;
  out += p.text.length ? `\n${p.text.join("\n\n")}\n` : "\n(No license file shipped in the package; license taken from package.json.)\n";
  if (p.notice.length) out += `\nNOTICE:\n\n${p.notice.join("\n\n")}\n`;
}
const compact = JSON.stringify(list.map(({ name, version, license, url }) => ({ name, version, license, url })), null, 1) + "\n";
mkdirSync(join(root, "apps/web/public/licenses"), { recursive: true });
mkdirSync(join(root, "apps/mobile/src/features/legal"), { recursive: true });
writeFileSync(join(root, "THIRD_PARTY_NOTICES.md"), out);
writeFileSync(join(root, "apps/web/public/licenses/THIRD_PARTY_NOTICES.txt"), out);
writeFileSync(join(root, "apps/web/public/licenses/third-party.json"), compact);
writeFileSync(join(root, "apps/mobile/src/features/legal/third-party.json"), compact);

const counts = {};
for (const p of list) counts[p.license || "MISSING"] = (counts[p.license || "MISSING"] ?? 0) + 1;
console.log(`${list.length} packages`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);
const bad = /GPL|MPL|EPL|CC-BY-SA|UNLICENSED|SEE LICENSE|UNKNOWN/i;
const warn = list.filter((p) => !p.license || bad.test(p.license));
console.log(warn.length ? "WARN:" : "WARN: none");
for (const p of warn) console.log(`  ${p.name}@${p.version}\t${p.license || "MISSING"}\t${p.text.length ? "has file" : "no file"}`);
