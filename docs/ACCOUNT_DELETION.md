# Account deletion

Status: SQL part **implemented and tested on PGlite** (`packages/db/src/account_deletion.test.ts`, `product_gaps.test.ts`).
The `purge-accounts` edge function, GoTrue deletion and Storage removal are **implemented but never run** (no Deno, no
hosted Supabase project here). Everything in "Hosted Supabase specifics" is documentation of expected behaviour, not
verified behaviour.

## Flow
1. The user calls `request_account_deletion()` (RPC, authenticated). One pending request per user; scheduled 14 days out
   (`account_deletion_requests.scheduled_for`). A `deletion_requested` notification is created (rendered in the user's locale).
2. Within the grace period `cancel_account_deletion()` cancels it (status `cancelled`, `deletion_cancelled` notification).
   A cancelled request is never purged, even after its original date; a later request starts a fresh 14 days.
3. A scheduler (Supabase cron / external) calls the `purge-accounts` edge function with header `x-worker-secret`
   (`WORKER_SECRET`). For each due user (`due_account_deletions()`, service_role only) it:
   1. removes every Storage object under `documents/<uid>/` (list + remove, 100 per page, until empty);
   2. calls the GoTrue admin API `auth.admin.deleteUser(uid)` with the **service role** key;
   3. if step 1 fails the user is skipped and retried on the next run, so files are never orphaned.
4. Deleting the `auth.users` row cascades (see below). `purge_due_account_deletions(uuid[])` is the SQL-only fallback
   (service_role): it audits `account.purged` and deletes from `auth.users` directly, but removes **no files**.

## What the SQL purge removes (tested)
Deleting `auth.users` cascades to `profiles` (`profiles.id references auth.users on delete cascade`), and from there to every
table with a foreign key to `profiles`. The test discovers all such foreign keys from `pg_constraint`, seeds one real row
per (table, column) pair (~50 pairs, including nullable ones such as `reports.reported_user_id`), purges, and asserts:
- zero rows reference the user in any of those columns, and the user id appears in no row of any public table (a text sweep),
  except `audit_logs`;
- rows whose FK is `on delete set null` (`audit_logs.actor_id`, `communities.created_by`, `reports.handled_by`, ...) are kept
  with the column nulled; audit rows keep only the opaque id (and `account.purged`);
- a bystander user is untouched; a **negative control** (removing the cleanup trigger) makes the test fail.

Found and fixed by this test: `ai_spend` / `ai_budgets` key per-user rows by text (`key = '<uuid>'`), so no FK cascades to
them. Migration `20260101003700_purge_user_scope_cleanup.sql` adds a `BEFORE DELETE` trigger on `profiles` that removes them.

Not covered by an FK and therefore not removed by SQL: Storage files (below), backups, provider-side copies.

## Hosted Supabase specifics (unverified here)
- **GoTrue cascade.** `auth.users` is owned by GoTrue (`supabase_auth_admin`). Its own tables (`identities`, `sessions`,
  `refresh_tokens`, `mfa_factors`, ...) reference `auth.users` with cascade, so deleting the user also deletes sessions and
  refresh tokens. Already-issued access JWTs remain valid until they expire (default 1 hour). A leftover JWT cannot recreate
  data: `profiles.id` has a foreign key to `auth.users`, so any insert for the deleted uid fails.
- **Why the admin API is the production path.** `auth.admin.deleteUser` is the supported way to delete a user: GoTrue also
  revokes sessions and handles identities and any auth hooks. It needs the service role key, which exists only in edge
  function secrets (never `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*`). Pass `shouldSoftDelete` unset/false: soft delete keeps the row.
- **Storage.** SQL cannot delete the underlying files. Rows in `storage.objects` are metadata; a
  direct `DELETE FROM storage.objects` may be blocked by a protection trigger on current Supabase versions (verify); where it is allowed, it
  leaves the files in the S3 backend. Use the Storage API (`storage.from('documents').remove([...])`) with the service role,
  as the edge function does. Paths are flat (`<uid>/<file>`, enforced by CHECK constraints), so listing `<uid>` is complete;
  the function refuses any id that is not a strict UUID (an empty prefix would list the bucket root).
- **The `postgres` role** (what migrations and the SQL editor run as) is NOT a superuser on hosted Supabase. It owns the
  `public` objects, so it can run the purge function, create the triggers and delete from `public` tables. It normally can
  also `DELETE FROM auth.users` (the SQL fallback assumes this; **verify on your project** before relying on it), but it cannot
  delete Storage files, cannot revoke already-issued JWTs, cannot alter `auth` / `storage` schema objects owned by Supabase
  roles, and cannot bypass the Storage protection trigger. `service_role` bypasses RLS but is still not a superuser.
- **Functions are SECURITY DEFINER** and pin `search_path`; they run with the owner's rights. Only `service_role` can execute
  `due_account_deletions` / `purge_due_account_deletions`; clients can only request and cancel.

## Known gaps / operator notes
- The edge function path does not write the `account.purged` audit row (only the SQL fallback does); the request row cascades
  away with the profile. Recommended follow-up: a service-role RPC the function calls before `deleteUser`.
- Backups / PITR keep deleted data until the retention window ends; Storage CDN caches, logs, e-mail provider and AI provider
  retention are outside the database and must be covered in the privacy policy.
- Community ownership is handed to the oldest moderator/member before the profile is removed (`promote_successor_owner`);
  a community with nobody left stays ownerless.
- A scheduler must exist: nothing in this repository schedules `purge-accounts` yet.
