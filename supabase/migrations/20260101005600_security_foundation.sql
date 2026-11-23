-- Security foundation (founder decisions S1, S2, S5, S6, S7, S8, S10). Forward-only; reverse statements are listed
-- in the commented ROLLBACK section at the end.

-- ---------------------------------------------------------------- S5. no more auto-exposed objects
-- 004900 set classic-style default privileges (ALL to anon/authenticated on every new object). From here on new
-- objects are private until a migration grants them explicitly. service_role keeps its defaults.
-- The built-in PUBLIC EXECUTE on new functions is dropped too (global default for the migration owner); every
-- function below still revokes/grants explicitly. Targets role postgres (the hosted migration owner); falls back to
-- the current role where postgres does not exist.
do $$
declare v_for text := case when exists (select 1 from pg_roles where rolname = 'postgres') then 'for role postgres ' else '' end;
begin
  execute 'alter default privileges ' || v_for || 'in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges ' || v_for || 'in schema public revoke all on sequences from anon, authenticated';
  execute 'alter default privileges ' || v_for || 'in schema public revoke all on functions from anon, authenticated';
  execute 'alter default privileges ' || v_for || 'revoke execute on functions from public';
end $$;

-- ---------------------------------------------------------------- S7. trim dangerous table/sequence privileges
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------- S1. university verification (staff only)
alter table public.profiles
  add column university_status text not null default 'none'
    check (university_status in ('none', 'pending', 'approved', 'rejected')),
  add column university_reviewed_at timestamptz,
  add column university_reviewed_by uuid references public.profiles(id) on delete set null,
  add column university_review_note text check (university_review_note is null or length(university_review_note) <= 500);
create index profiles_university_status_idx on public.profiles(university_status, created_at) where university_status <> 'none';

-- Existing claims were never verified.
update public.profiles set university_status = 'pending' where university_id is not null;

-- University-community membership requires the APPROVED university. Runs after any verification/university change
-- (user edit, staff review, FK set-null) and once now for the backfill above. Bans are kept (no ban evasion).
create function public.profiles_prune_university_memberships() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.memberships m
  using public.communities c
  where m.user_id = new.id and c.id = m.community_id and c.kind = 'university' and m.status <> 'banned'
    and c.university_id is distinct from (case when new.university_status = 'approved' then new.university_id end);
  return null;
end $$;
revoke all on function public.profiles_prune_university_memberships() from public, anon, authenticated, service_role;
create trigger profiles_prune_university_memberships after update of university_id, university_status on public.profiles
  for each row execute function public.profiles_prune_university_memberships();

delete from public.memberships m
using public.communities c, public.profiles p
where c.id = m.community_id and c.kind = 'university' and p.id = m.user_id and m.status <> 'banned'
  and c.university_id is distinct from (case when p.university_status = 'approved' then p.university_id end);

-- Same role rules as before, plus: API roles never write the verification columns, and any university_id change
-- (by anyone, staff included, unless the same statement sets the status - only the review RPC does) resets it.
create or replace function public.guard_profile_role() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_api boolean := current_user in ('anon', 'authenticated');
begin
  if v_api then
    if tg_op = 'INSERT' then
      if new.role <> 'student' then
        raise exception 'new profiles must have role student' using errcode = '42501';
      end if;
    else
      if new.id is distinct from old.id then
        raise exception 'profile id is immutable' using errcode = '42501';
      end if;
      if new.role is distinct from old.role then
        if new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin') then
          if not public.is_super_admin() then
            raise exception 'only super_admin may grant or revoke admin roles' using errcode = '42501';
          end if;
        elsif not public.is_admin() then
          raise exception 'only admins may change roles' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if v_api then
      new.university_status := case when new.university_id is null then 'none' else 'pending' end;
      new.university_reviewed_at := null;
      new.university_reviewed_by := null;
      new.university_review_note := null;
    elsif new.university_id is not null and new.university_status = 'none' then
      new.university_status := 'pending';
    end if;
  else
    if v_api and (new.university_status, new.university_reviewed_at, new.university_reviewed_by, new.university_review_note)
        is distinct from (old.university_status, old.university_reviewed_at, old.university_reviewed_by, old.university_review_note) then
      raise exception 'university verification is set by staff review only' using errcode = '42501';
    end if;
    if new.university_id is distinct from old.university_id and new.university_status is not distinct from old.university_status then
      new.university_status := case when new.university_id is null then 'none' else 'pending' end;
      new.university_reviewed_at := null;
      new.university_reviewed_by := null;
      new.university_review_note := null;
    end if;
  end if;
  return new;
end $$;

-- The single helper every university-scoped policy/function uses (resources_select, can_view_resource,
-- shared_visible -> shared_quizzes/shared_decks, join_community, memberships join trigger, create_community,
-- create_event). It now returns the university only once staff approved it.
create or replace function public.my_university_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.university_id from public.profiles p where p.id = auth.uid() and p.university_status = 'approved'
$$;

-- Was: profiles.university_id read directly. Now: verified university only.
create or replace function public.ensure_university_community(p_university uuid, p_join boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_name text;
  v_id uuid;
begin
  select u.name into v_name from public.universities u where u.id = p_university;
  if not found then
    raise exception 'university not found' using errcode = 'P0002';
  end if;
  insert into public.communities (university_id, name, slug, visibility, kind, created_by)
  values (p_university, left(btrim(v_name), 100), 'uni-' || replace(p_university::text, '-', ''), 'public', 'university', null)
  on conflict (university_id) where kind = 'university' do nothing;
  select c.id into v_id from public.communities c where c.university_id = p_university and c.kind = 'university';
  if coalesce(p_join, false) then
    if p_university is distinct from public.my_university_id() then
      raise exception 'you can only join the community of your own university' using errcode = '42501';
    end if;
    if exists (select 1 from public.memberships m where m.community_id = v_id and m.user_id = v_uid and m.status = 'banned') then
      raise exception 'you are banned from this community' using errcode = '42501';
    end if;
    insert into public.memberships (community_id, user_id, role, status) values (v_id, v_uid, 'member', 'active')
    on conflict do nothing;
  end if;
  return v_id;
end $$;

-- Was: caller's unverified university, and unverified users listed. Now: verified caller, verified peers only.
create or replace function public.leaderboard(p_scope text, p_period text)
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
  v_uni := public.my_university_id();
  if p_period = 'week' then
    v_since := (date_trunc('week', v_now at time zone 'Asia/Baku')) at time zone 'Asia/Baku';
  end if;
  return query
  with totals as (
    select p.id, coalesce(nullif(btrim(p.display_name), ''), p.username) as name, p.avatar_url,
           coalesce((select sum(e.points) from public.xp_events e where e.user_id = p.id and e.created_at >= v_since), 0)::bigint as pts
    from public.profiles p
    where p.leaderboard_opt_in
      and (p_scope = 'global' or (v_uni is not null and p.university_id = v_uni and p.university_status = 'approved'))
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

create function public.admin_list_university_requests(p_status text default 'pending', p_limit integer default 25,
  p_offset integer default 0)
returns table (id uuid, display_name text, username text, university_id uuid, university_name text,
               university_status text, university_reviewed_at timestamptz, university_reviewed_by uuid,
               university_review_note text, created_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('none', 'pending', 'approved', 'rejected') then
    raise exception 'status must be none|pending|approved|rejected' using errcode = '22023';
  end if;
  return query
  select p.id, p.display_name, p.username, p.university_id, u.name, p.university_status, p.university_reviewed_at,
         p.university_reviewed_by, p.university_review_note, p.created_at, count(*) over ()
  from public.profiles p
  left join public.universities u on u.id = p.university_id
  where p_status is null or p.university_status = p_status
  order by p.created_at, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- p_university = the university the reviewer saw; a mismatch means the user changed it meanwhile.
create function public.admin_review_university(p_user uuid, p_university uuid, p_approve boolean, p_note text default null)
returns table (id uuid, university_id uuid, university_status text, university_reviewed_at timestamptz,
               university_reviewed_by uuid, university_review_note text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uni uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_user is null or p_university is null or p_approve is null then
    raise exception 'user, university and decision are required' using errcode = '22023';
  end if;
  if p_user = auth.uid() then
    raise exception 'cannot review your own university' using errcode = '42501';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'note too long (max 500)' using errcode = '22023';
  end if;
  select p.university_id into v_uni from public.profiles p where p.id = p_user for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_uni is null then
    raise exception 'user has no university to review' using errcode = '22023';
  end if;
  if v_uni <> p_university then
    raise exception 'university changed since the request was loaded' using errcode = '40001';
  end if;
  update public.profiles p
     set university_status = case when p_approve then 'approved' else 'rejected' end,
         university_reviewed_at = now(), university_reviewed_by = auth.uid(), university_review_note = v_note
   where p.id = p_user;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_approve then 'university.approve' else 'university.reject' end, 'user', p_user::text,
          jsonb_build_object('university_id', v_uni, 'note', v_note));
  return query
  select p.id, p.university_id, p.university_status, p.university_reviewed_at, p.university_reviewed_by, p.university_review_note
  from public.profiles p where p.id = p_user;
end $$;

revoke all on function public.admin_list_university_requests(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_university_requests(text, integer, integer) to authenticated, service_role;
revoke all on function public.admin_review_university(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_review_university(uuid, uuid, boolean, text) to authenticated, service_role;

-- Publishing to a university audience needs that university to be the author's APPROVED one. One trigger instead of
-- patching create_resource / share_quiz / share_flashcards: it also covers direct INSERT/UPDATE on resources
-- (authenticated holds those grants) and both create_resource branches (course university or profile university).
-- Only fires for the author's own rows (auth.uid() = owner), so staff moderation and service jobs are unaffected.
create function public.guard_university_visibility() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := coalesce(to_jsonb(new) ->> 'uploader_id', to_jsonb(new) ->> 'owner_id')::uuid;
begin
  if new.visibility = 'university' and auth.uid() is not null and v_owner = auth.uid()
     and new.university_id is distinct from public.my_university_id() then
    raise exception 'university visibility needs your approved university' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.guard_university_visibility() from public, anon, authenticated, service_role;
create trigger resources_guard_university_visibility before insert or update of visibility, university_id on public.resources
  for each row execute function public.guard_university_visibility();
create trigger shared_quizzes_guard_university_visibility before insert or update of visibility, university_id on public.shared_quizzes
  for each row execute function public.guard_university_visibility();
create trigger shared_decks_guard_university_visibility before insert or update of visibility, university_id on public.shared_decks
  for each row execute function public.guard_university_visibility();

-- Same body as 20260101004500 plus the university-community check join_community has.
create or replace function public.join_by_code(p_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_now timestamptz := public.now_utc();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id uuid;
begin
  if (select count(*) from public.campus_actions where kind = 'invite_miss' and created_at > v_now - interval '10 minutes') >= 500 then
    raise exception 'too many invalid invite codes, try again later' using errcode = '54000';
  end if;
  if (select count(*) from public.campus_actions where user_id = v_uid and kind = 'invite_miss' and created_at > v_now - interval '1 hour') >= 10 then
    raise exception 'too many invalid invite codes, try again later' using errcode = '54000';
  end if;
  perform public.campus_rate_check('invite_code', interval '1 hour', 20);
  if v_code ~ '^[A-Z0-9]{16,64}$' then
    select i.community_id into v_id from public.community_invites i where i.code = v_code;
  end if;
  if v_id is null then
    insert into public.campus_actions (user_id, kind, created_at) values (v_uid, 'invite_miss', v_now);
    return null;
  end if;
  if exists (select 1 from public.memberships m where m.community_id = v_id and m.user_id = v_uid and m.status = 'banned') then
    raise exception 'you are banned from this community' using errcode = '42501';
  end if;
  if exists (select 1 from public.communities c where c.id = v_id and c.kind = 'university'
             and c.university_id is distinct from public.my_university_id()) then
    raise exception 'only students of this university may join' using errcode = '42501';
  end if;
  insert into public.memberships (community_id, user_id, role, status) values (v_id, v_uid, 'member', 'active')
  on conflict (community_id, user_id) do update set status = 'active' where public.memberships.status = 'pending';
  return v_id;
end $$;

-- Other users' university is shown only once approved (self still sees the own claim). Bodies otherwise as in 004400/004200.
create or replace function public.campus_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  pr record;
  v_full boolean;
  v_uni uuid;
begin
  select p.id, p.display_name, p.username, p.bio, p.university_id, p.university_status, p.campus_discoverable into pr
  from public.profiles p where p.id = p_user;
  if not found or public.campus_blocked(v_uid, p_user) then
    return null;
  end if;
  v_full := p_user = v_uid or pr.campus_discoverable;
  v_uni := case when p_user = v_uid or pr.university_status = 'approved' then pr.university_id end;
  return jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'username', pr.username,
    'university_id', v_uni, 'university_name', (select u.name from public.universities u where u.id = v_uni),
    'is_self', p_user = v_uid, 'discoverable', pr.campus_discoverable,
    'bio', case when v_full then pr.bio end,
    'follower_count', case when v_full then (select count(*) from public.follows f where f.followee_id = p_user) end,
    'following_count', case when v_full then (select count(*) from public.follows f where f.follower_id = p_user) end,
    'post_count', case when v_full then (select count(*) from public.posts x
        where x.author_id = p_user and not x.is_anonymous and x.deleted_at is null and public.community_is_public(x.community_id)) end,
    'is_following', exists (select 1 from public.follows f where f.follower_id = v_uid and f.followee_id = p_user));
end $$;

create or replace function public.search_campus(p_q text, p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_q text := btrim(coalesce(p_q, ''));
  v_pat text;
  v_lim integer := least(greatest(coalesce(p_limit, 10), 1), 25);
begin
  if length(v_q) < 2 or length(v_q) > 100 then
    return jsonb_build_object('communities', '[]'::jsonb, 'posts', '[]'::jsonb, 'people', '[]'::jsonb);
  end if;
  v_pat := '%' || public.campus_like_escape(v_q) || '%';
  return jsonb_build_object(
    'communities', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select c.id, c.name, c.kind, c.visibility::text as visibility, c.description
        from public.communities c
        left join public.memberships mm on mm.community_id = c.id and mm.user_id = v_uid
        where c.name ilike v_pat and coalesce(mm.status::text, '') <> 'banned'
          and (c.visibility = 'public' or c.kind <> 'group' or mm.status = 'active')
        order by c.name limit v_lim) x), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select p.id, p.title, p.kind::text as kind, p.community_id, c.name as community_name, p.created_at, left(p.body, 140) as snippet
        from public.posts p join public.communities c on c.id = p.community_id
        where (p.title ilike v_pat or p.body ilike v_pat) and public.campus_post_visible(p.id)
        order by p.created_at desc, p.id limit v_lim) x), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(to_jsonb(x)) from (
        select pr.id, pr.display_name, pr.username,
               (select u.name from public.universities u where u.id = pr.university_id and pr.university_status = 'approved') as university_name
        from public.profiles pr
        where pr.campus_discoverable and pr.id <> v_uid and (pr.display_name ilike v_pat or pr.username ilike v_pat)
          and not public.campus_blocked(v_uid, pr.id)
        order by pr.display_name, pr.id limit v_lim) x), '[]'::jsonb));
end $$;

create or replace function public.get_contributor_profile(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  v_uni text;
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user_id is distinct from auth.uid() and public.has_block_between(p_user_id) then
    return null;
  end if;
  select p.display_name, u.name into v_name, v_uni
    from public.profiles p left join public.universities u on u.id = p.university_id
      and (p.id = auth.uid() or p.university_status = 'approved')
    where p.id = p_user_id;
  if not found then
    return null;
  end if;
  select jsonb_build_object(
      'resource_count', count(*),
      'total_saves', coalesce(sum(r.save_count), 0),
      'rating_count', coalesce(sum(r.rating_count), 0),
      'avg_rating', coalesce(round(sum(r.avg_rating * r.rating_count) / nullif(sum(r.rating_count), 0), 2), 0))
    into v_res
    from public.resources r
    where r.uploader_id = p_user_id and r.status = 'published' and public.can_view_resource(r.id);
  return v_res || jsonb_build_object('user_id', p_user_id, 'display_name', v_name, 'university_name', v_uni);
end $$;

-- ---------------------------------------------------------------- S2. private profiles
-- Own row or staff. Other users' public bits (name, username, avatar) come only from SECURITY DEFINER RPCs
-- (campus_profile, search_campus, leaderboard, user_posts, rosters ...), which are unaffected by this policy.
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_moderator());

-- Reviewer identity and note are staff-only (admin RPC). Column grants can't subtract from a table grant, so
-- authenticated gets column-level SELECT on every other column. NOTE: columns added to profiles later need an
-- explicit `grant select (col)` to be readable by clients.
revoke select on public.profiles from authenticated;
do $$
begin
  execute (select format('grant select (%s) on public.profiles to authenticated', string_agg(quote_ident(a.attname), ', ' order by a.attnum))
           from pg_attribute a where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
             and a.attname not in ('university_reviewed_by', 'university_review_note'));
end $$;

-- export_my_data_base is SECURITY INVOKER and exported the whole profiles row; with column-level SELECT the row is
-- read through this owner-only helper instead. The subject gets the review note (their own data) but not the staff
-- reviewer's id. Body of export_my_data_base otherwise unchanged (20260101001600, renamed in 20260101004310).
create function public.export_my_profile() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) - 'university_reviewed_by' from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.export_my_profile() from public, anon, authenticated, service_role;
grant execute on function public.export_my_profile() to authenticated, service_role;

create or replace function public.export_my_data_base() returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', public.export_my_profile(),
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

-- New accounts are not discoverable until the user opts in. Existing users keep their current flag.
alter table public.profiles alter column campus_discoverable set default false;

-- ---------------------------------------------------------------- S8. avatar_url only from our avatars bucket
-- A trigger, not a CHECK: existing rows with other https URLs must not block this migration, and a NOT VALID check
-- would still fail every later UPDATE of such a row (e.g. a locale change). Only a changed avatar_url is checked.
-- Legacy off-bucket URLs stay until the user changes the avatar (cleanup is a separate data step).
-- Accepted: https://<host>/storage/v1/object/public/avatars/<own uid>/<file>, no '..', no query. <host> = the
-- system_config key 'storage_host' (JSON string, e.g. "abcdefghijklmnopqrst.supabase.co") when set; otherwise any
-- <20 chars>.supabase.co, or http://127.0.0.1:54321 / http://localhost:54321 for local dev.
-- shortcut: a custom domain or LAN dev host needs 'storage_host' pinned in system_config.
alter table public.profiles drop constraint profiles_avatar_url_https;
create function public.guard_profile_avatar_url() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pin text;
  m text[];
begin
  if new.avatar_url is null or new.avatar_url = '' or (tg_op = 'UPDATE' and new.avatar_url is not distinct from old.avatar_url) then
    return new;
  end if;
  select lower(c.value #>> '{}') into v_pin from public.system_config c where c.key = 'storage_host' and jsonb_typeof(c.value) = 'string';
  m := regexp_match(new.avatar_url, '^(https?)://([^/?#@]+)(/[^?#]*)$');
  if m is null or position('..' in new.avatar_url) > 0
     or m[3] !~ ('^/storage/v1/object/public/avatars/' || new.id::text || '/[A-Za-z0-9._-]+$')
     or not (case when v_pin is not null then m[1] = 'https' and lower(m[2]) = v_pin
                  else (m[1] = 'https' and m[2] ~ '^[a-z0-9]{20}\.supabase\.co$')
                       or (m[1] = 'http' and m[2] in ('127.0.0.1:54321', 'localhost:54321')) end) then
    raise exception 'avatar_url violates check constraint profiles_avatar_url_storage' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_profile_avatar_url() from public, anon, authenticated, service_role;
create trigger profiles_guard_avatar_url before insert or update of avatar_url on public.profiles
  for each row execute function public.guard_profile_avatar_url();

-- ---------------------------------------------------------------- S6. private cv-photos bucket (owner folder)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv-photos', 'cv-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy cv_photos_bucket_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'cv-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy cv_photos_bucket_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cv-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy cv_photos_bucket_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'cv-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'cv-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy cv_photos_bucket_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cv-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- S10. consent proof survives account deletion
-- user_id is nulled on auth user deletion; subject_ref = sha256 hex of the user id (core sha256(), no pgcrypto).
alter table public.user_consents add column subject_ref text;
alter table public.user_consents disable trigger user_consents_no_update;
update public.user_consents set subject_ref = encode(sha256(convert_to(user_id::text, 'UTF8')), 'hex');
alter table public.user_consents enable trigger user_consents_no_update;
alter table public.user_consents alter column subject_ref set not null;
alter table public.user_consents alter column user_id drop not null;
alter table public.user_consents drop constraint user_consents_user_id_fkey;
alter table public.user_consents add constraint user_consents_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null not valid;
alter table public.user_consents validate constraint user_consents_user_id_fkey;
-- Purge no longer needs DELETE (the FK nulls user_id); nobody may delete consent proof through the API.
revoke delete on public.user_consents from service_role;

create function public.user_consents_set_subject_ref() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.subject_ref := encode(sha256(convert_to(new.user_id::text, 'UTF8')), 'hex');
  return new;
end $$;
revoke all on function public.user_consents_set_subject_ref() from public, anon, authenticated, service_role;
create trigger user_consents_set_subject_ref before insert on public.user_consents
  for each row execute function public.user_consents_set_subject_ref();

-- Still append-only. The one allowed UPDATE is the FK action nulling user_id after the auth user is gone.
-- SECURITY DEFINER only to read auth.users.
create or replace function public.user_consents_no_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is not null and new.user_id is null
     and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id')
     and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return new;
  end if;
  raise exception 'user_consents is append-only' using errcode = 'P0001';
end $$;

-- ---------------------------------------------------------------- ROLLBACK (manual, reverse order)
-- create or replace function public.user_consents_no_update() ... (body from 20260101005500: always raise; no security definer)
-- drop trigger user_consents_set_subject_ref on public.user_consents; drop function public.user_consents_set_subject_ref();
-- grant delete on public.user_consents to service_role;
-- delete from public.user_consents where user_id is null;  -- only if the cascade semantics must be restored
-- alter table public.user_consents drop constraint user_consents_user_id_fkey;
-- alter table public.user_consents add constraint user_consents_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
-- alter table public.user_consents alter column user_id set not null; alter table public.user_consents drop column subject_ref;
-- drop policy cv_photos_bucket_owner_select/_insert/_update/_delete on storage.objects; delete from storage.buckets where id = 'cv-photos';
-- drop trigger profiles_guard_avatar_url on public.profiles; drop function public.guard_profile_avatar_url();
-- alter table public.profiles add constraint profiles_avatar_url_https check (avatar_url is null or avatar_url ~ '^https://') not valid;
-- alter table public.profiles alter column campus_discoverable set default true;
-- revoke select (all columns) on public.profiles from authenticated; grant select on public.profiles to authenticated;
-- create or replace public.export_my_data_base() with the 20260101001600 body; drop function public.export_my_profile();
-- drop policy profiles_select on public.profiles; create policy profiles_select on public.profiles for select to authenticated
--   using ((select auth.uid()) is not null and (id = (select auth.uid()) or public.is_admin() or not public.has_block_between(id)));
-- drop function public.admin_review_university(uuid, uuid, boolean, text); drop function public.admin_list_university_requests(text, integer, integer);
-- create or replace get_contributor_profile / search_campus / campus_profile / join_by_code with their previous bodies
--   (20260101004200, 20260101004400, 20260101004400, 20260101004500);
-- drop trigger resources_/shared_quizzes_/shared_decks_guard_university_visibility; drop function public.guard_university_visibility();
-- create or replace public.leaderboard / public.ensure_university_community / public.my_university_id / public.guard_profile_role
--   with their previous bodies (20260101004000, 20260101004400, 20260101001000, 20260101000300).
-- drop trigger profiles_prune_university_memberships on public.profiles; drop function public.profiles_prune_university_memberships();
--   (memberships deleted by the prune are not restorable)
-- drop index public.profiles_university_status_idx;
-- alter table public.profiles drop column university_review_note, drop column university_reviewed_by,
--   drop column university_reviewed_at, drop column university_status;
-- re-grant truncate, references, trigger (tables) and sequence privileges (anon) exactly as in the 004900 snapshot;
-- alter default privileges [for role postgres] grant execute on functions to public;
-- alter default privileges [for role postgres] in schema public grant all on tables/sequences/functions to anon, authenticated;
