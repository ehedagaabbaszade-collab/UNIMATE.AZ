# AI provider configuration

Code: `packages/pipeline/src/providers/*` (adapters), `packages/core/src/ai/provider.ts` (interface, routing, cost accounting). Keys are server-side only (Supabase Edge Function secrets); they never reach `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*`.

## Status
| Piece | Status |
| - | - |
| Provider interface, model routing by task/plan, cost accounting | Locally tested (unit tests) |
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
| `AI_MODEL_SMALL`, `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM` | model names per tier. Defaults are placeholders: set real ones |
| `ALLOWED_ORIGIN` | required by all edge functions (no `*`) |
| `WORKER_SECRET` | shared secret for the queue worker / purge functions |
| `TESSERACT_LANG_PATH` | optional pinned https host for OCR language data |

## Choosing models (not decided yet; budget 0-500 AZN)
Route cheap tiers to summaries/flashcards and a stronger tier to exam questions and chat; edit `MODEL_ROUTING` and the price table in `packages/core/src/ai/provider.ts` (prices there are placeholders; update them from the provider's price sheet). Compare candidates on: Azerbaijani quality, citation faithfulness, cost per 1k tokens, rate limits, free tiers (not guaranteed to stay free).

## Evaluation checklist once a key exists
1. Upload an Azerbaijani PDF; verify summaries keep ə ğ ı ö ü ç ş İ.
2. Ask questions whose answers are NOT in the document: the answer must not carry citations and should be labelled not source-grounded.
3. Upload a document containing prompt-injection text; confirm it is ignored.
4. Check `ai_usage` costs against the provider dashboard; adjust the price table.
5. Confirm quotas stop FREE users at the documented limits.
