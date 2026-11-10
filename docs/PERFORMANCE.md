# Performance smoke

Run with `npm run perf` (about 15 s; not part of `npx vitest run`). Source: `tests/perf/hotpaths.perf.ts`, config `vitest.perf.config.mts`.

## What it does

Seeds a fresh PGlite (all migrations + seed) with: 600 users, 200 communities (one holds half of the 20,000 posts, so there is a busy and a quiet community), about 3,600 blocks, 5,000 published resources, 100 organizations, 2,000 published opportunities, 30,000 notifications, 30,000 XP events, 20,000 `ai_usage` rows, 100 documents with 2,000 chunks that carry real 1536-dimension vectors, and 600 x 31 usage counters. It then runs `EXPLAIN (ANALYZE, FORMAT JSON)` on the inner statement of each hot path. The test fails when a Seq Scan of a table with more than 1,000 estimated rows appears (except the cases listed under "Reported, not asserted").

## Results (one run, 2026-11-10; milliseconds, warm)

| Hot path | ms | Plan |
| - | - | - |
| community feed, busy community | 1.0 | `posts_feed_idx` (backward scan, filtered) |
| community feed, quiet community | 0.7 | `posts_community_idx` |
| home feed (memberships OR follows) | 1.9 | `posts_feed_idx`, `memberships_user_idx`, `follows_pkey` |
| posts by author | 0.3 | bitmap on `posts_author_idx` |
| search_resources, browse | 0.05 | `resources_listing_idx` |
| search_resources, token filter | 1.3 | Seq Scan (see below) |
| search_resources, sort by rating | 5.1 | Seq Scan (see below) |
| search_opportunities, deadline sort | 0.4 | `opportunities_feed_idx` |
| list_my_notifications | 0.07 | `notifications_user_idx` |
| unread count | 0.1 | bitmap on `notifications_unread_idx` |
| leaderboard core (week, university) | 5.9 | `profiles_leaderboard_idx` + `xp_events` bitmap per profile |
| leaderboard() end to end | 13-26 | function call (about 300 opted-in profiles) |
| usage counter lookup | 0.02 | `usage_counters_pkey` |
| ai_usage per user per day | 0.1 | bitmap on `ai_usage_user_idx` |
| match_chunks, one document | 0.3 | bitmap on the document index, then sort |
| chunk nearest-neighbour, no document filter | 0.9 | `document_chunks_embedding_hnsw` |

## Findings

- No new index was needed: every asserted path already uses an index. No migration was added for this phase.
- `match_chunks` always filters by document, so the planner correctly uses the document index and sorts the few chunks of that document. The HNSW index is chosen for an unfiltered nearest-neighbour query and is also proven usable with `enable_seqscan = off`. If cross-document search is ever added, HNSW is ready.
- **Reported, not asserted:**
  - `search_resources` token filter (`search_norm like '%token%'`): PGlite has no `pg_trgm`, so the GIN trigram index `resources_search_trgm` (created by migration 4200 only when the extension exists, as on Supabase) is not present here. The plan above is therefore the fallback. Production behaviour with trigram is unmeasured.
  - `search_opportunities` has no trigram index at all. Its token filter runs after the `opportunities_feed_idx` ordered scan, which is fine for a curated catalogue (thousands of rows) but should be revisited above roughly 50,000 listings.
  - `search_resources` sort by rating or saves orders by a `CASE` expression, which no btree index can serve, so it scans the visible published set (5 ms at 5,000 rows; expect linear growth). Adding a plain index would not help the function as written; the fix is to rewrite the function with one `ORDER BY` per sort, then add partial indexes on `(avg_rating desc, rating_count desc)` and `(save_count desc)`. Not done here (function rewrite is out of scope for the quality phase).
  - `leaderboard('global', ...)` must visit every opted-in profile and sum its XP; it scales with opted-in users, not with a limit. A materialised weekly table would be the next step if that exceeds a few thousand users.
  - The home feed filters with an OR of two subqueries; it is fast now because the newest-first index finds 20 rows quickly. A user who follows nobody and has no memberships makes the planner scan far; there is no test for that edge.

## Limits of this evidence

PGlite is single-connection, in-process WASM Postgres 18: timings are indicative only, there is no concurrency, no network, no shared-buffer pressure, and no RLS (the connection is a superuser, so policy subplans such as `can_view_resource` and `is_member` are not measured; `SECURITY DEFINER` functions were replaced by their inner statements because EXPLAIN cannot see inside plpgsql). Plans on a hosted PG15 with real statistics and RLS may differ. Re-run `EXPLAIN` on a staging database before launch.
