# AI configuration

Founder decision 2026-11-23: provider NVIDIA. Adapter and env variable reference: [AI_PROVIDERS.md](AI_PROVIDERS.md); cost controls: [AI_COST_OPTIMIZATION.md](AI_COST_OPTIMIZATION.md). Everything below is status, not a setup guide.

## Current state
| Item | Status |
| - | - |
| Code defaults `gpt-4o-mini` / `gpt-4o` / `text-embedding-3-small` | Fallbacks only. Production models come from DB tables `ai_models` and `ai_task_routes`, set in the admin console |
| Hosted DB AI rows | Unknown, not read |
| NVIDIA chat models `gemma-4-31b-it`, `deepseek-v4.1-flash` | Referenced only in `scripts/bench-nvidia.mjs` (benchmark script); not wired into routes |
| `nvidia/nemotron-3-embed-1b` | Not referenced anywhere |
| Embedding column | `vector(1536)` with HNSW; NVIDIA embedding mode truncates to 1536. IT with fakes |
| No key configured | Throws `ProviderNotConfiguredError`; HTTP 503. IT |
| Real-provider behaviour | Never tested; all tests use fakes. IU |

## Known quality gaps (not started)
- Summaries, quizzes and flashcards read only the first 30,000 characters (`generate.ts` about line 141).
- `match_chunks` has no similarity threshold.
- No `temperature` is set.
- OCR has never run on real scans.
- Weak-topic detection and personalised study plan are not built.
- A Gemini free-tier script exists only in the backup (`supabase/ops/gemini_free_tier.sql`), deliberately not integrated.

## Steps before enabling AI (all need owner approval)
1. Set edge secrets (`AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, embedding vars) per [DEPLOYMENT.md](DEPLOYMENT.md).
2. Enter models, prices, routes and budget ceilings in admin; confirm the embedding model outputs or truncates to 1536.
3. Run a real Azerbaijani quality/cost evaluation ([AI_PROVIDERS.md](AI_PROVIDERS.md)).
4. Keep NVIDIA while free; the later paid writing provider is a separate decision.
