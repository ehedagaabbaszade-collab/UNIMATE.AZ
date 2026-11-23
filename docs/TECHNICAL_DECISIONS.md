# Technical decisions

Dated record. Status of each is "decided"; implementation status is in [PRODUCT_STATUS.md](PRODUCT_STATUS.md).

## Founder decisions, 2026-11-23
| Decision | Detail |
| - | - |
| Minimum age 16 | No parental consent. Date of birth checked client and server (`20260101005500_legal_consents.sql`). Lawyer confirmation pending: [legal/MISSING_INFO.md](legal/MISSING_INFO.md) section A |
| University verification by admin | Staff approve in the admin queue; unapproved users cannot use university features |
| Focus-lock kept | Native work in [MOBILE_NATIVE_STATUS.md](MOBILE_NATIVE_STATUS.md) |
| Profiles private | Own row + staff only; others see public bits via RPCs |
| AI provider NVIDIA | Free until launch; later OpenAI GPT for writing; keep NVIDIA embeddings |
| Payments later | Demo card/CVV flow removed; server plan only |
| Languages az (default), tr, en, ru | Russian stays; the earlier "remove ru" is superseded |

## Engineering decisions
- Postgres 15 target, pgvector `vector(1536)` with HNSW. PGlite (PG18) used for tests only.
- Security by default: default privileges revoked; new objects need explicit grants ([SECURITY_REPORT.md](SECURITY_REPORT.md)).
- Production AI path throws `ProviderNotConfiguredError`; fakes live in `@unimate/core/testing` only.
- AI models and routes are DB config (admin console), not code.
- Secrets never in `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`; service role only in edge functions.
- Account purge runs from pg_cron through the edge function using a Vault-held secret (no secret in migrations).
- Consent proof is kept after account deletion as a sha256 `subject_ref`, append-only.
- Phase 0: the main checkout's uncommitted work was backed up and selectively integrated; TypeScript 7 to 6 downgrade and the Gemini script were rejected ([IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)).
- No deploys, payments or remote Supabase changes without owner approval.
