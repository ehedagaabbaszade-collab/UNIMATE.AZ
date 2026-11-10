# Release checklist

Tick each item yourself; none were done by the developer assistant unless noted.

## Backend
- [ ] Supabase project created (needs your approval); Postgres 15.
- [ ] Full migration set applied on real PG15 first (`supabase start`) and DB tests/smoke checked ([POSTGRES15.md](POSTGRES15.md)); then `supabase db push`.
- [ ] RLS and Storage policies spot-checked with real anon/authenticated tokens.
- [ ] Edge functions deployed; secrets set (`ALLOWED_ORIGIN`, `WORKER_SECRET`, service role, AI vars); first run under Deno (never run before).
- [ ] Schedules created: `purge-accounts`, `expire_subscriptions`, `ai_sweep_orphan_reservations`, `send_event_reminders`.
- [ ] First super admin bootstrapped; staff use unique strong passwords; admin origin access-controlled.
- [ ] AI provider key set, models, prices, routes and budgets entered in admin; budget ceilings chosen; a real Azerbaijani quality/cost evaluation done ([AI_PROVIDERS.md](AI_PROVIDERS.md)).
- [ ] Faculties, majors and courses added by an admin; 24 user-supplied institution entries verified.
- [ ] Account deletion tested end to end on hosted Supabase (GoTrue user, Storage files).

## Apps
- [ ] `npm test`, `npm run typecheck`, `npm run lint` pass on the release commit; CI workflow enabled and green.
- [ ] Web and admin deployed on separate origins; only public env vars set; browser check at 390/768/1280 px, light and dark.
- [ ] Mobile preview APK installed on real Android devices; iOS TestFlight build on a real iPhone.
- [ ] Mobile redirect `unimate://auth/callback` works for sign-up, password reset.
- [ ] Bundle id `az.unimate.app` confirmed (or changed) before first store build.

## Legal and content
- [ ] Privacy policy, terms, other legal pages reviewed by a lawyer; placeholders filled; public deletion instructions URL.
- [ ] Native-speaker review of az, tr, ru (and en) UI, emails, notification templates, store listing.
- [ ] True PNG brand originals supplied (originals were received as WebP).
- [ ] Domain, support email, moderation contact set.

## Stores
- [ ] Listing text and screenshots ([STORE_LISTING.md](STORE_LISTING.md)); age rating and data-safety forms completed.
- [ ] Google Play internal testing track, then production; App Store review submission.

## Known gaps accepted for this release
See "Not built / known gaps" in [FINAL_DELIVERY_REPORT.md](FINAL_DELIVERY_REPORT.md). Run `npm audit` again ([DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md)).
