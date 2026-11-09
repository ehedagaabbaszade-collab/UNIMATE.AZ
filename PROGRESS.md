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
| Backend gaps: account deletion, data export, server-side XP, admin ops | IN PROGRESS | agent running |
| Admin app | N | stub only; depends on admin ops migration |
| Mobile (Expo) | N | stub only; starts after backend |
| Campus / Notes marketplace / Career UI | N | tables+RLS exist; no UI |
| Payments | N | by design: entitlements + admin grant only, no checkout |
| E2E/Playwright, load tests, CI/CD | N | |

## Queued next (one agent at a time, in order)
1. Finish backend gaps (account deletion, export, server-side XP, admin ops) -> verify -> commit.
2. AI cost architecture: DB-backed model routing per task (extraction, summarize, rag, chat, quiz, flashcards, exam_simulation) and per plan (free/plus/pro); pricing in admin-only server-side config (validated, audited, reversible); ai_usage gains provider, task, cached tokens, estimated cost; HARD spend ceilings per user, per plan, and global, enforced atomically (reserve-then-settle, idempotent per request id so retries/failures never double-bill); reject with a clear error at the limit, never silently switch to a pricier model; fallback only to pre-approved same-or-cheaper models; per-user rate limits; admin cost dashboard views; provider-extension guide. Tests: concurrency, exhaustion, provider failure, retry idempotency, fallback cost limits, users cannot change plan/usage.
3. Combined security review (backend + AI cost) -> fix -> commit.
4. Expo mobile app (real backend, all implemented modules), then admin app, E2E/prod builds, deployment/EAS docs.

## Known external blockers
AI provider key; Supabase project (not created - needs approval); Deno for edge functions; Android/EAS account; Apple toolchain (macOS).

## Open gaps worth knowing
- Faculties/majors are not seeded (no fabricated academic structure); admin must add them.
- Legal pages are drafts for legal review with placeholders.
- Offline = IndexedDB cache (no service worker).
