// Bundles each Edge Function (workspace packages inlined) into supabase/.build/functions/<name>/index.ts.
// supabase/config.toml [functions.<name>].entrypoint points at these outputs. TypeScript sources stay the source of truth.
import { build } from "esbuild";
import { readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fnDir = join(root, "supabase", "functions");
const out = join(root, "supabase", ".build", "functions");
const npmExternal = { zod: "zod@^4.6.7", fflate: "fflate@^0.8.3", unpdf: "unpdf@^2.1.0", "tesseract.js": "tesseract.js@^7.0.0" };

const denoExternals = {
  name: "deno-externals",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (/^(npm:|jsr:|https?:|node:)/.test(a.path)) return { path: a.path, external: true };
      if (npmExternal[a.path]) return { path: `npm:${npmExternal[a.path]}`, external: true };
      if (a.path.startsWith("zod/")) return { path: `npm:zod@^4.6.7/${a.path.slice(4)}`, external: true };
      return undefined;
    });
  },
};

rmSync(out, { recursive: true, force: true });
const names = readdirSync(fnDir).filter((n) => !n.startsWith("_") && existsSync(join(fnDir, n, "index.ts")) && statSync(join(fnDir, n)).isDirectory());
for (const n of names) {
  await build({
    entryPoints: [join(fnDir, n, "index.ts")],
    outfile: join(out, n, "index.ts"),
    bundle: true, format: "esm", platform: "neutral", target: "esnext",
    mainFields: ["module", "main"], conditions: ["import", "module", "browser"],
    plugins: [denoExternals], logLevel: "warning",
  });
  console.log("built", n);
}
console.log(names.join("\n"));
