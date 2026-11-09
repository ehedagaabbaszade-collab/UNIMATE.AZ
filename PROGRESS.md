# PROGRESS (updated 2026-11-10)

Status legend: **T** implemented + tested (automated), **U** implemented, untested against live services, **N** not started.
Repo: 545 vitest tests passing (46 files); `npm run typecheck` clean in all workspaces. No live Supabase, no AI key, no Deno, no device builds available here.

| Module | Status | Notes |
| - | - | - |
| Monorepo, tooling | T | npm workspaces, vitest, TS strict |
| packages/core (locale, chunking, citations, fence, quotas, GPA, XP, SRS, upload/zip checks) | T | two security reviews applied |
| Database (45 tables, RLS, storage policies, seed of real universities) | T on PGlite (PG18, superuser) | PG15/hosted roles/real Storage API unverified; two security reviews applied |
| Document pipeline (jobs, extraction, OCR fallback, RAG, generation, quota) | T logic / U providers | provider adapters mocked-fetch only; OCR (aze) and PDF rasterizer unverified |
| Edge functions (process-document, ask-document, generate-study-material) | U | never run/type-checked (no Deno); `ALLOWED_ORIGIN` required |
| Web app (design system, i18n az/en/ru/tr, auth, onboarding, AI study, planner, legal drafts) | T pure logic + mocked components / U flows | needs live Supabase |
| Backend gaps: account deletion, data export, server-side XP, admin ops | T on PGlite / U edge purge fn | committed b68a825; quiz correctness still client-attested (fix queued) |
| AI cost architecture (DB-backed routing/pricing, hard ceilings user/plan/global, reserve-settle idempotent billing, approved cheaper fallback, rate limits, admin cost views) | T on PGlite / U live | 806 repo tests pass; concurrency tests prove statement logic only (single-connection PGlite); GROUP plan has no route; adapters don't report cached tokens |
| Institutions directory (sign-up/onboarding select, grouped universities vs colleges, Azerbaijani sort) | T | 22 ministry + 8 private + 13 other-body + 38 ministry colleges from edu.gov.az/Wikipedia; 24 user-supplied entries flagged `source=user_supplied_unverified` for admin verification; production web build OK |
| Admin app | N | stub only; depends on admin ops migration |
| Mobile (Expo) | N | stub only; starts after backend |
| Campus / Notes marketplace / Career UI | N | tables+RLS exist; no UI |
| Payments | N | by design: entitlements + admin grant only, no checkout |
| E2E/Playwright, load tests, CI/CD | N | |

## Queued next (one agent at a time, in order)
1. Finish backend gaps (account deletion, export, server-side XP, admin ops) -> verify -> commit.
2. AI cost architecture: DB-backed model routing per task (extraction, summarize, rag, chat, quiz, flashcards, exam_simulation) and per plan (free/plus/pro); pricing in admin-only server-side config (validated, audited, reversible); ai_usage gains provider, task, cached tokens, estimated cost; HARD spend ceilings per user, per plan, and global, enforced atomically (reserve-then-settle, idempotent per request id so retries/failures never double-bill); reject with a clear error at the limit, never silently switch to a pricier model; fallback only to pre-approved same-or-cheaper models; per-user rate limits; admin cost dashboard views; provider-extension guide. Tests: concurrency, exhaustion, provider failure, retry idempotency, fallback cost limits, users cannot change plan/usage.
3. Security-critical backend fixes (one agent): server-side quiz answer verification (store correct answers server-side / grade in a DB RPC; XP only from server-verified attempts; no client-attested correctness); atomic XP + concurrency tests; subscription expiry (expires_at honoured everywhere via an `effective_plan(user)` function, automatic fall back to FREE, admin grants require/validate expiry, scheduled sweeper); account deletion purge verification + hosted-Supabase deletion notes; PG15 compatibility check (no PG15 server available locally: lint for PG16+ syntax, document) -> combined security review (backend + AI cost) -> fix -> commit.
3b. MANDATORY i18n = az (default), tr, en, ru. USER DECISION (supersedes the earlier "no Russian"): Russian STAYS; do NOT remove ru catalogs, ru DB values, or ru in the AI language allowlist; do NOT migrate ru users to az. Everything below that says az/tr/en or "remove ru" / "ru->az" is void; read it as az/tr/en/ru with full ru translations (including legal pages, emails, notification templates). Steps: (a) backend agent adds migration: profiles.locale check az/tr/en/ru (keep existing ru rows), `notification_templates` + `system_content` tables with per-locale JSON (admin-managed, audited), notifications store template key + params and render per recipient locale, pipeline/edge `language` allowlist az/tr/en (+ output-language param separate from source language); (b) i18n agent creates `packages/i18n` (typed catalogs az/tr/en, locale utils: az/tr collation, Intl formatting, plural/format helpers) extracted from apps/web (delete ru catalog + ru legal fallbacks), shared by web, admin and mobile; language selector in onboarding + settings, persisted to profiles.locale and synced across devices/sessions; auth email templates az/tr/en; tests for missing keys + placeholder parity + a scan test for hardcoded user-facing strings in JSX/TSX; (c) Campus content is never auto-translated (store author language only). (d) Quality rules: az default for new accounts, onboarding, emails, notifications; existing valid prefs kept, ru->az migrated; language syncs across devices after sign-in (profiles.locale is source of truth; local storage/cookie/device-locale fallback before login, reconciled at first authenticated load); AI output language is a separate setting from document source language (stored on conversation/generation params, part of the cache key); never translate university names, course codes, personal names, or Campus posts; natural hand-written az/tr/en copy (flag for native-speaker review in the final report — I cannot certify native quality); tests for persistence, cross-device sync, email templates, notification rendering, date/number formatting (az/tr/en), and missing keys across web, admin, mobile.
4. Expo mobile app (real backend) + web gaps: Campus, Notes library, Career (admin-managed listings only, CV builder, interview prep), gamification screens (server-verified), notifications, profile/subscription (read-only status; payment architecture doc, no fake charges; App Store/Google Play billing doc).
5. Admin app (users/roles, universities/faculties/majors/courses, moderation/reports, materials, subscriptions, AI providers/models/budgets/costs, analytics, audit logs, config) with server-side role guard.
6. E2E/prod builds, deployment + EAS + store metadata + beta instructions + FINAL_DELIVERY_REPORT.md.

## Known external blockers
AI provider key; Supabase project (not created - needs approval); Deno for edge functions; Android/EAS account; Apple toolchain (macOS).

## Open gaps worth knowing
- Faculties/majors are not seeded (no fabricated academic structure); admin must add them.
- Legal pages are drafts for legal review with placeholders.
- Offline = IndexedDB cache (no service worker).
