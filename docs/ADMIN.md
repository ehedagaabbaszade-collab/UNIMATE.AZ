# Admin console (apps/admin)

Status: parts 1 and 2 implemented. Typechecked, built, guard/schema/RPC-wrapper/i18n/no-secrets tests pass, DB functions tested on PGlite. **Not run against a live Supabase project and not visually checked in a browser.**

## Security model
- The app uses only `NEXT_PUBLIC_SUPABASE_URL` + the anon key and the signed-in user's JWT. The service-role key is never referenced (scan test: `src/security/no-secrets.test.ts`, source + `.next` build).
- Three guards share one pure rule set (`src/lib/guard.ts`): `proxy.ts` (session refresh, no session -> `/sign-in`, wrong role -> `/access-denied`, role read server-side from `profiles` with the user's JWT), the `(console)` layout (`getStaffSession`: `getUser()` + role query), and every page (`requireRoute("<its path>")`, deny-by-default for unknown routes; a test pins this).
- These are UX and first-line gates only. Every privileged action is an RPC that re-checks `profiles.role` in the database (`is_moderator` / `is_admin` / `is_super_admin`). RLS is unchanged.
- Roles: moderator = overview (moderation counters) + moderation; admin = + users, plans, academic data, career, subscriptions, prompts; super_admin = + role changes (`admin_set_role`, cannot change own role or demote the last super admin).
- Destructive, role and plan actions use a confirm dialog with a required 3-500 character reason (same rule as the RPCs) and show a toast only after the RPC resolves (no optimistic UI). Errors map from Postgres codes to translated messages; server text is never shown.
- Privacy: the users list shows id, display name, username, role, university, effective plan, created date and suspension status. E-mail addresses are NOT returned or shown. No documents, chat messages, quiz answers or anonymous-author/reporter identities appear anywhere.
- No state-changing GETs. All writes are client calls with the user's JWT.

## Migration 20260101004600_admin_console.sql
New audited functions: `admin_list_users`, `admin_user_subscriptions`, `admin_set_user_suspended` (+ `account_suspensions` table), `admin_expiring_subscriptions`, `admin_run_subscription_expiry`, `admin_overview_counters`, `admin_reports_queue`, `admin_removed_content`, `admin_communities_overview`, `admin_upsert_university` / `admin_verify_university` / `admin_upsert_faculty` / `admin_upsert_major` / `admin_upsert_course` / `admin_delete_academic`, `admin_create_prompt_version`. It also allows `universities.source = 'admin_verified'`. Tests: `packages/db/src/admin_console.test.ts`.

Suspension: records the suspension and, on hosted Supabase, sets `auth.users.banned_until` (blocks new sign-ins and token refresh). Access tokens already issued stay valid until they expire, and RLS does not read the suspension, so a suspended student with a live token can still call the API until it expires. Not verified on hosted Supabase (PGlite has no `banned_until`).

## Multi-factor authentication (recommended, not wired)
Staff accounts should enable TOTP. Supabase Auth supports it (`auth.mfa.enroll`, `challenge`, `verify`); enforcing it needs an enrolment screen, an AAL2 check in `getStaffSession`/`proxy.ts` (`auth.mfa.getAuthenticatorAssuranceLevel()`), and ideally an `aal` check inside the RPC role helpers. This is not implemented in part 1. Until then: unique strong passwords, no shared staff accounts, create staff by promoting an existing account with `admin_set_role` (super admin), and keep the admin app on a separate origin (`apps/admin`, port 3001) behind your own access controls.

## Known limits (part 1)
- Moderation: removed content restore covers resources and events (posts/comments cannot be told apart from author deletions). Community oversight is read-only (counts); there is no staff action to remove a community.
- Pending shared quizzes/decks are not listed.
- Event approve/reject (`moderate_event`) takes no reason parameter: plain confirmation (still audited by the database). Prompt activation likewise.
- Career upserts take no reason parameter either (audited by the database).
- Staff accounts are not created here; there is no sign-up or password reset in the admin app.

## Part 2 (migration 20260101004700_admin_console_2.sql)
Screens (all admin+, deny-by-default routes, nav entries gated in `lib/guard.ts`): AI models and providers (`/ai/models`), task routes (`/ai/routes`), spend budgets (`/ai/budgets`), config versions with diff and revert (`/ai/versions`), AI cost dashboard (`/ai/cost`), analytics (`/analytics`), audit log (`/audit`), system config (`/config`), notification templates and system content (`/content`), document processing monitor (`/jobs`).

- **Reads** use admin-only RLS selects (providers, models, routes, budgets, `config_versions`, `audit_logs`, `system_config*`, template and content version tables) or aggregate RPCs. **Writes** are audited SECURITY DEFINER RPCs that re-check `is_admin()`; the app never uses the service role.
- **Reasons**: the original AI config writers take no reason, so new wrappers (`admin_ai_set_provider/model/route/budget`, `admin_ai_delete_route/budget`) require one (3-500 chars), carry it into `config_versions.reason` and the audit metadata (through the transaction-local setting `unimate.cfg_reason`, which `ai_cfg_commit` reads), then call the originals, so validation (fallback no costlier than primary, approved, distinct) is unchanged. The UI only calls the wrappers. The unreasoned originals are still executable by admins through the API (kept for the existing tests); revoke them if the UI must be the only path.
- **Config revert** (`admin_revert_config`) needs admin, not super_admin, so no super-admin gate was added. It restores providers, models, routes and budgets; it is recorded as a new version.
- **System config**: `admin_set_system_config` / `admin_revert_system_config` plus a trigger-fed `system_config_versions` table that also captures direct admin writes (those have no reason). Audit rows carry key and reason, never the value. The editor only edits keys declared in `lib/config-keys.ts` (zod schema per key); other keys are read-only. Declared keys have **no runtime consumer yet**.
- **Templates**: `notification_template_versions` + `admin_revert_notification_template`; `admin_set_notification_template` now also writes a history row (history starts with this migration). Placeholder parity is checked in the UI (a non-az locale that differs from az blocks the save; editing az only warns about the others); the database does not enforce it. The live preview uses the shared `renderNotification` with HTML escaping. System content has parity checks and history/revert but no rendered preview.
- **Sweeper**: `admin_ai_sweep_reservations(minutes >= 5, reason)` wraps the service-role sweeper and audits it.
- **Analytics**: `admin_learning_metrics`, `admin_retention_cohorts` (aggregates, no user columns). Flashcards reviewed are counted from `review_completed` XP events (the server awards at most 100 per student per day, so heavy users are under-counted; there is no per-review log).
- **Processing monitor**: `admin_processing_failures` (state, kind, attempts, document id, `last_error` flattened, e-mails/URLs masked, cut to 200 chars; no payload, no user id) and `admin_requeue_job` (failed/dead only, resets attempts, audited).
- **Audit viewer**: filter by actor, action prefix, target type/id and date range, pagination, detail dialog with redaction (`lib/redact.ts`: credential-like keys, JWTs, bearer tokens, e-mail addresses) and client-side CSV export of the current page (`lib/csv.ts` prefixes cells starting with = + - @ tab CR with an apostrophe). The audit log is append-only (trigger).
- Charts are dependency-free SVG with a "show as table" alternative; budget bars use `role="meter"` and always print the percentage.
- Provider screens never store or show keys: the key column shows only the conventional environment variable NAME.

Tests: `packages/db/src/admin_console_2.test.ts` (39, PGlite), `apps/admin/src/lib/part2.test.ts`, `part2b.test.ts` (math, validators, CSV, redaction, parity, nav gating, RPC names exist), plus i18n parity/hardcoded/no-secrets scans over the new files.
Not verified: nothing was run against a live Supabase project, no browser/visual check (1280/390, light/dark), no screen-reader pass; az/tr/ru copy is hand-written and needs native-speaker review; the JSON "drawer" is a modal dialog.
