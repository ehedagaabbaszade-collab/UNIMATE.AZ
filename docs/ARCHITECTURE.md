# Architecture

Short map; deeper docs are linked. Facts as of 2026-11-23.

## Layout
npm workspaces. Apps: `apps/web` (Next 16), `apps/admin` (Next 16, separate origin), `apps/mobile` (Expo). Packages: `core` (domain logic; `@unimate/core/testing` fakes), `db`, `i18n` (az/tr/en/ru catalogs), `pipeline` (document + AI pipeline, provider adapters), `ui`. Backend: `supabase/migrations`, `supabase/functions` (11 Deno edge functions, shared code in `_shared`).

## Data and access
- Postgres 15 target with pgvector. Hosted audit: 93 public tables, about 300 SECURITY DEFINER functions.
- RLS on tables; most cross-user reads go through SECURITY DEFINER RPCs. Profiles are readable only by the owner and staff ([SECURITY_REPORT.md](SECURITY_REPORT.md)).
- Default privileges are revoked: new objects are private until a migration grants them.
- University-scoped features use `my_university_id()`, which returns the university only once staff approved it.
- Storage: private buckets `documents`, `resources`, `cv-photos`; `avatars` path `avatars/<uid>/`.
- The consent ledger is append-only and survives account deletion.

## AI
Provider interface, routing by task/plan, pricing, spend ceilings and quotas live in `packages/core/src/ai` and DB tables (`ai_models`, `ai_task_routes`). Keys exist only as edge function secrets. Without a key every call throws `ProviderNotConfiguredError`. See [AI_CONFIGURATION.md](AI_CONFIGURATION.md), [AI_PROVIDERS.md](AI_PROVIDERS.md).

## Edge functions
All 11 are ACTIVE with `verify_jwt` true on the hosted project. This branch sets `purge-accounts` to `verify_jwt=false` (authenticated by `x-worker-secret`); not yet deployed. Secrets and schedules: [DEPLOYMENT.md](DEPLOYMENT.md).

## Web security
CSP on web and admin, checked on public web pages only; signed-in pages not checked.

## Mobile
Expo. The native focus-lock module is uncompiled ([MOBILE_NATIVE_STATUS.md](MOBILE_NATIVE_STATUS.md)). Build notes: [MOBILE_BUILD.md](MOBILE_BUILD.md).

## Languages
az default, tr, en, ru. All UI strings are keys in `packages/i18n`; account language syncs across devices ([I18N.md](I18N.md)).

## Known limits
DB tests run on PGlite (Postgres 18, superuser), so they prove neither PG15 compatibility nor hosted-role behaviour. Edge functions were never run under Deno on hosted.
