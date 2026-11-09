# AI cost optimization (2026-11-10)

## Audit: what exists (reused, not reinstalled)
- Global routing: `~/.claude/CLAUDE.md` routing table + `~/.claude/hooks/require-subagent-model.py` (PreToolUse on `Agent`; denies any spawn without an explicit non-`inherit` model; project agents in `.claude/agents` are looked up before user agents). `settings.json`: main model `sonnet`, effort `medium`, advisor `opus`.
- Agents (`~/.claude/agents`): `code-searcher` (haiku/low), `test-runner` (haiku/low), `implementer` (sonnet/medium), `reviewer` (opus/high). Model assignments are sensible; nothing was deleted or re-routed.
- Many plugin agents/skills exist (ecc, impeccable, ...). Not duplicated; not needed for this build.

## Why implementer ~69% and reviewer ~18%
Evidence is this session's subagent token counts (the cost-tracker log records commands only, no tokens):
- Implementer runs: ~15k, 65k, 67k, 117k, 155k, 158k, 187k, 355k (+ 3 paused by the rate limit). The build was delegated in large vertical slices (whole web app = 355k), each cold-started with a long brief and a long report.
- Reviewer (opus/high) runs: 43k, 85k, 114k, 117k. Each was pointed at whole packages, not a diff (no commit exists, so `git diff` was unavailable), and wrote probe scripts.
- Rework loop: implement -> review -> fix -> re-review re-reads the same code 3-4 times. The re-review of the ZIP parser cost ~117k opus tokens to find one regex bug plus refund edge cases.
- The orchestrator parallelised multiple agents, so a rate limit hit them all at once (3 agents failed mid-task).
So the share is driven by (a) task size, (b) opus reviews of whole packages, (c) repeat review cycles, (d) long reports. Model routing itself was correct.

## Changes made (all reversible)
1. `UNIMATE.AZ/CLAUDE.md` (new): default workflow - main Claude does small work directly, at most one subagent at a time, parallel only for independent substantial tasks, reviewer only at milestones/security-critical/release, report-length caps.
2. `UNIMATE.AZ/.claude/agents/implementer.md` and `reviewer.md` (new project overrides of the same names): same models/tools, plus scope limits (read only named files, run only touched-package tests, no advisor, no sub-agents) and report caps (implementer <=120 words, reviewer <=400 words, no exploratory probes, no whole-repo review).
3. Originals backed up to `~/.claude/backups/agents-2026-11-10/`. Global agents/CLAUDE.md/settings untouched. Revert = delete the two project agent files and the project `CLAUDE.md`.
4. Fixed the quadratic regex in `packages/pipeline/src/extract/office.ts` directly (one-line fix, no agent).

## Recommendations (not applied)
- Make a baseline git commit so reviewers use `git diff` (needs user approval).
- Run `test-runner` (haiku) instead of `reviewer` to re-verify fixes covered by regression tests.
- Size patches to <=~100k tokens; split by package; run one agent at a time.
- Don't run parallel agents near the 5-hour limit; resume paused agents with SendMessage rather than new cold agents.
- Remaining reviewer budget: one milestone review of admin/mobile, one release security review.
