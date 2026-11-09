import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Lint-level PG15 compatibility check. The production target is Postgres 15 (Supabase), but every other test here runs
// on PGlite = PG18 (superuser migrations). That cannot catch PG16/17/18-only syntax, so this scanner rejects it.
// It is a heuristic text scan, NOT a PG15 parse: see docs/POSTGRES15.md for what it does and does not prove.

const supabaseDir = path.resolve(__dirname, "../../../supabase");

/** Removes comments and the CONTENT of single-quoted strings so prose/copy cannot trigger (or hide) findings. */
export function stripNoise(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (two === "/*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") (depth++, (i += 2));
        else if (sql.slice(i, i + 2) === "*/") (depth--, (i += 2));
        else i++;
      }
      out += " ";
    } else if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out += "''";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Rule {
  name: string;
  since: string;
  re: RegExp;
}
const RULES: Rule[] = [
  // PG16
  { name: "any_value()", since: "PG16", re: /\bany_value\s*\(/i },
  { name: "pg_input_is_valid()/pg_input_error_info()", since: "PG16", re: /\bpg_input_(is_valid|error_info)\s*\(/i },
  { name: "JSON_ARRAY / JSON_ARRAYAGG / JSON_OBJECTAGG / JSON_SCALAR / JSON_SERIALIZE constructors", since: "PG16", re: /\bjson_(array|arrayagg|objectagg|scalar|serialize)\s*\(/i },
  { name: "JSON_OBJECT( ... VALUE / ON NULL ) constructor syntax", since: "PG16", re: /\bjson_object\s*\([^)]*(\bvalue\b|\b(absent|null)\s+on\s+null\b|\bwith(out)?\s+unique\b|\bformat\s+json\b)/i },
  { name: "IS [NOT] JSON predicate", since: "PG16", re: /\bis\s+(not\s+)?json(\s+(value|array|object|scalar))?\b/i },
  { name: "SYSTEM_USER", since: "PG16", re: /\bsystem_user\b/i },
  { name: "numeric literal underscores (1_000)", since: "PG16", re: /(?<![\w.])\d+(?:_\d+)+(?![\w])/ },
  { name: "0x / 0o / 0b integer literals", since: "PG16", re: /(?<![\w.])0[xob][0-9a-f_]+(?![\w])/i },
  { name: "GRANT ... WITH INHERIT / SET option", since: "PG16", re: /\bwith\s+(inherit|set)\s+(option|true|false)\b/i },
  // PG17
  { name: "MERGE ... RETURNING", since: "PG17", re: /\bmerge\s+into\b[^;]*\breturning\b/is },
  { name: "WHEN NOT MATCHED BY SOURCE/TARGET", since: "PG17", re: /\bwhen\s+not\s+matched\s+by\s+(source|target)\b/i },
  { name: "JSON_TABLE / JSON_EXISTS / JSON_QUERY / JSON_VALUE", since: "PG17", re: /\bjson_(table|exists|query|value)\s*\(/i },
  { name: "MAINTAIN privilege / pg_maintain", since: "PG17", re: /\b(grant|revoke)\b[^;]*\bmaintain\b|\bpg_maintain\b/is },
  { name: "WITHOUT OVERLAPS / PERIOD", since: "PG17", re: /\bwithout\s+overlaps\b/i },
  { name: "random(min, max)", since: "PG17", re: /\brandom\s*\(\s*[^)\s]/i },
  { name: "to_bin() / to_oct()", since: "PG17", re: /\bto_(bin|oct)\s*\(/i },
  { name: "COPY ... ON_ERROR / LOG_VERBOSITY", since: "PG17", re: /\bon_error\b|\blog_verbosity\b/i },
  // PG18 (tests run on PG18, so these would pass locally and break on 15)
  { name: "uuidv7() / uuidv4()", since: "PG18", re: /\buuidv[47]\s*\(/i },
  { name: "RETURNING old./new.", since: "PG18", re: /\breturning\b[^;]*\b(old|new)\s*\./is },
  { name: "NOT ENFORCED constraints", since: "PG18", re: /\bnot\s+enforced\b/i },
  { name: "array_sort() / casefold()", since: "PG18", re: /\b(array_sort|casefold)\s*\(/i },
  // Valid in PG15 but banned by project policy (conservative; kept off the "PG16+" list on purpose)
  { name: "NULLS NOT DISTINCT (valid since PG15; banned conservatively)", since: "policy", re: /\bnulls\s+not\s+distinct\b/i },
  { name: "MERGE (valid since PG15; banned conservatively)", since: "policy", re: /(^|[;\s])merge\s+into\b/i },
  { name: "jsonb_exists() (valid in PG15 as a function; banned conservatively)", since: "policy", re: /\bjsonb_exists(_any|_all)?\s*\(/i },
];

/** PG18 defaults GENERATED ... AS (expr) to VIRTUAL; PG15 only knows STORED. Require an explicit STORED. */
function virtualGenerated(code: string): string[] {
  const found: string[] = [];
  const re = /\bgenerated\s+always\s+as\s*\(/gi;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < code.length && depth > 0) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
      i++;
    }
    if (!/^\s*stored\b/i.test(code.slice(i))) found.push(code.slice(m.index, Math.min(code.length, i + 20)).replace(/\s+/g, " "));
  }
  return found;
}

export function lintPg15(sql: string): string[] {
  const code = stripNoise(sql);
  const findings: string[] = [];
  for (const r of RULES) if (r.re.test(code)) findings.push(`${r.name} [${r.since}]`);
  for (const v of virtualGenerated(code)) findings.push(`GENERATED ALWAYS AS without STORED (PG18 virtual): ${v} [PG18]`);
  return findings;
}

describe("PG15 lint scanner (self-test, so a silent no-op scanner cannot pass)", () => {
  const bad: [string, string][] = [
    ["any_value", "select any_value(x) from t"],
    ["pg_input_is_valid", "select pg_input_is_valid('1', 'int')"],
    ["json_array", "select json_array(1, 2)"],
    ["json_arrayagg", "select json_arrayagg(x) from t"],
    ["json_object value", "select json_object('a' value 1)"],
    ["json_object on null", "select json_object('a': 1 absent on null)"],
    ["is json", "select x is json from t"],
    ["numeric underscores", "select 1_000_000"],
    ["hex literal", "select 0x1F"],
    ["merge returning", "merge into t using s on t.id = s.id when matched then update set a = 1 returning t.id;"],
    ["merge by source", "merge into t using s on true when not matched by source then delete;"],
    ["json_table", "select * from json_table('[]', '$' columns (a int path '$'))"],
    ["json_value", "select json_value(j, '$.a') from t"],
    ["maintain", "grant maintain on t to r"],
    ["without overlaps", "create table t (a int, primary key (a without overlaps))"],
    ["random(min,max)", "select random(1, 10)"],
    ["uuidv7", "select uuidv7()"],
    ["returning old", "update t set a = 1 returning old.a"],
    ["virtual generated", "create table t (a int, b int generated always as (a * 2))"],
    ["nulls not distinct", "create unique index i on t (a) nulls not distinct"],
    ["merge (plain)", "merge into t using s on true when matched then delete"],
    ["jsonb_exists", "select jsonb_exists(j, 'a')"],
    ["system_user", "select system_user"],
  ];
  it.each(bad)("flags %s", (_n, sql) => {
    expect(lintPg15(sql).length).toBeGreaterThan(0);
  });
  const good: [string, string][] = [
    ["stored generated column", "create table t (a int, b int generated always as (a * 2) stored)"],
    ["identity column", "id bigint generated always as identity primary key"],
    ["to_jsonb / jsonb_build_object", "select to_jsonb(t), jsonb_build_object('a', 1) from t"],
    ["legacy json_object(text[])", "select json_object('{a,1,b,2}')"],
    ["random()", "select random()"],
    ["on conflict + returning", "insert into t values (1) on conflict do nothing returning id"],
    ["names with underscores and digits", "select col_1_000, t2_3 from table_1_2"],
    ["words only inside comments", "-- any_value(x) and uuidv7() and merge into\nselect 1 /* is json 0x1F */"],
    ["words only inside string literals", "insert into t values ('any_value(x) MERGE INTO 1_000 maintain')"],
    ["returning with plain columns", "update t set a = 1 returning a, b"],
    ["grant select", "grant select on t to r"],
    ["jsonb_typeof", "select jsonb_typeof(x)"],
    ["with check option style words", "create policy p on t for select using (true) with check (true)"],
  ];
  it.each(good)("does not flag %s", (_n, sql) => {
    expect(lintPg15(sql)).toEqual([]);
  });
});

describe("repository SQL is PG15-clean", () => {
  const dir = path.join(supabaseDir, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  it("finds the migrations (guards against scanning nothing)", () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
  });
  it.each(files)("%s has no PG16+/PG18-only constructs", (f) => {
    expect(lintPg15(readFileSync(path.join(dir, f), "utf8")), f).toEqual([]);
  });
  it("seed.sql too", () => {
    expect(lintPg15(readFileSync(path.join(supabaseDir, "seed.sql"), "utf8"))).toEqual([]);
  });
});
