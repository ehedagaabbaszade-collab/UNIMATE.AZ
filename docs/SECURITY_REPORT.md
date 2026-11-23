# Security report (Phase 1)

Date 2026-11-23. Findings S1-S10 fixed in the repository only. **Nothing is applied to the hosted Supabase project, deployed or pushed.** The hosted state was not checked: the Supabase MCP has no permission for this project, so remote migration list and advisors were not read.

Status legend: IT = implemented + tested (PGlite, not PG15/hosted roles), IU = implemented untested.

| Id | Finding | Fix | Commit | Status |
| - | - | - | - | - |
| S1 | University claims unverified | `university_status` none/pending/approved/rejected; `my_university_id()` approved-only; membership prune; visibility guard trigger; `join_by_code` check; `admin_list_university_requests` / `admin_review_university` (audited, race-safe) | 9568714, da20ffb | IT |
| S2 | Profiles readable by all | select = own row + staff; new profiles not discoverable; review columns hidden | 9568714 | IT |
| S3 | Account purge never scheduled | nightly pg_cron job calls `purge-accounts` with `x-worker-secret` from Vault | cc10bd8 | IT (skip path); IU on hosted |
| S4 | LegalGate failed open | fails closed except PGRST202/404 | fc7830a | IT |
| S5 | Default privileges exposed new objects | revoked, including for role postgres | 9568714 | IT |
| S6 | CV photos in public bucket | private `cv-photos` bucket, 10-minute signed URLs, old objects deleted after save | 9568714, 7f4c7c6 | IT |
| S7 | TRUNCATE/REFERENCES/TRIGGER and anon sequence grants | revoked | 9568714 | IT |
| S8 | Arbitrary `avatar_url` | must be https project storage `avatars/<uid>/`; `storage_host` in `system_config` for custom domains | 9568714 | IT |
| S9 | No CSP; demo card/CVV payment | CSP on web + admin (public web pages checked only; signed-in pages not checked); demo card flow removed, server plan only | fc7830a | IU (CSP signed-in) |
| S10 | Consent proof deleted with account | `user_consents` ON DELETE SET NULL + sha256 `subject_ref`; stays append-only | 9568714 | IT |

An opus reviewer examined 9568714; its 3 blockers and 4 should-fix items were fixed.

## Audit facts
93 public tables, about 300 SECURITY DEFINER functions, 11 edge functions ACTIVE with `verify_jwt` true (hosted, 2026-11-23). `purge-accounts` becomes `verify_jwt=false` on deploy (secret-header auth).

## Open risks
- Applying 0056 makes every existing user with a university `pending` until staff approve.
- Columns added to `profiles` later need an explicit `grant select (col)`.
- Legacy off-bucket avatar URLs stay until the user changes the avatar.
- Hosted-role behaviour and PG15 compatibility untested ([POSTGRES15.md](POSTGRES15.md)).
- No penetration test, no real-token RLS check ([RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)).
- Deletion flow: [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md). Legal text gaps: [legal/MISSING_INFO.md](legal/MISSING_INFO.md).
