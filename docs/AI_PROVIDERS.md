# AI provider configuration

Code: `packages/pipeline/src/providers/*` (adapters), `packages/core/src/ai/provider.ts` (interface, routing, cost accounting). Keys are server-side only (Supabase Edge Function secrets); they never reach `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.

## Status
| Piece | Status |
| - | - |
| Provider interface, DB-backed routing by task/plan, pricing, atomic spend ceilings, idempotent settle, fallback cost rule, rate limits, admin cost views | Locally tested (PGlite + unit tests). PGlite is single-connection, so concurrency tests prove the SQL statement logic, not contention between real backends |
| OpenAI-compatible adapter (chat + embeddings; works with any compatible server via `AI_BASE_URL`) | Locally tested with a mocked `fetch` only. NOT called against a live API |
| Anthropic Messages adapter | Locally tested with mocked `fetch` only. NOT called live |
| No key configured | Verified by tests: every call throws `ProviderNotConfiguredError`; HTTP layer returns 503 `ai_not_configured`; the UI shows a clear message. No fake output exists in production code (the FakeProvider lives in `@unimate/core/testing`, test-only) |
| Usage + cost recorded in `ai_usage`, quotas enforced atomically in the DB | Locally tested on PGlite |
| Real accuracy/latency/cost of any model, Azerbaijani answer quality | Unknown until a key is set; run the evaluation checklist below |

## Environment variables (set as Edge Function secrets: `supabase secrets set ...`)
| Variable | Meaning |
| - | - |
| `AI_PROVIDER` | `openai` (any OpenAI-compatible server, default) or `anthropic` |
| `AI_API_KEY` | chat key (falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) |
| `AI_BASE_URL` | optional base URL override (Groq, OpenRouter, a local server...) |
| `EMBED_API_KEY`, `EMBED_BASE_URL` | embeddings endpoint (OpenAI-compatible). Required when `AI_PROVIDER=anthropic` (Anthropic has no embeddings API) |
| `AI_EMBED_MODEL`, `AI_EMBED_DIMENSIONS` | embedding model; the DB column is `vector(1536)`, other sizes are rejected |
| `AI_MODEL_SMALL`, `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM`, `AI_EMBED_MODEL` | LEGACY. No longer read by the edge functions: model names and prices live in the DB (see "Cost architecture"). `modelsFromEnv` remains only for the unguarded test/dev path |
| `ALLOWED_ORIGIN` | required by all edge functions (no `*`) |
| `WORKER_SECRET` | shared secret for the queue worker / purge functions |
| `TESSERACT_LANG_PATH` | optional pinned https host for OCR language data |

## Choosing models (not decided yet; budget 0-500 AZN)
Models, prices, routes and budgets are DB config managed by admins (next section); nothing is hard-coded and nothing defaults to an expensive model. Compare candidates on: Azerbaijani quality, citation faithfulness, cost per 1M tokens, rate limits, free tiers (not guaranteed to stay free). `MODEL_ROUTING` / `DEFAULT_PRICE_TABLE` in `packages/core/src/ai/provider.ts` are legacy test fixtures only.

## Cost architecture (DB-backed; migration `20260101001900_ai_cost_config.sql`)
Code: `packages/core/src/ai/config.ts` (pure `resolveRoute`, cost math, `parseAiConfig`), `packages/pipeline/src/ai-guard.ts` (`GuardedProvider`, `SqlAiLedger`).

| Table | Purpose (admin writes only, through audited RPCs; no secrets) |
| - | - |
| `ai_providers` | name, kind (`openai`/`anthropic`), enabled, `base_url_label` (a label, never a URL with credentials) |
| `ai_models` | provider, model, tier, input / output / cached-input price in micro-USD per 1M tokens (1 USD/MTok = 1,000,000), enabled, `approved_fallback`, `max_output_tokens` |
| `ai_task_routes` | (task, plan) -> primary model + ordered fallback models + `rate_limit_per_min`. Tasks: `extract_cleanup summarize rag chat quiz flashcards exam_simulation embed cv_feedback interview_prep`; plans `free plus pro` |
| `ai_budgets` | scope `user` (key = user id, or `*` = default per user) / `plan` (`free plus pro`) / `global` (`*`), period `day`/`month`, `hard_limit_micro_usd` |
| `config_versions` | full snapshot after every admin write; `admin_revert_config(version, reason)` restores one (validated, audited, recorded as a new version) |

Admin RPCs (all `SECURITY DEFINER`, admin only, each writes `audit_logs` with old/new values): `admin_set_ai_provider`, `admin_set_ai_model`, `admin_set_ai_route`, `admin_delete_ai_route`, `admin_set_ai_budget`, `admin_delete_ai_budget`, `admin_revert_config`. Validation: input price > 0 (output/cached may be 0, e.g. embeddings), cached <= input, limits >= 0, referenced rows exist, and every fallback must be approved, distinct from the primary, and not more expensive than the primary on input, output and cached-input price, nor a higher tier. The rule is re-checked on every write (a price edit that would make a configured fallback pricier is rejected) and again by the pure resolver, which drops violating fallbacks instead of substituting them.

No config means no AI: a missing route, a disabled primary, or a missing global budget returns `ai_not_configured` (HTTP 503). There is no default model and no "unlimited".

### Budget model (reserve, call, settle)
1. `ai_rate_limit_check(user, task)`: fixed 60 s window counter per (user, task), limit from the plan's route -> `rate_limited` + `retryAfterSeconds` (HTTP 429).
2. `reserve_ai_budget(request_id, user, plan, estimate, task, model)`: in one transaction, takes an advisory lock on the request id, then row-locks the global, plan and user spend rows (day and month, fixed order), checks every configured limit against `spent + reserved + estimate`, bumps `reserved`, inserts the reservation. A breach returns `budget_exceeded {scope: user|plan|global}` and changes nothing; the caller never gets a cheaper or pricier model instead. Spend is tracked for all scopes even before a limit exists, so a limit added mid-period sees earlier spend. The plan is derived from `subscriptions` inside the function; a mismatching plan argument is rejected. The same `request_id` returns the existing reservation (never double-reserves); an already settled id makes the guard refuse (`duplicate_request`) without calling the provider.
3. The estimate is the worst case: input tokens (chars/3) plus the full `max_output_tokens` at the primary's prices.
4. `GuardedProvider` calls the provider with a timeout and bounded retries (default 2, exponential, jittered). Only never-billed transient errors (connection failure before a response, HTTP 429/500/502/503) are retried, under the SAME reservation and request id. After the retries a failure moves to the next fallback only if it is cheaper-or-equal and its worst-case estimate still fits the held reservation. Timeouts, bad bodies, 504s and unknown errors are billable: settled at the reserved estimate, no retry, no fallback. Refused requests (other 4xx) and exhausted transient failures are released.
5. `settle_ai_budget` computes the cost in SQL from the stored prices and the reported tokens (cached input priced separately), clamps to the reservation (`clamped = true` on the reservation), moves it from `reserved` to `spent` on all scopes, and writes the single `ai_usage` row (`request_id` unique, `status` `settled | failed_billable | failed_unbilled`). `release_ai_budget` is for requests that never reached the provider. `ai_sweep_orphan_reservations(minutes >= 5)` (service_role; run it on a schedule) releases reservations left by crashed workers, and `admin_ai_stuck_reservations` lists them. Releasing an orphan can under-count spend if the call actually went out.
6. Request ids: one id per billable call (`<base>:gen`, `<base>:repair`, `<base>:embed:<batch>`, `<base>:answer`); a document job uses `job:<jobId>:<attempt>`, because a job retry is new spend.

Quotas (`consumeQuota`: messages per day, docs per month) are unchanged and run first; budgets are additive.

Admin views (aggregates only, no content): `admin_ai_cost_breakdown(days, group)` with group one of day/model/provider/task/plan, `admin_ai_top_spenders` (user ids only), `admin_ai_budget_utilisation`, `admin_ai_failure_rates` (billable/unbilled failures and fallback use per task), `admin_ai_stuck_reservations`.

Known limits: adapters do not report cached-input tokens yet (billed at the full input price, an over-estimate); the timeout cannot cancel the underlying fetch; the config is loaded from the DB per guarded call; the `GROUP` plan has no route (not configured) because it has no billing row.

## Add or replace a provider
No feature code changes are needed.
1. Implement `AiProvider` (`generate`, `embed`) in `packages/pipeline/src/providers/<name>.ts`. Reuse `postJson` so errors carry the right `billable` flag (a refused request must not be billable; a timeout or bad body is). An OpenAI-compatible server needs no code: set `AI_BASE_URL`.
2. Register the kind in `createProviderFromEnv` (`providers/env.ts`: the kind check and constructor), and allow it in the `kind` check constraint of `ai_providers` (new migration) and in `admin_set_ai_provider`.
3. Set the API key as an Edge Function secret (`supabase secrets set AI_API_KEY=...`).
4. As an admin, call `admin_set_ai_provider(name, kind, true, label)`, then `admin_set_ai_model(...)` for each model with the provider's current prices (micro-USD per 1M tokens; mark cheaper models you trust as `approved_fallback`), then `admin_set_ai_route(task, plan, primary, fallbacks, rate_limit)` per (task, plan). Make sure a global budget exists (`admin_set_ai_budget('global', '*', 'day', ...)`). Check the admin cost views; undo a bad change with `admin_revert_config(version, reason)`.

To replace a provider, add the new models, point the routes at them, then disable the old models/provider (`enabled = false`). A route whose primary is disabled fails with `ai_not_configured` rather than falling back.

## Evaluation checklist once a key exists
1. Upload an Azerbaijani PDF; verify summaries keep ə ğ ı ö ü ç ş İ.
2. Ask questions whose answers are NOT in the document: the answer must not carry citations and should be labelled not source-grounded.
3. Upload a document containing prompt-injection text; confirm it is ignored.
4. Check `ai_usage` costs against the provider dashboard; adjust prices with `admin_set_ai_model`.
5. Confirm quotas stop FREE users at the documented limits.

### Career tasks (`cv_feedback`, `interview_prep`)
Added by migration `20260101004300` with NO route rows: until an admin calls `admin_set_ai_route` for them (per plan), the `cv-feedback` and `interview-prep` edge functions answer `503 ai_not_configured` before reading any user data or spending quota. CV text is sent without name, e-mail, phone or links.
