# PostgreSQL 15 compatibility

**Plainly: the tests ran on PGlite, which is PostgreSQL 18. PostgreSQL 15 behaviour has NOT been executed anywhere in this
project. It is only lint-checked.** The production target is Postgres 15 (`supabase/config.toml`: `major_version = 15`).

## What was and was not verified
| Claim | Evidence |
| - | - |
| Migrations apply and behave correctly | PGlite (PG18, superuser migrations, stub `auth` / `storage` schemas). Not PG15, not hosted roles |
| Migrations contain no syntax/functions newer than PG15 | `packages/db/src/pg15_compat.test.ts`: text scan of every migration and `seed.sql` (comments and string literals stripped) |
| Behaviour differences between PG15 and PG18 (planner, error texts, catalog columns, `pg_get_functiondef` output, default of GENERATED columns, `MERGE`/`JSON` semantics) | **Not checked.** Only construct-level linting |
| Hosted Supabase roles, `pg_cron`, extension versions, real Storage/GoTrue | Not checked |

Before launch, run the full migration set (and ideally the db tests against a real database) on a PG15 instance, for example
`supabase start` (it honours `major_version = 15`) or a Postgres 15 container. Treat the first such run as a required step.

## What the lint rejects
Grouped by the release that introduced the construct. Rule list and self-tests live in `pg15_compat.test.ts`
(the self-tests prove the scanner flags a bad snippet for every rule and does not flag comments, string literals or look-alikes).

- **PG16:** `any_value()`, `pg_input_is_valid()` / `pg_input_error_info()`, SQL/JSON constructors (`JSON_ARRAY`, `JSON_ARRAYAGG`,
  `JSON_OBJECTAGG`, `JSON_SCALAR`, `JSON_SERIALIZE`, `JSON_OBJECT(... VALUE ... / ON NULL ...)`), `IS [NOT] JSON`, `SYSTEM_USER`,
  numeric literal underscores (`1_000`), `0x` / `0o` / `0b` literals, `GRANT ... WITH INHERIT / SET`.
- **PG17/18** (temporal `WITHOUT OVERLAPS` may actually be PG18; banned either way): `MERGE ... RETURNING`, `WHEN NOT MATCHED BY SOURCE/TARGET`, `JSON_TABLE` / `JSON_EXISTS` / `JSON_QUERY` / `JSON_VALUE`,
  the `MAINTAIN` privilege / `pg_maintain`, `WITHOUT OVERLAPS`, `random(min, max)`, `to_bin` / `to_oct`, `COPY ... ON_ERROR`.
- **PG18** (the test engine accepts these, so they would pass locally and fail on 15): `uuidv7()` / `uuidv4()`,
  `RETURNING old.` / `new.`, `NOT ENFORCED`, `array_sort()` / `casefold()`, and `GENERATED ALWAYS AS (expr)` **without an explicit
  `STORED`** (PG18 defaults it to VIRTUAL; PG15 only has STORED).
- **Policy bans that are valid on PG15** (kept off the "PG16+" list on purpose, banned conservatively so a later PG-version
  assumption cannot sneak in): `NULLS NOT DISTINCT` (added in PG15), plain `MERGE` (added in PG15), `jsonb_exists()` (callable in PG15).
  Remove them from the rule list if you decide to use them.

## Limits of the scan
It is a regular-expression heuristic over text, not a PG15 parser: it cannot catch a PG16+ function it does not know about,
catalog columns that only exist in newer versions (e.g. in a `pg_catalog` query), changed behaviour of an old function, or
dynamic SQL assembled at runtime. Add a rule whenever a new construct is found.
