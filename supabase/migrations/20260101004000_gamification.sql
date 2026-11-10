-- Gamification: level curve, achievements, weekly challenges, opt-in leaderboards, my_progress.
--
-- Trust model: every number comes from server-written tables (xp_events, streaks, attempts, documents). Clients never
-- write achievements, progress or XP. evaluate_achievements() is internal (service_role / definer callers only).
-- Level curve (mirrored in packages/core gamification/level.ts, equality-tested over a table):
--   xp needed to REACH level n = 25 * n * (n - 1)   (L1 = 0, L2 = 50, L3 = 150, L7 = 1050, L8 = 1400), max level 100.
-- Postgres 15 syntax only.

-- ---------------------------------------------------------------- level curve
create function public.level_from_xp(p_xp bigint)
returns table (level integer, start_xp bigint, next_xp bigint)
language plpgsql immutable set search_path = pg_temp as $$
declare
  v_xp bigint := greatest(coalesce(p_xp, 0), 0);
  n integer;
begin
  n := floor((1 + sqrt(1 + 4 * v_xp::numeric / 25)) / 2)::integer;
  n := least(greatest(n, 1), 100);
  while n > 1 and 25::bigint * n * (n - 1) > v_xp loop
    n := n - 1;
  end loop;
  while n < 100 and 25::bigint * (n + 1) * n <= v_xp loop
    n := n + 1;
  end loop;
  return query select n, 25::bigint * n * (n - 1), case when n >= 100 then null::bigint else 25::bigint * (n + 1) * n end;
end $$;
revoke all on function public.level_from_xp(bigint) from public, anon;
grant execute on function public.level_from_xp(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- validation helpers
create function public.gamification_text_ok(j jsonb) returns boolean
language sql immutable set search_path = pg_temp as $$
  select coalesce(jsonb_typeof(j) = 'object' and (
    select bool_and(coalesce(jsonb_typeof(j -> l) = 'string' and length(btrim(j ->> l)) between 1 and 300, false))
    from unnest(array['az', 'tr', 'en', 'ru']) as l), false)
$$;

-- p_kind 'achievement': lifetime metrics. 'challenge': metrics counted inside the challenge window.
create function public.gamification_criteria_valid(c jsonb, p_kind text) returns boolean
language sql immutable set search_path = pg_temp as $$
  select case
    when jsonb_typeof(c) <> 'object' or jsonb_typeof(c -> 'metric') <> 'string' or jsonb_typeof(c -> 'target') <> 'number' then false
    when (c ->> 'target') !~ '^[0-9]{1,7}$' or (c ->> 'target')::integer < 1 then false
    when p_kind = 'achievement' then (c ->> 'metric') in ('documents_ready', 'quizzes_completed', 'streak_longest', 'xp_total', 'flashcard_reviews')
    when p_kind = 'challenge' then (c ->> 'metric') in ('xp', 'quizzes', 'reviews')
    else false end
$$;

-- ---------------------------------------------------------------- achievements (admin-managed)
create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]{2,60}$'),
  name jsonb not null check (public.gamification_text_ok(name)),
  description jsonb not null check (public.gamification_text_ok(description)),
  criteria jsonb not null check (public.gamification_criteria_valid(criteria, 'achievement')),
  icon text not null check (icon ~ '^[a-z0-9-]{2,40}$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.achievements enable row level security;
revoke all on public.achievements from anon;
create policy achievements_select on public.achievements for select to authenticated using (active or public.is_admin());
create policy achievements_admin_insert on public.achievements for insert to authenticated with check (public.is_admin());
create policy achievements_admin_update on public.achievements for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy achievements_admin_delete on public.achievements for delete to authenticated using (public.is_admin());
create policy achievements_service_all on public.achievements for all to service_role using (true) with check (true);

create function public.achievements_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'achievement.' || lower(tg_op), 'achievement', coalesce(new.code, old.code), '{}'::jsonb);
  return null;
end $$;
revoke all on function public.achievements_audit() from public, anon, authenticated;

create table public.user_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
create index user_achievements_ach_idx on public.user_achievements(achievement_id);
alter table public.user_achievements enable row level security;
revoke all on public.user_achievements from anon;
revoke insert, update, delete, truncate, references, trigger on public.user_achievements from authenticated;
create policy user_achievements_owner_select on public.user_achievements for select to authenticated using (user_id = (select auth.uid()));
create policy user_achievements_service_all on public.user_achievements for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------- challenges (admin-managed through RPCs)
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null check (public.gamification_text_ok(title)),
  description jsonb not null check (public.gamification_text_ok(description)),
  criteria jsonb not null check (public.gamification_criteria_valid(criteria, 'challenge')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '31 days')
);
create index challenges_window_idx on public.challenges(starts_at, ends_at) where active;
alter table public.challenges enable row level security;
revoke all on public.challenges from anon;
revoke insert, update, delete, truncate, references, trigger on public.challenges from authenticated;
create policy challenges_select on public.challenges for select to authenticated using (active or public.is_admin());
create policy challenges_service_all on public.challenges for all to service_role using (true) with check (true);

create table public.user_challenge_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, challenge_id)
);
create index user_challenge_progress_challenge_idx on public.user_challenge_progress(challenge_id);
alter table public.user_challenge_progress enable row level security;
revoke all on public.user_challenge_progress from anon;
revoke insert, update, delete, truncate, references, trigger on public.user_challenge_progress from authenticated;
create policy user_challenge_progress_owner_select on public.user_challenge_progress for select to authenticated using (user_id = (select auth.uid()));
create policy user_challenge_progress_service_all on public.user_challenge_progress for all to service_role using (true) with check (true);

-- Admin RPCs (audited like the other admin ops). At most 20 challenges may be active and not yet over.
create function public.admin_create_challenge(p_title jsonb, p_description jsonb, p_criteria jsonb,
                                              p_starts_at timestamptz, p_ends_at timestamptz) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if not public.gamification_text_ok(p_title) or not public.gamification_text_ok(p_description)
     or not public.gamification_criteria_valid(p_criteria, 'challenge') then
    raise exception 'invalid title, description or criteria' using errcode = '22023';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '31 days' then
    raise exception 'invalid window (max 31 days)' using errcode = '22023';
  end if;
  if (select count(*) from public.challenges where active and ends_at > public.now_utc()) >= 20 then
    raise exception 'too many active challenges' using errcode = '54000';
  end if;
  insert into public.challenges (title, description, criteria, starts_at, ends_at, created_by)
  values (p_title, p_description, p_criteria, p_starts_at, p_ends_at, auth.uid()) returning id into v_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'challenge.create', 'challenge', v_id::text,
          jsonb_build_object('criteria', p_criteria, 'starts_at', p_starts_at, 'ends_at', p_ends_at));
  return v_id;
end $$;

create function public.admin_set_challenge_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  update public.challenges set active = coalesce(p_active, false) where id = p_id;
  if not found then
    raise exception 'challenge not found' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'challenge.set_active', 'challenge', p_id::text, jsonb_build_object('active', coalesce(p_active, false)));
end $$;
revoke all on function public.admin_create_challenge(jsonb, jsonb, jsonb, timestamptz, timestamptz),
  public.admin_set_challenge_active(uuid, boolean) from public, anon;
grant execute on function public.admin_create_challenge(jsonb, jsonb, jsonb, timestamptz, timestamptz),
  public.admin_set_challenge_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- leaderboard opt-in
alter table public.profiles add column leaderboard_opt_in boolean not null default false;
create index profiles_leaderboard_idx on public.profiles(university_id) where leaderboard_opt_in;

create function public.set_leaderboard_opt_in(p_opt_in boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_opt_in is null then
    raise exception 'opt-in must be true or false' using errcode = '22023';
  end if;
  update public.profiles set leaderboard_opt_in = p_opt_in where id = auth.uid();
  return p_opt_in;
end $$;
revoke all on function public.set_leaderboard_opt_in(boolean) from public, anon;
grant execute on function public.set_leaderboard_opt_in(boolean) to authenticated;

-- ---------------------------------------------------------------- evaluation (internal)
-- Idempotent: unique (user, achievement) + ON CONFLICT DO NOTHING; the notification is sent only for a fresh unlock.
-- Notification params carry the name as a {az,tr,en,ru} object; render_notification_fields (below) picks the reader's locale.
create function public.evaluate_achievements(p_uid uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := public.now_utc();
  v_docs bigint;
  v_quizzes bigint;
  v_streak bigint;
  v_xp bigint;
  v_reviews bigint;
  a record;
  c record;
  v_value bigint;
  v_ins integer;
  v_new integer := 0;
begin
  if p_uid is null or not exists (select 1 from public.profiles where id = p_uid) then
    return 0;
  end if;
  if exists (select 1 from public.achievements x where x.active
             and not exists (select 1 from public.user_achievements u where u.user_id = p_uid and u.achievement_id = x.id)) then
    select count(*) into v_docs from public.documents d where d.user_id = p_uid and d.status = 'ready';
    select count(*) into v_quizzes from public.attempts t where t.user_id = p_uid;
    select coalesce(max(s.longest_streak), 0) into v_streak from public.streaks s where s.user_id = p_uid;
    select coalesce(sum(e.points), 0) into v_xp from public.xp_events e where e.user_id = p_uid;
    select count(*) into v_reviews from public.xp_events e where e.user_id = p_uid and e.kind = 'review_completed';
    for a in
      select x.* from public.achievements x
      where x.active and not exists (select 1 from public.user_achievements u where u.user_id = p_uid and u.achievement_id = x.id)
      order by x.sort_order, x.code
    loop
      v_value := case a.criteria ->> 'metric'
        when 'documents_ready' then v_docs when 'quizzes_completed' then v_quizzes when 'streak_longest' then v_streak
        when 'xp_total' then v_xp when 'flashcard_reviews' then v_reviews end;
      if v_value >= (a.criteria ->> 'target')::bigint then
        insert into public.user_achievements (user_id, achievement_id, unlocked_at) values (p_uid, a.id, v_now)
          on conflict do nothing;
        get diagnostics v_ins = row_count;
        if v_ins > 0 then
          v_new := v_new + 1;
          perform public.notify_user(p_uid, 'achievement_unlocked',
            jsonb_build_object('code', a.code, 'name', a.name), 'achievement');
        end if;
      end if;
    end loop;
  end if;

  -- challenges running now: progress is counted inside the window only
  for c in select ch.* from public.challenges ch where ch.active and ch.starts_at <= v_now and ch.ends_at > v_now loop
    v_value := case c.criteria ->> 'metric'
      when 'xp' then (select coalesce(sum(e.points), 0) from public.xp_events e
                      where e.user_id = p_uid and e.created_at >= c.starts_at and e.created_at < c.ends_at)
      when 'quizzes' then (select count(*) from public.attempts t
                           where t.user_id = p_uid and t.completed_at >= c.starts_at and t.completed_at < c.ends_at)
      when 'reviews' then (select count(*) from public.xp_events e
                           where e.user_id = p_uid and e.kind = 'review_completed' and e.created_at >= c.starts_at and e.created_at < c.ends_at)
    end;
    v_value := least(coalesce(v_value, 0), (c.criteria ->> 'target')::bigint);
    insert into public.user_challenge_progress (user_id, challenge_id, progress, completed_at, updated_at)
    values (p_uid, c.id, v_value::integer, case when v_value >= (c.criteria ->> 'target')::bigint then v_now end, v_now)
    on conflict (user_id, challenge_id) do update
      set progress = greatest(public.user_challenge_progress.progress, excluded.progress),
          completed_at = coalesce(public.user_challenge_progress.completed_at, excluded.completed_at),
          updated_at = excluded.updated_at
      where public.user_challenge_progress.completed_at is null;
    if exists (select 1 from public.user_challenge_progress p where p.user_id = p_uid and p.challenge_id = c.id and p.completed_at is not null)
       and not exists (select 1 from public.notifications n
                       where n.user_id = p_uid and n.template_key = 'challenge_completed' and n.params ->> 'challenge_id' = c.id::text) then
      perform public.notify_user(p_uid, 'challenge_completed',
        jsonb_build_object('challenge_id', c.id, 'title', c.title), 'challenge');
    end if;
  end loop;
  return v_new;
end $$;
revoke all on function public.evaluate_achievements(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_achievements(uuid) to service_role;

-- Triggers for the paths that do not go through award_xp_internal (which calls evaluate itself, see 20260101004050).
create function public.gamification_after_attempt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.evaluate_achievements(new.user_id);
  return null;
end $$;
create trigger attempts_gamification after insert on public.attempts
  for each row execute function public.gamification_after_attempt();

create function public.gamification_after_document() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'ready' and old.status is distinct from 'ready' then
    perform public.evaluate_achievements(new.user_id);
  end if;
  return null;
end $$;
create trigger documents_gamification after update of status on public.documents
  for each row execute function public.gamification_after_document();
revoke all on function public.gamification_after_attempt(), public.gamification_after_document() from public, anon, authenticated;

-- ---------------------------------------------------------------- my_progress / my_achievements
create function public.my_progress() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := public.now_utc();
  v_today date := (public.now_utc() at time zone 'Asia/Baku')::date;
  v_xp bigint;
  lv record;
  s record;
  v_live integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform public.evaluate_achievements(v_uid);
  select coalesce(sum(e.points), 0) into v_xp from public.xp_events e where e.user_id = v_uid;
  select * into lv from public.level_from_xp(v_xp);
  select * into s from public.streaks where user_id = v_uid;
  if found and s.last_active_date is not null and s.last_active_date >= v_today - 1 then
    v_live := s.current_streak;
  end if;
  return jsonb_build_object(
    'xp', v_xp,
    'level', lv.level,
    'level_start_xp', lv.start_xp,
    'next_level_xp', lv.next_xp,
    'xp_into_level', v_xp - lv.start_xp,
    'xp_to_next', case when lv.next_xp is null then 0 else lv.next_xp - v_xp end,
    'level_progress', case when lv.next_xp is null then 1 else round((v_xp - lv.start_xp)::numeric / (lv.next_xp - lv.start_xp), 4) end,
    'streak', jsonb_build_object('current', v_live, 'longest', coalesce(s.longest_streak, 0)),
    'achievements', jsonb_build_object(
      'unlocked', (select count(*) from public.user_achievements u join public.achievements x on x.id = u.achievement_id
                   where u.user_id = v_uid and x.active),
      'total', (select count(*) from public.achievements where active)),
    'leaderboard_opt_in', coalesce((select p.leaderboard_opt_in from public.profiles p where p.id = v_uid), false),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'description', c.description,
        'metric', c.criteria ->> 'metric', 'target', (c.criteria ->> 'target')::integer,
        'progress', coalesce(p.progress, 0), 'completed', p.completed_at is not null,
        'starts_at', c.starts_at, 'ends_at', c.ends_at) order by c.ends_at, c.id)
      from public.challenges c
      left join public.user_challenge_progress p on p.challenge_id = c.id and p.user_id = v_uid
      where c.active and c.starts_at <= v_now and c.ends_at > v_now), '[]'::jsonb));
end $$;
revoke all on function public.my_progress() from public, anon;
grant execute on function public.my_progress() to authenticated;

-- Every active achievement with the caller's unlock state and current value (so the UI can show progress).
create function public.my_achievements() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_docs bigint;
  v_quizzes bigint;
  v_streak bigint;
  v_xp bigint;
  v_reviews bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform public.evaluate_achievements(v_uid);
  select count(*) into v_docs from public.documents d where d.user_id = v_uid and d.status = 'ready';
  select count(*) into v_quizzes from public.attempts t where t.user_id = v_uid;
  select coalesce(max(s.longest_streak), 0) into v_streak from public.streaks s where s.user_id = v_uid;
  select coalesce(sum(e.points), 0) into v_xp from public.xp_events e where e.user_id = v_uid;
  select count(*) into v_reviews from public.xp_events e where e.user_id = v_uid and e.kind = 'review_completed';
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', a.code, 'name', a.name, 'description', a.description, 'icon', a.icon,
      'metric', a.criteria ->> 'metric', 'target', (a.criteria ->> 'target')::integer,
      'current', least(case a.criteria ->> 'metric' when 'documents_ready' then v_docs when 'quizzes_completed' then v_quizzes
                        when 'streak_longest' then v_streak when 'xp_total' then v_xp else v_reviews end, (a.criteria ->> 'target')::bigint),
      'unlocked_at', u.unlocked_at) order by a.sort_order, a.code)
    from public.achievements a
    left join public.user_achievements u on u.achievement_id = a.id and u.user_id = v_uid
    where a.active), '[]'::jsonb);
end $$;
revoke all on function public.my_achievements() from public, anon;
grant execute on function public.my_achievements() to authenticated;

-- ---------------------------------------------------------------- leaderboard (opt-in only)
-- Returns the top 50 opted-in users for the scope/period plus the caller's own row (rank null when the caller has not
-- opted in or has no XP in the period). No user ids, emails or other profile data. Users in a block relationship with
-- the caller are excluded. 'university' needs the caller to have a university.
create function public.leaderboard(p_scope text, p_period text)
returns table (rank integer, display_name text, avatar_url text, xp bigint, is_me boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_uni uuid;
  v_since timestamptz := '-infinity';
  v_now timestamptz := public.now_utc();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_scope is null or p_scope not in ('university', 'global') or p_period is null or p_period not in ('week', 'all') then
    raise exception 'scope must be university|global and period week|all' using errcode = '22023';
  end if;
  select p.university_id into v_uni from public.profiles p where p.id = v_uid;
  if p_period = 'week' then
    v_since := (date_trunc('week', v_now at time zone 'Asia/Baku')) at time zone 'Asia/Baku';
  end if;
  return query
  with totals as (
    select p.id, coalesce(nullif(btrim(p.display_name), ''), p.username) as name, p.avatar_url,
           coalesce((select sum(e.points) from public.xp_events e where e.user_id = p.id and e.created_at >= v_since), 0)::bigint as pts
    from public.profiles p
    where p.leaderboard_opt_in
      and (p_scope = 'global' or (v_uni is not null and p.university_id = v_uni))
      and (p.id = v_uid or not public.has_block_between(p.id))
  ), ranked as (
    select t.id, t.name, t.avatar_url, t.pts, rank() over (order by t.pts desc)::integer as rnk from totals t where t.pts > 0
  ), mine as (
    select coalesce((select sum(e.points) from public.xp_events e where e.user_id = v_uid and e.created_at >= v_since), 0)::bigint as pts
  )
  select q.rnk, q.name, q.avatar_url, q.pts, q.me from (
    select r.rnk, r.name, r.avatar_url, r.pts, r.id = v_uid as me
    from ranked r where r.rnk <= 50 or r.id = v_uid
    union all
    select null::integer, null::text, null::text, m.pts, true
    from mine m where not exists (select 1 from ranked r where r.id = v_uid)
  ) q
  order by q.rnk nulls last, q.pts desc;
end $$;
revoke all on function public.leaderboard(text, text) from public, anon;
grant execute on function public.leaderboard(text, text) to authenticated;

-- ---------------------------------------------------------------- localized params in notifications
-- A param whose value is a JSON object keyed by locale ({"az": ..., "tr": ...}) is resolved to the template's locale
-- (falling back to az) before substitution, so one stored notification renders correctly in every language and the
-- templates keep identical placeholders across locales. Scalar params behave exactly as before.
create or replace function public.render_notification_fields(p_key text, p_params jsonb, p_locale text, p_title text, p_body text)
returns table (title text, body text, locale text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  t record;
  v_params jsonb;
begin
  if p_key is not null then
    select x.title, x.body, x.locale into t from public.notification_templates x
      where x.key = p_key and x.locale in (coalesce(p_locale, 'az'), 'az')
      order by (x.locale = coalesce(p_locale, 'az')) desc limit 1;
    if found then
      select coalesce(jsonb_object_agg(e.k, case when jsonb_typeof(e.v) = 'object' then coalesce(e.v -> t.locale, e.v -> 'az') else e.v end), '{}'::jsonb)
        into v_params from jsonb_each(coalesce(p_params, '{}'::jsonb)) as e(k, v);
      return query select public.render_template_text(t.title, v_params), public.render_template_text(t.body, v_params), t.locale;
      return;
    end if;
  end if;
  return query select coalesce(p_title, p_key), p_body, 'az'::text;
end $$;

-- ---------------------------------------------------------------- templates (NEEDS NATIVE REVIEW) and starter set
insert into public.notification_templates (key, locale, title, body) values
  ('achievement_unlocked', 'az', 'Yeni nailiyyət', '“{name}” nailiyyətini qazandınız.'),
  ('achievement_unlocked', 'tr', 'Yeni başarı', '“{name}” başarısını kazandınız.'),
  ('achievement_unlocked', 'en', 'New achievement', 'You unlocked “{name}”.'),
  ('achievement_unlocked', 'ru', 'Новое достижение', 'Вы получили достижение «{name}».'),
  ('challenge_completed', 'az', 'Çağırış tamamlandı', '“{title}” çağırışını tamamladınız.'),
  ('challenge_completed', 'tr', 'Meydan okuma tamamlandı', '“{title}” meydan okumasını tamamladınız.'),
  ('challenge_completed', 'en', 'Challenge completed', 'You completed “{title}”.'),
  ('challenge_completed', 'ru', 'Испытание пройдено', 'Вы завершили испытание «{title}».')
on conflict (key, locale) do nothing;

-- Only criteria that are computable from trusted tables today. Names/descriptions: needs native-speaker review.
insert into public.achievements (code, name, description, criteria, icon, sort_order) values
  ('first_document', '{"az":"İlk sənəd","tr":"İlk belge","en":"First document","ru":"Первый документ"}',
   '{"az":"İlk sənədini yüklə və emal olunmasını gözlə.","tr":"İlk belgeni yükle ve işlenmesini bekle.","en":"Upload your first document and let it be processed.","ru":"Загрузите первый документ и дождитесь его обработки."}',
   '{"metric":"documents_ready","target":1}', 'upload', 10),
  ('first_quiz', '{"az":"İlk test","tr":"İlk test","en":"First quiz","ru":"Первый тест"}',
   '{"az":"Bir testi sona qədər tamamla.","tr":"Bir testi sonuna kadar tamamla.","en":"Complete a quiz.","ru":"Пройдите тест до конца."}',
   '{"metric":"quizzes_completed","target":1}', 'quiz', 20),
  ('streak_3', '{"az":"3 günlük seriya","tr":"3 günlük seri","en":"3-day streak","ru":"Серия 3 дня"}',
   '{"az":"Ardıcıl 3 gün çalış.","tr":"Üst üste 3 gün çalış.","en":"Study 3 days in a row.","ru":"Занимайтесь 3 дня подряд."}',
   '{"metric":"streak_longest","target":3}', 'streak', 30),
  ('streak_7', '{"az":"7 günlük seriya","tr":"7 günlük seri","en":"7-day streak","ru":"Серия 7 дней"}',
   '{"az":"Ardıcıl 7 gün çalış.","tr":"Üst üste 7 gün çalış.","en":"Study 7 days in a row.","ru":"Занимайтесь 7 дней подряд."}',
   '{"metric":"streak_longest","target":7}', 'streak', 40),
  ('streak_30', '{"az":"30 günlük seriya","tr":"30 günlük seri","en":"30-day streak","ru":"Серия 30 дней"}',
   '{"az":"Ardıcıl 30 gün çalış.","tr":"Üst üste 30 gün çalış.","en":"Study 30 days in a row.","ru":"Занимайтесь 30 дней подряд."}',
   '{"metric":"streak_longest","target":30}', 'streak', 50),
  ('xp_100', '{"az":"100 XP","tr":"100 XP","en":"100 XP","ru":"100 XP"}',
   '{"az":"Cəmi 100 XP topla.","tr":"Toplam 100 XP kazan.","en":"Earn 100 XP in total.","ru":"Наберите 100 XP в сумме."}',
   '{"metric":"xp_total","target":100}', 'xp', 60),
  ('xp_1000', '{"az":"1000 XP","tr":"1000 XP","en":"1000 XP","ru":"1000 XP"}',
   '{"az":"Cəmi 1000 XP topla.","tr":"Toplam 1000 XP kazan.","en":"Earn 1000 XP in total.","ru":"Наберите 1000 XP в сумме."}',
   '{"metric":"xp_total","target":1000}', 'xp', 70),
  ('flashcards_10', '{"az":"10 kart təkrarı","tr":"10 kart tekrarı","en":"10 cards reviewed","ru":"10 карточек повторено"}',
   '{"az":"10 flash kartı təkrarla.","tr":"10 bilgi kartını tekrar et.","en":"Review 10 flashcards.","ru":"Повторите 10 карточек."}',
   '{"metric":"flashcard_reviews","target":10}', 'flashcard', 80)
on conflict (code) do nothing;

-- Created after the seed above so the starter rows do not write audit entries (only later admin edits do).
create trigger achievements_audit after insert or update or delete on public.achievements
  for each row execute function public.achievements_audit();
