import { writeFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwnerAs, vec } from "../../packages/db/src/harness";
import { newDb } from "../journeys/helpers";

/**
 * Performance smoke (npm run perf). Seeds realistic volumes on PGlite, runs EXPLAIN (ANALYZE) for the hot paths and fails
 * on a Seq Scan of a large table. PGlite is single-connection WASM Postgres 18 without pg_trgm: timings are indicative
 * only, and the queries are the inner statements of the SQL functions (EXPLAIN cannot see inside plpgsql). RLS is not
 * included (the connection is a superuser). PERF_REPORT=<path> writes the markdown table rows.
 */
const N = { blocks: "~3600", ai_usage: 20_000, users: 600, communities: 200, posts: 20_000, resources: 5_000, orgs: 100, opps: 2_000, notifications: 30_000, xp: 30_000, docs: 100, chunks: 2_000 };
const BIG = 1_000; // a Seq Scan on a table estimated above this many rows is a failure
const uid = (expr: string) => `('00000000-0000-4000-8000-' || lpad((${expr})::text, 12, '0'))::uuid`;
let db: PGlite;
const report: { name: string; ms: number; scans: string }[] = [];
let someUser = "";
let busyCommunity = "";
let quietCommunity = "";

beforeAll(async () => {
  db = await newDb(true);
  const t0 = Date.now();
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data)
      select ${uid("g")}, 'perf' || g || '@example.test', jsonb_build_object('display_name', 'User ' || g)
      from generate_series(1, ${N.users}) g;
    update public.profiles set leaderboard_opt_in = (random() < 0.5), university_id = (select id from public.universities order by name limit 1);
  `);
  someUser = "00000000-0000-4000-8000-000000000001";
  await db.exec(`
    insert into public.communities (name, slug, kind, visibility, created_by)
      select 'Community ' || g, 'perf-' || g, 'course', 'public', ${uid(`1 + g % ${N.users}`)}
      from generate_series(1, ${N.communities}) g;
    insert into public.memberships (community_id, user_id)
      select c.id, u.id from public.communities c join auth.users u on (abs(hashtext(c.id::text || u.id::text)) % 20 = 0)
      on conflict do nothing;
    insert into public.follows (follower_id, followee_id)
      select a.id, b.id from auth.users a join auth.users b on a.id <> b.id and abs(hashtext(a.id::text || b.id::text)) % 40 = 0 on conflict do nothing;
  `);
  // Skewed: community perf-1 gets half of all posts, the rest spread thin (a busy and a quiet community).
  await db.exec(`
    set session_replication_role = replica; -- bulk load: skip per-row campus triggers (rate limits / notifications)
    insert into public.posts (community_id, author_id, title, body, created_at, language)
      select case when g % 2 = 0 then (select id from public.communities where slug = 'perf-1')
                  else (select id from public.communities where slug = 'perf-' || (2 + g % ${N.communities - 1})) end,
             ${uid(`1 + g % ${N.users}`)}, 'Post title ' || g, 'Body of post number ' || g,
             now() - (g || ' minutes')::interval, (array['az','tr','en','ru'])[1 + g % 4]
      from generate_series(1, ${N.posts}) g;
    set session_replication_role = origin;
  `);
  await db.exec(`
    insert into public.resources (uploader_id, title, status, tags, search_norm, created_at, university_id, avg_rating, rating_count)
      select ${uid(`1 + g % ${N.users}`)}, 'Analiz konspekti ' || g, 'published', array['analiz'],
             'analiz konspekti ' || g || ' riyaziyyat', now() - (g || ' minutes')::interval,
             (select id from public.universities order by name limit 1), (g % 50) / 10.0, g % 7
      from generate_series(1, ${N.resources}) g;
    insert into public.organizations (name) select 'Org ' || g from generate_series(1, ${N.orgs}) g;
    insert into public.opportunities (organization_id, kind, title, apply_url, status, published_at, deadline, search_norm, location_norm, skills_norm)
      select (select id from public.organizations where name = 'Org ' || (1 + g % ${N.orgs})), 'internship', 'Intern ' || g,
             'https://example.org/' || g, 'published', now() - (g || ' minutes')::interval, (current_date + (g % 90)),
             'intern ' || g || ' sql', 'baku', array['sql']
      from generate_series(1, ${N.opps}) g;
    insert into public.notifications (user_id, kind, title, template_key, params, created_at)
      select ${uid(`1 + g % ${N.users}`)}, 'seed', 't', 'welcome', '{}', now() - (g || ' seconds')::interval
      from generate_series(1, ${N.notifications}) g;
    insert into public.xp_events (user_id, kind, points, source_key, created_at)
      select ${uid(`1 + g % ${N.users}`)}, 'quiz_correct', 5, 'perf-' || g, now() - (g || ' minutes')::interval
      from generate_series(1, ${N.xp}) g;
    insert into public.documents (user_id, title, storage_path, idempotency_key, status)
      select ${uid(`1 + g % ${N.users}`)}, 'Doc ' || g, ${uid(`1 + g % ${N.users}`)}::text || '/perf-' || g || '.pdf', 'idem-perf-' || g, 'ready'
      from generate_series(1, ${N.docs}) g;
    insert into public.usage_counters (user_id, kind, period_start, n)
      select u.id, 'ai_message', current_date - d, 3 from auth.users u cross join generate_series(0, 30) d;
  `);
  // real 1536-dim vectors (random)
  await db.exec(`
    insert into public.document_chunks (document_id, chunk_index, content, embedding)
      select (select id from public.documents where title = 'Doc ' || (1 + g % ${N.docs})), g, 'chunk ' || g,
             ('[' || (select string_agg(round(random()::numeric, 4)::text, ',') from generate_series(1, 1536)) || ']')::extensions.vector
      from generate_series(1, ${N.chunks}) g;
  `);
  await db.exec(`
    insert into public.blocks (blocker_id, blocked_id)
      select a.id, b.id from auth.users a join auth.users b on a.id <> b.id and abs(hashtext(b.id::text || a.id::text)) % 100 = 0 on conflict do nothing;
    insert into public.ai_usage (user_id, feature, input_tokens, cost_micro_usd, created_at)
      select ${uid(`1 + g % ${N.users}`)}, 'chat', 100, 50, now() - (g || ' minutes')::interval from generate_series(1, 20000) g;
    analyze;
    set search_path = public, extensions;
  `);
  const c = await db.query<{ id: string; c: number }>("select community_id as id, count(*)::int c from public.posts group by 1 order by c desc");
  busyCommunity = c.rows[0]!.id;
  quietCommunity = c.rows[c.rows.length - 1]!.id;
  report.push({ name: `seed (${Object.entries(N).map(([k, v]) => `${k}=${v}`).join(", ")})`, ms: Date.now() - t0, scans: "-" });
});

afterAll(async () => {
  if (process.env.PERF_REPORT) writeFileSync(process.env.PERF_REPORT, report.map((r) => `| ${r.name} | ${r.ms} | ${r.scans} |`).join("\n"));
  await db.close();
});

type Node = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: Node[] };
function walk(n: Node, out: Node[] = []): Node[] {
  out.push(n);
  for (const c of n.Plans ?? []) walk(c, out);
  return out;
}
async function explain(name: string, sql: string, params: unknown[] = [], pre = "") {
  if (pre) await db.exec(pre);
  const r = await db.query<{ "QUERY PLAN": any }>(`explain (analyze, format json) ${sql}`, params);
  if (pre) await db.exec("reset enable_seqscan");
  const plan = r.rows[0]!["QUERY PLAN"][0];
  const nodes = walk(plan.Plan);
  const ms = Math.round(plan["Execution Time"] * 100) / 100;
  const scans = nodes
    .filter((n) => /Scan/.test(n["Node Type"]) && n["Relation Name"])
    .map((n) => `${n["Node Type"]}: ${n["Relation Name"]}${n["Index Name"] ? ` (${n["Index Name"]})` : ""}`)
    .join("; ");
  report.push({ name, ms, scans });
  return { nodes, ms, scans };
}
async function relTuples(table: string) {
  return Number((await db.query<{ n: number }>("select reltuples::float8 n from pg_class where oid = ('public.' || $1)::regclass", [table])).rows[0]!.n);
}
async function noBigSeqScan(r: { nodes: Node[] }) {
  for (const n of r.nodes) {
    if (n["Node Type"] !== "Seq Scan" || !n["Relation Name"]) continue;
    const t = n["Relation Name"];
    expect(await relTuples(t), `Seq Scan on ${t} (large table)`).toBeLessThan(BIG);
  }
}

const feedSql = (where: string) => `
  select p.id, p.created_at from public.posts p
  where p.deleted_at is null ${where}
    and not exists (select 1 from public.blocks b where (b.blocker_id = $1 and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = $1))
  order by p.created_at desc, p.id desc limit 20`;

describe("campus", () => {
  it("community feed (busy community) uses an index", async () => {
    await noBigSeqScan(await explain("community_feed, busy community", feedSql("and p.community_id = $2"), [someUser, busyCommunity]));
  });
  it("community feed (quiet community) uses an index", async () => {
    await noBigSeqScan(await explain("community_feed, quiet community", feedSql("and p.community_id = $2"), [someUser, quietCommunity]));
  });
  it("home feed (memberships OR followed authors) avoids a Seq Scan on posts", async () => {
    const where = `and (p.community_id in (select m.community_id from public.memberships m where m.user_id = $1 and m.status = 'active')
      or p.author_id in (select f.followee_id from public.follows f where f.follower_id = $1))`;
    await noBigSeqScan(await explain("home_feed", feedSql(where), [someUser]));
  });
  it("posts by author", async () => {
    await noBigSeqScan(await explain("user_posts (author)", feedSql("and p.author_id = $2 and not p.is_anonymous"), [someUser, someUser]));
  });
});

describe("notes, career", () => {
  it("search_resources inner query: newest-first browse and a token search", async () => {
    await noBigSeqScan(await explain("search_resources, browse (no query)", `select r.id from public.resources r where r.status = 'published' order by r.created_at desc, r.id limit 20`));
    // With pg_trgm (production) the token filter can use resources_search_trgm; PGlite has no pg_trgm, so it is reported, not asserted.
    await explain("search_resources, token 'riyaziyyat'", `select r.id from public.resources r where r.status = 'published' and r.search_norm like '%riyaziyyat%' order by r.created_at desc, r.id limit 20`);
    await explain("search_resources, sort rating", `select r.id from public.resources r where r.status = 'published' order by r.avg_rating desc nulls last, r.rating_count desc, r.created_at desc limit 20`);
  });
  it("search_opportunities inner query", async () => {
    await noBigSeqScan(
      await explain(
        "search_opportunities, deadline sort",
        `select o.id from public.opportunities o join public.organizations g on g.id = o.organization_id
         where o.status = 'published' and (o.deadline is null or o.deadline >= current_date) order by o.deadline asc nulls last, o.published_at desc, o.id limit 20`,
      ),
    );
  });
});

describe("gamification, notifications, usage", () => {
  it("notification list uses (user_id, created_at desc)", async () => {
    await noBigSeqScan(await explain("list_my_notifications", `select n.id from public.notifications n where n.user_id = $1 order by n.created_at desc, n.id limit 30`, [someUser]));
    await noBigSeqScan(await explain("unread_notification_count", `select count(*) from public.notifications n where n.user_id = $1 and n.read_at is null`, [someUser]));
  });
  it("leaderboard: per-profile XP sums use xp_events_user_idx", async () => {
    const r = await explain(
      "leaderboard (week, university) core",
      `select p.id, coalesce((select sum(e.points) from public.xp_events e where e.user_id = p.id and e.created_at >= now() - interval '7 days'), 0) as pts
       from public.profiles p where p.leaderboard_opt_in and p.university_id = (select id from public.universities order by name limit 1)`,
    );
    await noBigSeqScan({ nodes: r.nodes.filter((n) => n["Relation Name"] === "xp_events") });
    const t = Date.now();
    await asOwnerAs(db, someUser, (tx) => tx.query("select * from public.leaderboard('university', 'week')"));
    report.push({ name: "leaderboard() end to end (owner connection, JWT sub set)", ms: Date.now() - t, scans: "function call" });
  });
  it("usage counters and AI usage lookups are primary-key / user-index probes", async () => {
    await noBigSeqScan(await explain("usage_counters bump lookup", `select n from public.usage_counters where user_id = $1 and kind = 'ai_message' and period_start = current_date`, [someUser]));
    await noBigSeqScan(await explain("ai_usage per user per day", `select coalesce(sum(cost_micro_usd), 0) from public.ai_usage where user_id = $1 and created_at >= date_trunc('day', now())`, [someUser]));
  });
});

describe("RAG", () => {
  const q = vec(3);
  it("match_chunks for one document is index-assisted; the HNSW index is usable for nearest-neighbour", async () => {
    const doc = (await db.query<{ id: string }>("select id from public.documents limit 1")).rows[0]!.id;
    await noBigSeqScan(await explain("match_chunks, one document (k=8)", `select c.id from public.document_chunks c where c.document_id = $1 and c.embedding is not null order by c.embedding <=> $2::extensions.vector limit 8`, [doc, q]));
    await explain("document_chunks ANN, no document filter (k=8), planner's choice", `select c.id from public.document_chunks c order by c.embedding <=> $1::extensions.vector limit 8`, [q]);
    // At 2k rows the planner may legitimately prefer a Seq Scan; assert the index is usable, not that it is chosen.
    const forced = await explain("document_chunks ANN, seqscan disabled (proves HNSW is usable)", `select c.id from public.document_chunks c order by c.embedding <=> $1::extensions.vector limit 8`, [q], "set enable_seqscan = off");
    expect(forced.scans).toContain("document_chunks_embedding_hnsw");
  });
});
