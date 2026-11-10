# Final delivery report (2026-11-10)

## 1. Fully tested locally
- 129 test files / 1845 tests pass (`npm test`).
- `npm run typecheck` clean in all workspaces.
- `npm run lint` exit 0.
- Web and admin production builds OK; Android `expo export` builds OK (iOS export was also documented as working in `apps/mobile/README.md`).
- Database logic (migrations, RLS, RPCs, account purge cascade, XP, quotas, AI budgets) on PGlite (PG18, superuser), plus a PG15 construct lint.
- Perf smoke on PGlite: `npm run perf` ([PERFORMANCE.md](PERFORMANCE.md)).

## 2. Implemented but untested against live services
Supabase hosted (Auth/GoTrue, Storage, `pg_cron`, hosted roles); real AI provider (adapters tested with mocked `fetch` only; Azerbaijani answer quality, cost and latency unknown); edge functions on Deno (never run or type-checked); OCR (`aze`) and PDF rasterizer; real devices and browsers (no visual check, no screen-reader pass); hosted PostgreSQL 15 ([POSTGRES15.md](POSTGRES15.md)); concurrency under real multi-connection load (PGlite is single-connection); `expo-print` CV export on a device; account deletion on hosted Supabase.

## 3. Awaiting credentials and approvals
Supabase project; AI key and model choice (budget 0-500 AZN, nothing chosen); EAS, Apple Developer and Google Play accounts; domain, support email, privacy URL; legal review of draft legal pages; native-speaker review; true PNG brand originals; approval before any deploy.

## 4. Not built / known gaps
- Push notification delivery (`expo-notifications` installed; nothing sends); `send_event_reminders` exists but nothing calls it.
- Followers/following lists in Campus.
- MFA for staff (documented, not wired).
- Token revocation on suspension: issued access tokens stay valid until expiry; RLS does not read suspension.
- `system_config` keys have no runtime consumer.
- Quiz regenerate resets the first-attempt record.
- Planner dates are typed text on mobile.
- No real payments: plans are display-only; admin grants only.
- No scheduler is configured for purge, expiry, sweeper, reminders.
- No E2E/Playwright or real load tests; CI file exists but is not enabled.
- No OTA updates configured. No faculties/majors seeded. Offline on web is an IndexedDB cache only (no service worker).
- Edge purge path does not write the `account.purged` audit row.
- Admin: removed-content restore covers resources and events only; some admin actions take no reason.
- Pipeline and AI: GROUP plan has no route; adapters do not report cached tokens.

## 5. Native-review list
az, tr, ru (and en) UI strings across web, admin, mobile; email templates; the 7 Campus notification templates and other templates in four languages; store listing; legal drafts.

## 6. Security notes
Two security reviews applied on backend and AI cost, plus an admin audit fix commit. Service-role key lives only in edge function secrets; scan tests guard `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` and the admin app. RLS plus SECURITY DEFINER RPCs re-check roles. Quiz grading and XP are server-side. Admin writes are audited; audit log is append-only. Open: no MFA, token revocation gap, hosted-role behaviour unverified, backups retain deleted data, `npm audit` items in Expo tooling ([DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md)). A release security review should follow the first live run.

## 7. Cost notes
No model is chosen; routing, prices and hard spend ceilings (user, plan, global) are DB config managed in admin; with no key set, AI calls fail closed with `ai_not_configured`. Fallback only to approved same-or-cheaper models. See [AI_COST_OPTIMIZATION.md](AI_COST_OPTIMIZATION.md). Hosting costs (Supabase plan, Vercel or Node host, EAS, store fees) were not estimated.

## 8. Next steps for you
1. Run `supabase start` locally; confirm migrations and DB tests on real PG15.
2. Create the Supabase project (approve), `db push`, deploy functions, set secrets, create schedules ([DEPLOYMENT.md](DEPLOYMENT.md)).
3. Bootstrap the first super admin; add faculties/majors; verify institutions.
4. Choose an AI provider and models, set the key, enter routes/prices/budgets, evaluate Azerbaijani quality.
5. Deploy web and admin; do browser checks.
6. Create Expo/Apple/Google accounts; build preview APK and TestFlight ([MOBILE_BUILD.md](MOBILE_BUILD.md)); run the beta ([BETA_GUIDE.md](BETA_GUIDE.md)).
7. Commission native review and legal review; supply PNG originals; fill store assets ([STORE_LISTING.md](STORE_LISTING.md)).
8. Work through [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md); then decide which gaps in section 4 to close first (push delivery is the most visible).
