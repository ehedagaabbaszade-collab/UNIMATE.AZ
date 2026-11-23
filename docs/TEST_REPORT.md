# Test report

Stack: vitest, TypeScript strict. Test commands and setup: [LOCAL_SETUP.md](LOCAL_SETUP.md).

## Results
| Run | Result |
| - | - |
| Before Phase 1 | 2037 passed |
| DB suite after Phase 1 | 869 passed |
| Full suite after Phase 1 (2026-11-23, commit da20ffb): 167 files, 2066 tests passed; tsc clean in 8 workspaces; ESLint clean. | filled in by the owner from the latest run |

## What the tests prove
- DB tests run on PGlite (Postgres 18, superuser migrations). They do **not** prove PG15 compatibility or hosted-role behaviour ([POSTGRES15.md](POSTGRES15.md)).
- AI tests use fakes (`@unimate/core/testing`). Real provider behaviour, real OCR and Azerbaijani quality are untested ([AI_CONFIGURATION.md](AI_CONFIGURATION.md)).
- PGlite is single-connection: concurrency tests prove statement logic, not contention.
- Journey tests exist; journey students are admin-approved for their university (`4d1d026`).
- Phase 1 security changes (S1-S10) have DB tests, reviewed by an opus reviewer; see [SECURITY_REPORT.md](SECURITY_REPORT.md).

## Not covered
- No end-to-end (browser or device) tests.
- Signed-in CSP behaviour, mobile screens on device, native focus-lock ([MOBILE_NATIVE_STATUS.md](MOBILE_NATIVE_STATUS.md)).
- Edge functions under Deno on hosted; the nightly purge job on real pg_cron/pg_net/Vault.
- Remote migration state and Supabase advisors (no MCP permission for the project).
- Typecheck and lint results for the latest commit are not recorded here.
