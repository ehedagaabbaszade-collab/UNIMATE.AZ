# Deployment

Nothing here has been executed: no Supabase project exists and nothing was deployed. Each step needs your accounts and approval.

## 1. Supabase project
1. Create a project on Postgres 15 (matches `supabase/config.toml`). Read [POSTGRES15.md](POSTGRES15.md): migrations were only tested on PGlite (PG18). Run the full set on real PG15 first (`supabase start`); this is required.
2. `supabase link --project-ref <ref>`, then `supabase db push` (applies `supabase/migrations/*` in order). `seed.sql` does NOT run on hosted; universities come from migration `20260101001300_seed_universities.sql` and the directory migrations. Faculties and majors are not seeded: an admin must add them.
3. Auth: set Site URL and redirect URLs (web origin, admin origin, `unimate://auth/callback`). Auth email templates are in `supabase/templates/` (they use `{{ .SiteURL }}`).
4. Storage buckets `documents` and `resources` (both private) are created by migrations. Verify policies against the real Storage API.

## 2. Edge functions (Deno)
In `supabase/functions`: `process-document`, `ask-document`, `generate-study-material`, `import-resource`, `resource-url`, `cv-feedback`, `interview-prep`, `purge-accounts` (shared code in `_shared`). Never run or type-checked under Deno.
```
supabase functions deploy <name>
```
Secrets (`supabase secrets set NAME=value`), server-only: `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN` (exact web origin, required, no `*`), `WORKER_SECRET` (long random), and the AI variables `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `EMBED_API_KEY`, `EMBED_BASE_URL`, `AI_EMBED_MODEL`, `AI_EMBED_DIMENSIONS` (1536), optional `TESSERACT_LANG_PATH`. The functions read `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (`_shared/runtime.ts`); whether hosted Supabase injects the first two and the service key automatically was not verified, so set any that are missing. Model names and prices are DB config, not secrets.

## 3. Scheduled work
Nothing in the repository schedules these yet; you must.
| Job | What | Caller |
| - | - | - |
| `purge-accounts` | deletes accounts past the 14-day grace period | scheduler calls the edge function with header `x-worker-secret: <WORKER_SECRET>` |
| `expire_subscriptions(p_limit)` | expired plans fall back to FREE | service_role SQL (e.g. pg_cron) |
| `ai_sweep_orphan_reservations(p_minutes)` | releases AI budget reservations left by crashed workers (>= 5) | service_role SQL |
| `send_event_reminders(p_within_hours)` | creates Campus event reminder notifications; push delivery is not built | service_role SQL |

Use Supabase Cron / `pg_cron` or any external scheduler (hosted availability and permissions unverified). Admin-audited equivalents exist: `admin_run_subscription_expiry`, `admin_ai_sweep_reservations`.

## 4. Web and admin hosting
Both are Next.js 16 apps; Vercel or any Node host (`next build`, `next start`; ports 3000 and 3001 by default). Deploy `apps/web` and `apps/admin` as separate projects on separate origins, with the monorepo root as install root. Not deployed or verified on any host.
Environment: only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (and `NEXT_PUBLIC_SITE_URL` for web) are public. Never place the service-role key or an AI key in a `NEXT_PUBLIC_*` variable. Keep the admin origin behind extra access control (MFA is not implemented). Set the functions' `ALLOWED_ORIGIN` to the web origin. Fill the legal page placeholders and have them reviewed before launch.

## 5. Admin first-user bootstrap
The admin app has no sign-up. Sign up a normal account in the web app. Then, in the Supabase SQL editor as `postgres`, set the role directly:
```
update public.profiles set role = 'super_admin' where id = '<user uuid>';
```
The trigger `guard_profile_role` only restricts the `anon` and `authenticated` roles, so `postgres` and `service_role` can do this (reading of the trigger only; not run on hosted). After that, the super admin can grant roles through the admin Users screen (`admin_set_role`). Details: [ADMIN.md](ADMIN.md).

## 6. AI provider
Follow [AI_PROVIDERS.md](AI_PROVIDERS.md): set the key as a secret, then in the admin app add the provider, models with prices, task routes and budgets. No model has been chosen. Until routes exist, AI returns `ai_not_configured`.

## 7. Mobile
See [MOBILE_BUILD.md](MOBILE_BUILD.md).
