# Admin console (apps/admin)

Status: part 1 implemented. Typechecked, built, guard/schema/RPC-wrapper/i18n/no-secrets tests pass, DB functions tested on PGlite. **Not run against a live Supabase project and not visually checked in a browser.**

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
- Part 2: AI providers/models/budgets/cost dashboards, analytics, audit-log viewer, system config, notification templates/content.
