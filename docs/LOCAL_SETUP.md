# Local setup

Legend: **[RUN]** executed during development; **[NOT RUN]** written from repo config and scripts, never executed here.

## Prerequisites
- Node 24 and npm (CI in `.github/workflows/ci.yml` uses Node 24).
- Supabase CLI and Docker for the local stack. **[NOT RUN]**
- Deno, only to serve or type-check edge functions. **[NOT RUN]**

## Install and test [RUN]
```
npm install
npm test            # vitest run
npm run typecheck
npm run lint        # installs tools/lint first
npm run perf        # optional
```
Last recorded result: 129 test files / 1845 tests pass, typecheck clean, lint exit 0.

## Local Supabase stack [NOT RUN]
`supabase/config.toml` targets Postgres 15.
```
supabase start      # applies supabase/migrations in filename order, then supabase/seed.sql
supabase db reset   # re-apply migrations and seed from scratch
```
Migrations are timestamp-ordered, from `20260101000100_extensions_enums.sql` to `20260101004800_admin_console_hardening.sql`. `seed.sql` loads university names only (no users, jobs or other data) and runs only on local `db reset`, not on hosted `db push`. The first run on real PG15 is a required verification ([POSTGRES15.md](POSTGRES15.md)); the repo's DB tests ran on PGlite (PG18).

## Environment variables
`.env.example` at the root is the reference list (never commit values). Per app:
| File | Variables |
| - | - |
| `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the code also reads `NEXT_PUBLIC_SITE_URL` (CI sets it) |
| `apps/admin/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `apps/mobile/.env` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |

URL and anon key come from `supabase status`. Edge-function secrets (service role, `WORKER_SECRET`, `ALLOWED_ORIGIN`, `AI_*`) are server-side only: see [DEPLOYMENT.md](DEPLOYMENT.md) and [AI_PROVIDERS.md](AI_PROVIDERS.md). Without `AI_API_KEY`, AI calls return `ai_not_configured`.

## Run the apps [NOT RUN against a live backend]
```
npm run dev -w @unimate/web        # http://localhost:3000
npm run dev -w @unimate/admin      # http://localhost:3001
npm run start -w @unimate/mobile   # Expo dev server (needs a dev build or Expo Go; see apps/mobile/README.md)
```
Mobile auth: add `unimate://auth/callback` to the Supabase Auth redirect URLs. Edge functions locally: `supabase functions serve` **[NOT RUN]**; they need `ALLOWED_ORIGIN` set.

## Production builds
`npm run build` (web, admin) and `npx expo export --platform android|ios` in `apps/mobile` built OK with placeholder public env values. Not run against a real backend.
