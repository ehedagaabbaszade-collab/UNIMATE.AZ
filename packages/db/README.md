# @unimate/db

Migration and RLS tests, run with `npx vitest run packages/db`. Migrations in `supabase/migrations` are applied to an
in-process PGlite database with minimal Supabase stubs (roles, `auth.uid()`, storage schema).

## Limitations of the test engine

- PGlite is actually **Postgres 18**, while production targets **Postgres 15**. PG16+ syntax passes here but must not be
  used in migrations; review new migrations for that by hand.
- Migrations run as a **superuser** here. On hosted Supabase they run as `postgres` (not a superuser), so ownership,
  `GRANT`/`REVOKE`, and `ALTER` on supabase-owned schemas (`storage`, `auth`) can behave differently. Tests drop to
  `anon`/`authenticated`/`service_role` via `SET LOCAL ROLE`, but the storage and auth schemas are stubs.

## Seed data

`supabase/seed.sql` does **not** run on a hosted `supabase db push` (only on local `db reset`). Data needed in production
(e.g. the universities list) must be a migration: see `20260101001300_seed_universities.sql`, which mirrors `seed.sql`.
