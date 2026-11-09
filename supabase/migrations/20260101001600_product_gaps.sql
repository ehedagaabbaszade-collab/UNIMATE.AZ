-- Product gaps: account deletion, data export, locale/goals, upload limits, server-side XP, community owner succession.
-- Postgres 15 syntax only.
--
-- Reference data (faculties / majors): intentionally NOT seeded (no fabricated academic structure). They are managed
-- only by admins: policies faculties_/majors_admin_insert|update|delete (is_admin()) already exist; students and
-- moderators are read-only. Admins add rows through the API/dashboard.

-- ---------------------------------------------------------------- 3. profiles.locale / goals
alter table public.profiles drop constraint profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('az', 'en', 'ru', 'tr'));

-- CHECK constraints cannot hold subqueries, hence the immutable helper.
create function public.valid_goals(p_goals text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_goals is not null
     and cardinality(p_goals) <= 10
     and not exists (select 1 from unnest(p_goals) g where g is null or length(btrim(g)) not between 1 and 100)
$$;
alter table public.profiles add column goals text[] not null default '{}'::text[];
alter table public.profiles add constraint profiles_goals_valid check (public.valid_goals(goals));

-- ---------------------------------------------------------------- 4. upload limits (mirror core validateUpload)
-- Core: pdf 50 MiB, docx 25 MiB, pptx 50 MiB, png/jpg 10 MiB; types pdf/docx/pptx/png/jpeg (no text/plain).
-- The bucket can only hold one limit: the largest per-kind limit. Per-kind limits are enforced on documents below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 52428800,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- No CHECK on mime_type itself (existing flows update it); only the size ceiling per declared type.
-- Assumes no existing row exceeds these limits.
alter table public.documents drop constraint documents_size_bytes_check;
alter table public.documents add constraint documents_size_bytes_check check (
  size_bytes is null or (size_bytes >= 1 and size_bytes <= case
    when mime_type in ('image/png', 'image/jpeg') then 10485760
    when mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 26214400
    else 52428800 end));

-- ---------------------------------------------------------------- 1. account deletion (14-day grace)
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'cancelled')),
  scheduled_for timestamptz not null default now() + interval '14 days',
  cancelled_at timestamptz,
  check (scheduled_for > requested_at),
  check ((status = 'cancelled') = (cancelled_at is not null))
);
create unique index account_deletion_one_pending on public.account_deletion_requests(user_id) where status = 'pending';
create index account_deletion_due_idx on public.account_deletion_requests(scheduled_for) where status = 'pending';

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon;
revoke insert, update, delete, truncate, references, trigger on public.account_deletion_requests from authenticated;
create policy account_deletion_owner_select on public.account_deletion_requests for select to authenticated
  using (user_id = (select auth.uid()));
create policy account_deletion_service_all on public.account_deletion_requests for all to service_role using (true) with check (true);

create function public.request_account_deletion() returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_when timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('acct-del:' || v_uid::text, 0));
  select scheduled_for into v_when from public.account_deletion_requests where user_id = v_uid and status = 'pending';
  if found then
    return v_when;
  end if;
  insert into public.account_deletion_requests (user_id) values (v_uid) returning scheduled_for into v_when;
  return v_when;
end $$;

create function public.cancel_account_deletion() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.account_deletion_requests set status = 'cancelled', cancelled_at = now()
    where user_id = v_uid and status = 'pending';
  return found;
end $$;

-- Service-role only. The scheduled edge function `purge-accounts` (supabase/functions/purge-accounts) lists due users
-- here, removes storage objects under "<uid>/" (SQL cannot delete the underlying files), then calls the GoTrue admin
-- API deleteUser(uid), the production path (also revokes sessions). Deleting auth.users cascades to profiles and all
-- owned data. Completion is recorded in audit_logs because the request row cascades away with the profile.
create function public.due_account_deletions(p_limit integer default 50) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select user_id from public.account_deletion_requests
  where status = 'pending' and scheduled_for <= now()
  order by scheduled_for
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;

-- DB-level fallback/ops path: deletes auth.users rows directly (assumes the migration owner role may delete from
-- auth.users on hosted Supabase; unverified). It does NOT remove storage objects. Optional p_user_ids restricts the set.
create function public.purge_due_account_deletions(p_user_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_n integer;
begin
  select array_agg(user_id) into v_ids from (
    select user_id from public.account_deletion_requests
    where status = 'pending' and scheduled_for <= now() and (p_user_ids is null or user_id = any (p_user_ids))
    order by scheduled_for limit 100) s;
  if v_ids is null then
    return 0;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  select null, 'account.purged', 'user', u::text, jsonb_build_object('via', 'purge_due_account_deletions')
  from unnest(v_ids) u;
  delete from auth.users where id = any (v_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.request_account_deletion(), public.cancel_account_deletion() from public, anon;
grant execute on function public.request_account_deletion(), public.cancel_account_deletion() to authenticated;
revoke all on function public.due_account_deletions(integer), public.purge_due_account_deletions(uuid[]) from public, anon, authenticated;
grant execute on function public.due_account_deletions(integer), public.purge_due_account_deletions(uuid[]) to service_role;

-- ---------------------------------------------------------------- 7. community owner succession
-- BEFORE DELETE on profiles (also fires for the auth.users cascade). SECURITY DEFINER so guard_membership_update
-- does not apply. Oldest active moderator, else oldest active member (ties: created_at, user_id). If nobody is left
-- the community stays ownerless.
create function public.promote_successor_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_succ uuid;
begin
  for r in select m.community_id from public.memberships m
           where m.user_id = old.id and m.role = 'owner' and m.status = 'active' loop
    if exists (select 1 from public.memberships o
               where o.community_id = r.community_id and o.role = 'owner' and o.status = 'active' and o.user_id <> old.id) then
      continue;
    end if;
    select m.user_id into v_succ from public.memberships m
      where m.community_id = r.community_id and m.user_id <> old.id and m.status = 'active' and m.role in ('moderator', 'member')
      order by (m.role = 'moderator') desc, m.created_at, m.user_id
      limit 1;
    if v_succ is not null then
      update public.memberships set role = 'owner' where community_id = r.community_id and user_id = v_succ;
    end if;
  end loop;
  return old;
end $$;
revoke all on function public.promote_successor_owner() from public, anon, authenticated;
create trigger profiles_promote_successor_owner before delete on public.profiles
  for each row execute function public.promote_successor_owner();

-- ---------------------------------------------------------------- 5. server-side XP
-- Mirrors packages/core gamification/xp.ts DEFAULT_XP_CONFIG: quizCorrect 10, quizIncorrect 1, reviewCompleted 25,
-- streak bonus 2/day capped at 10 days (correct answers and reviews only), softCap 150 (x0.5 at/after), dailyCap 300,
-- per Asia/Baku calendar day. Idle yields 0. amount_hint is IGNORED (never trusted). Streak bonus uses the streak as of
-- before today's own update (alive if last activity was today or yesterday). source_key = ref_id@baku_day, so a
-- flashcard/question earns at most once per kind per day. Correctness of quiz answers is client-attested (assumption).
create function public.award_xp(p_kind text, p_ref_id uuid, p_amount_hint integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Baku')::date;
  v_day_start timestamptz := (v_today::timestamp at time zone 'Asia/Baku');
  v_day_end timestamptz := ((v_today + 1)::timestamp at time zone 'Asia/Baku');
  v_key text;
  v_earned integer;
  v_streak integer := 0;
  v_last date;
  v_cur integer;
  v_base integer;
  v_bonus boolean;
  v_raw numeric;
  v_award integer;
  v_new_streak integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_kind is null or p_kind not in ('quiz_correct', 'quiz_incorrect', 'review_completed', 'idle') then
    raise exception 'unknown xp kind' using errcode = '22023';
  end if;
  if p_kind = 'idle' then
    return jsonb_build_object('awarded', 0, 'reason', 'idle');
  end if;
  if p_ref_id is null then
    raise exception 'ref_id required' using errcode = '22023';
  end if;
  if p_kind = 'review_completed' then
    if not exists (select 1 from public.flashcards f where f.id = p_ref_id and f.user_id = v_uid) then
      raise exception 'reference not found' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.questions q join public.quizzes z on z.id = q.quiz_id
                    where q.id = p_ref_id and z.user_id = v_uid) then
    raise exception 'reference not found' using errcode = '42501';
  end if;

  insert into public.streaks (user_id) values (v_uid) on conflict (user_id) do nothing;
  select s.current_streak, s.last_active_date into v_cur, v_last from public.streaks s where s.user_id = v_uid for update;
  if v_last is not null and v_last >= v_today - 1 then
    v_streak := v_cur;
  end if;

  v_key := p_ref_id::text || '@' || v_today::text;
  if exists (select 1 from public.xp_events e where e.user_id = v_uid and e.kind = p_kind and e.source_key = v_key) then
    return jsonb_build_object('awarded', 0, 'reason', 'duplicate');
  end if;

  select coalesce(sum(e.points), 0)::integer into v_earned from public.xp_events e
    where e.user_id = v_uid and e.created_at >= v_day_start and e.created_at < v_day_end;

  v_base := case p_kind when 'quiz_correct' then 10 when 'quiz_incorrect' then 1 else 25 end;
  v_bonus := p_kind in ('quiz_correct', 'review_completed');
  v_raw := v_base + (case when v_bonus then least(greatest(v_streak, 0), 10) * 2 else 0 end);
  if v_earned >= 150 then
    v_raw := v_raw * 0.5;
  end if;
  v_award := least(floor(v_raw)::integer, greatest(0, 300 - v_earned));

  if v_award > 0 then
    insert into public.xp_events (user_id, kind, points, source_key) values (v_uid, p_kind, v_award, v_key);
  end if;

  v_new_streak := case when v_last = v_today then v_cur when v_last = v_today - 1 then v_cur + 1 else 1 end;
  update public.streaks set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak), last_active_date = v_today, updated_at = now()
    where user_id = v_uid;

  return jsonb_build_object('awarded', v_award, 'earned_today', v_earned + v_award, 'streak', v_new_streak);
end $$;
revoke all on function public.award_xp(text, uuid, integer) from public, anon;
grant execute on function public.award_xp(text, uuid, integer) to authenticated;

-- ---------------------------------------------------------------- 2. data export
-- SECURITY INVOKER (RLS applies as well) with an explicit ownership filter on every subquery, so staff roles also
-- only ever get their own data. Anonymous posts: only the caller's own, via post_private_authors. ai_usage is
-- aggregated; embeddings, chunks and page text are not exported.
create function public.export_my_data() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = v),
    'documents', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.documents d where d.user_id = v), '[]'),
    'summaries', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.summaries s where s.user_id = v), '[]'),
    'conversations', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('messages', coalesce(
        (select jsonb_agg(to_jsonb(m) order by m.created_at) from public.messages m where m.conversation_id = c.id), '[]'))
        order by c.created_at) from public.conversations c where c.user_id = v), '[]'),
    'quizzes', coalesce((select jsonb_agg(to_jsonb(z) || jsonb_build_object('questions', coalesce(
        (select jsonb_agg(to_jsonb(q) order by q.position) from public.questions q where q.quiz_id = z.id), '[]'))
        order by z.created_at) from public.quizzes z where z.user_id = v), '[]'),
    'attempts', coalesce((select jsonb_agg(to_jsonb(a) order by a.started_at) from public.attempts a where a.user_id = v), '[]'),
    'flashcards', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.flashcards f where f.user_id = v), '[]'),
    'study_sessions', coalesce((select jsonb_agg(to_jsonb(x) order by x.started_at) from public.study_sessions x where x.user_id = v), '[]'),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.tasks t where t.user_id = v), '[]'),
    'exams', coalesce((select jsonb_agg(to_jsonb(e) order by e.starts_at) from public.exams e where e.user_id = v), '[]'),
    'timetable_entries', coalesce((select jsonb_agg(to_jsonb(t) order by t.weekday, t.start_time) from public.timetable_entries t where t.user_id = v), '[]'),
    'enrollments', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.enrollments e where e.user_id = v), '[]'),
    'posts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.posts p where p.author_id = v), '[]'),
    'anonymous_posts', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.posts p
        join public.post_private_authors a on a.post_id = p.id where a.author_id = v), '[]'),
    'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.comments c where c.author_id = v), '[]'),
    'reactions', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reactions r where r.user_id = v), '[]'),
    'memberships', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at) from public.memberships m where m.user_id = v), '[]'),
    'communities_created', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.communities c where c.created_by = v), '[]'),
    'following', coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.follows f where f.follower_id = v), '[]'),
    'blocks', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at) from public.blocks b where b.blocker_id = v), '[]'),
    'resources', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.resources r where r.uploader_id = v), '[]'),
    'resource_ratings', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.resource_ratings r where r.user_id = v), '[]'),
    'resource_saves', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.resource_saves r where r.user_id = v), '[]'),
    'reports_filed', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.reports r where r.reporter_id = v), '[]'),
    'takedown_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.takedown_requests r where r.requester_id = v), '[]'),
    'events_created', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.events e where e.created_by = v), '[]'),
    'notifications', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.notifications n where n.user_id = v), '[]'),
    'xp_events', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.xp_events x where x.user_id = v), '[]'),
    'streak', (select to_jsonb(s) from public.streaks s where s.user_id = v),
    'subscriptions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.subscriptions s where s.user_id = v), '[]'),
    'account_deletion_requests', coalesce((select jsonb_agg(to_jsonb(r) order by r.requested_at) from public.account_deletion_requests r where r.user_id = v), '[]'),
    'ai_usage_summary', coalesce((select jsonb_agg(jsonb_build_object('feature', g.feature, 'model', g.model, 'requests', g.n,
        'input_tokens', g.i, 'output_tokens', g.o, 'cost_micro_usd', g.c) order by g.feature, g.model)
        from (select u.feature, u.model, count(*) n, sum(u.input_tokens) i, sum(u.output_tokens) o, sum(u.cost_micro_usd) c
              from public.ai_usage u where u.user_id = v group by u.feature, u.model) g), '[]')
  );
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
