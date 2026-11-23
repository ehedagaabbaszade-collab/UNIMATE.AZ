# Release readiness

Verdict (2026-11-23): **not ready for release.** Nothing is deployed, pushed or applied to hosted Supabase. Full tick list: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md); deployment steps: [DEPLOYMENT.md](DEPLOYMENT.md).

## Blockers
| Blocker | Status |
| - | - |
| Migrations 0056, 0057 applied to hosted DB | Not done; needs owner approval. 0056 sets every existing university user to `pending` |
| Full migration set run on real PG15 | Not done ([POSTGRES15.md](POSTGRES15.md)) |
| Vault secrets `project_url`, `worker_secret`; `purge-accounts` deployed with `verify_jwt=false` | Not done |
| Real-token RLS and Storage policy check | Not done |
| AI provider configured and evaluated | Not done ([AI_CONFIGURATION.md](AI_CONFIGURATION.md)) |
| Legal documents finalised | Blocked on [legal/MISSING_INFO.md](legal/MISSING_INFO.md); lawyer review |
| First admin staff bootstrapped; staff approve university requests | Not done |
| Faculties, majors, courses seeded by admin | Not done |
| Android/iOS store builds, listing | Not done ([STORE_LISTING.md](STORE_LISTING.md), [MOBILE_BUILD.md](MOBILE_BUILD.md)) |
| Focus-lock compiled and policy-cleared | Not done ([MOBILE_NATIVE_STATUS.md](MOBILE_NATIVE_STATUS.md)) |
| End-to-end tests | None exist |
| Account deletion tested on hosted | Not done ([ACCOUNT_DELETION.md](ACCOUNT_DELETION.md)) |

## Ready locally
Phase 1 security fixes, 16+ consent flow, admin university verification, private CV photos, fail-closed legal gate. Evidence: [TEST_REPORT.md](TEST_REPORT.md), [SECURITY_REPORT.md](SECURITY_REPORT.md).

## Functional gaps
GPA and teacher exams client-only; documents unpaginated; payments not started; missing FK indexes ([DATABASE_CHANGES.md](DATABASE_CHANGES.md)). Roadmap: [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).
