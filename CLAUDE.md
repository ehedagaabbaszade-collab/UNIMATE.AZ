# UNIMATE.AZ project instructions

Extends the global routing rules in ~/.claude/CLAUDE.md (reuse them; do not duplicate the routing system).

## Default workflow (token efficiency; quality and correctness stay first)
- Main Claude does small and routine work directly: one-to-few-file edits, regex/one-line fixes, config, docs, running a test command.
- Use at most ONE subagent at a time by default. Run several in parallel only for genuinely independent, substantial tasks that touch disjoint files.
- Cheapest suitable model: haiku for search/test runs, sonnet for implementation and complex dev, opus only for exceptional architecture/reasoning and the reviewer.
- `reviewer`: only at major milestones, for security-critical changes (RLS/migrations, auth, quotas/billing, file parsing), and release reviews. Scope it to named files or a diff. Never re-review a fix that a test covers; verify with test-runner instead.
- Never let agents repeat work, survey the whole repo, or return long reports (implementer <=120 words, reviewer <=400 words).
- Briefs: exact paths, definition of done, which tests to run. Don't paste whole prior reports into briefs; reference file paths.
- Commit a baseline so reviews can use `git diff` (ask the user first).

## Project facts
- LANGUAGES: az (default), tr, en, ru (user decision: Russian stays) across web, admin, mobile, emails, notifications, AI output. All UI strings via translation keys in packages/i18n (once created); no hardcoded user-facing strings; Campus content is never auto-translated.
- Stack: npm workspaces; Next 16 (web/admin), Expo (mobile), Supabase (Postgres 15 target, pgvector), vitest, TS strict, zod.
- DB tests run on PGlite (Postgres 18, superuser migrations): they do NOT prove PG15 compatibility or hosted-role behaviour.
- AI providers unconfigured: production path must throw ProviderNotConfiguredError; fakes are test-only (`@unimate/core/testing`).
- Never put secrets in NEXT_PUBLIC_*/EXPO_PUBLIC_*; service role stays in edge functions only.
- No deploys, payments, or remote Supabase project creation/migration without the user's approval.
- Honest status: mark each module implemented+tested / implemented untested / not started.
