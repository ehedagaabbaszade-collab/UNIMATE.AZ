// Builds ONE Supabase auth template per email type that branches on the user's locale (user_metadata.locale):
//   supabase/templates/<type>_<locale>.html  ->  supabase/templates/combined/<type>.html
// Use it when the project cannot use the Send Email Auth Hook. See docs/I18N.md ("Wiring").
// Branch order: tr, en, ru, and az is the final `else`, so a missing/unknown locale renders Azerbaijani (the default).
// `and` short-circuits in Go >= 1.18, which keeps `eq` from running on a missing key. NOT verified against a live Supabase project.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TYPES = ["confirm", "recovery", "magic_link", "invite", "email_change"];
export const BRANCHES = ["tr", "en", "ru"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "templates");

export function combine(type, read = (f) => readFileSync(path.join(dir, f), "utf8")) {
  const cond = (l) => `{{ if and .Data .Data.locale (eq .Data.locale "${l}") }}`;
  const parts = BRANCHES.map((l, i) => `${i === 0 ? "" : "{{ else }}"}${cond(l)}\n${read(`${type}_${l}.html`)}`);
  return `${parts.join("")}{{ else }}\n${read(`${type}_az.html`)}{{ end }}{{ end }}{{ end }}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(path.join(dir, "combined"), { recursive: true });
  for (const type of TYPES) writeFileSync(path.join(dir, "combined", `${type}.html`), combine(type));
  console.log(`wrote ${TYPES.length} combined templates to supabase/templates/combined`);
}
