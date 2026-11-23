# Database changes (Phase 1)

Both migrations are forward-only, **not applied to the hosted project**. Apply order: `20260101005600`, then `20260101005700`. Apply after a real PG15 run ([POSTGRES15.md](POSTGRES15.md)) and owner approval. Tests ran on PGlite (Postgres 18), status IT locally.

## 20260101005600_security_foundation.sql
- **S5/S7**: default privileges revoked (incl. role postgres, PUBLIC EXECUTE on new functions); TRUNCATE/REFERENCES/TRIGGER and anon sequence grants revoked.
- **S1**: `profiles.university_status` (none/pending/approved/rejected) plus review columns; index `profiles_university_status_idx`; existing claims reset to unverified (becomes `pending`). Trigger `profiles_prune_university_memberships`; `guard_profile_role` extended; `my_university_id()` returns approved only; `ensure_university_community`, `leaderboard`, `join_by_code`, `campus_profile`, `search_campus`, `get_contributor_profile` rewritten to respect it. Guard trigger `guard_university_visibility` on `resources`, `shared_quizzes`, `shared_decks`. New RPCs `admin_list_university_requests`, `admin_review_university`.
- **S2**: `profiles_select` = own row or staff; column-level SELECT grants (review columns hidden); `export_my_profile()` added and `export_my_data_base()` rewritten; `campus_discoverable` default false (existing flags kept).
- **S8**: `profiles_avatar_url_https` check dropped; trigger `guard_profile_avatar_url` (only changed values checked).
- **S6**: private `cv-photos` bucket with owner-folder policies.
- **S10**: `user_consents.subject_ref` (sha256 of user id, set by trigger), `user_id` nullable with ON DELETE SET NULL, append-only trigger kept (only the FK null update allowed).
- Reverse statements are in the commented ROLLBACK section at the end of the file.

## 20260101005700_schedule_account_purge.sql
Schedules cron job `purge-accounts` at 03:17 daily, POSTing `/functions/v1/purge-accounts` with `x-worker-secret`. Reads Vault secrets `project_url` and `worker_secret` at run time (create them first; no secret in the file). Skips with a notice when pg_cron/pg_net are missing. Rollback: `select cron.unschedule('purge-accounts');`.

## Not yet done
Missing FK indexes from the audit: `comments.parent_id`, `shared_decks.owner_id`, `shared_decks.course_id`, `shared_quizzes.course_id`, `reports.post_id`, `reports.comment_id`, `reports.reported_user_id`, `communities.created_by`, `events.created_by`. No migration exists for them.

Other DB docs: [ACCOUNT_DELETION.md](ACCOUNT_DELETION.md), [DEPLOYMENT.md](DEPLOYMENT.md).
