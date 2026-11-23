# Product status (2026-11-23)

Honest per-module status. Legend: **IT** implemented + tested, **IU** implemented untested, **NS** not started.
"Tested" means automated tests on fakes/PGlite, not real providers or real devices. Older detail: [TRANSFORMATION_PROGRESS.md](TRANSFORMATION_PROGRESS.md), [FINAL_DELIVERY_REPORT.md](FINAL_DELIVERY_REPORT.md).

Nothing in this list is deployed. Migrations 0056 and 0057 are not applied to the hosted project.

## Founder decisions (2026-11-23)
Min age 16, no parental consent (DOB checked client + server). University verified by admin. Focus-lock kept. Profiles private. AI provider NVIDIA. Payments later. Languages az (default), tr, en, ru (Russian stays).

## Modules
| Module | Status | Notes |
| - | - | - |
| Auth, signup consents, 16+ DOB check | IT | `20260101005500_legal_consents.sql`; web + mobile |
| Legal gate (fails closed) | IT | only PGRST202/404 pass through |
| Account deletion + nightly purge | IT (SQL) / IU (hosted) | [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md); cron needs Vault secrets; never run on hosted |
| University verification (admin queue) | IT | admin page + status on profile web/mobile; Campus locked until approved |
| Private profiles | IT | profiles own-row + staff only |
| Campus (communities, events, posts) | IT (DB) / IU (UI) | university scope needs approved university |
| Documents + RAG (upload, chunk, ask) | IT with fakes | real provider and real OCR never run; list unpaginated |
| AI Study (summary, quiz, flashcards) | IT with fakes | only first 30,000 chars read; see [AI_CONFIGURATION.md](AI_CONFIGURATION.md) |
| Weak-topic detection, personalised study plan | NS | |
| Planner, Pomodoro, Notes, Flashcards, Quizzes | IT (logic) / IU (UI on device) | persistence audit pending (Phase 2) |
| GPA | IU | client-only, no server storage |
| Teacher portal / exams | IU | client-only, no server storage |
| Career + CV (Boss.az links, Europass, private photos) | IT (logic) | Rolio integration waits on partner API ([ROLIO_INTEGRATION.md](ROLIO_INTEGRATION.md)) |
| Admin console | IT (DB) / IU (UI) | [ADMIN.md](ADMIN.md) |
| Payments / plans | NS | demo card/CVV flow removed; server plan only |
| Focus-lock (native) | IU, uncompiled | [MOBILE_NATIVE_STATUS.md](MOBILE_NATIVE_STATUS.md) |
| i18n az/tr/en/ru | IT (key checks) | [I18N.md](I18N.md) |
| End-to-end tests | NS | |
| Store builds / deploys | NS | eas.json submit empty |

## Known gaps
GPA and teacher exams client-only; no E2E; documents list unpaginated; settings export uses `select *`; missing FK indexes (see [DATABASE_CHANGES.md](DATABASE_CHANGES.md)); legal text blocked on [legal/MISSING_INFO.md](legal/MISSING_INFO.md).
