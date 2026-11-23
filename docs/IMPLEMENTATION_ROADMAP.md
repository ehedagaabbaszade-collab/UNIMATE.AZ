# Implementation roadmap

Phases from the founder brief. Status as of 2026-11-23. Nothing is deployed; each remote step needs owner approval ([DEPLOYMENT.md](DEPLOYMENT.md)).

| Phase | Scope | Status |
| - | - | - |
| 0 | Safety: back up and integrate main checkout's uncommitted work | Done |
| 1 | Security foundation (S1-S10), admin university verification | Done locally; not applied to hosted DB |
| 2 | Persist Dashboard, Documents, AI Study, Planner, Pomodoro, Notes, Quizzes, Flashcards, GPA | Not started |
| 3 | Campus, Career, Teacher portal server storage, Admin sections | Not started |
| 4 | NVIDIA provider + RAG fixes (threshold, chunk limits, embeddings) | Not started |
| 5 | Native focus-lock (compile, Play/Apple policy) | Not started |
| 6 | Design system consolidation | Not started |
| 7 | E2E tests + release | Not started |

## Phase 0 (done)
Main checkout (local master, 30 commits behind origin) had 33 uncommitted changes. Backed up to `C:\Users\acer\Desktop\UNIMATE_BACKUP_2026-11-23` (patch verified with `git apply --check -R`, untracked files copied) and local branch `backup/main-local-2026-11-23`. Main checkout untouched. Integrated in `8bfecb4` (Boss.az links, CV link normalisation, `::text::jsonb` casts, document retry). Not taken: TypeScript 7 to 6 downgrade + lockfile, and `supabase/ops/gemini_free_tier.sql` (founder chose NVIDIA); both remain in the backup.

## Phase 1 (done locally)
Commits `fc7830a`, `9568714`, `cc10bd8`, `7f4c7c6`, `da20ffb`. Details: [SECURITY_REPORT.md](SECURITY_REPORT.md), [DATABASE_CHANGES.md](DATABASE_CHANGES.md).

## Before Phase 2 can start safely
1. Owner approves applying 0056 and 0057 (0056 makes every existing user with a university `pending`).
2. Run the migration set on real PG15 ([POSTGRES15.md](POSTGRES15.md)).
3. Create Vault secrets `project_url` and `worker_secret`.

## Phase 2-7 notes
- Phase 2: replace client-only state; GPA and teacher exams are in scope; paginate documents; drop `select *` in export.
- Phase 4: open items in [AI_CONFIGURATION.md](AI_CONFIGURATION.md); no real-provider tests exist yet.
- Phase 5: needs the Apple Family Controls entitlement request and a Play policy decision first.
- Phase 7: E2E does not exist; gates in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) and [RELEASE_READINESS.md](RELEASE_READINESS.md).
