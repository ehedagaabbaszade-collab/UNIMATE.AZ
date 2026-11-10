-- UNIMATE CAMPUS (communities, feed, Q&A, follows, blocks, reports, events, study groups, notifications, search).
-- Postgres 15 syntax only. NO seed rows: communities exist only when a student/university directory entry creates them
-- (ensure_university_community, create_community); events/posts only through the RPCs below.
--  * User-generated text is NEVER translated. `language` (az|tr|en|ru) on posts/comments/events is an optional author tag, display only.
--  * Existing RLS stays as the safety net (direct writes keep working for the owner); new BEFORE triggers apply the same
--    validation, rate limits and duplicate guard to every API path (auth.uid() is not null), including the RPCs.
--  * Default privileges in this project grant EXECUTE on new functions to API roles: the end of this file revokes and
--    re-grants explicitly (internal helpers are not callable by clients).
--  * Notification copy (az/tr/en/ru) is hand-written by a non-native author: NATIVE-SPEAKER REVIEW REQUIRED before launch.

-- ---------------------------------------------------------------- schema additions
alter table public.communities add column kind text not null default 'group'
  check (kind in ('university', 'faculty', 'course', 'group'));
alter table public.communities add column rules text check (rules is null or length(rules) <= 2000);
create unique index communities_one_university_key on public.communities(university_id) where kind = 'university';
create index communities_kind_idx on public.communities(kind, name);

alter table public.posts add column language text check (language is null or language in ('az', 'tr', 'en', 'ru'));
alter table public.posts add column edited_at timestamptz;
alter table public.posts add column accepted_comment_id uuid;

alter table public.comments add column language text check (language is null or language in ('az', 'tr', 'en', 'ru'));
alter table public.comments add column edited_at timestamptz;
alter table public.comments add column depth smallint not null default 0 check (depth between 0 and 3);
alter table public.posts add constraint posts_accepted_comment_fkey
  foreign key (accepted_comment_id) references public.comments(id) on delete set null;
create index posts_feed_idx on public.posts(created_at desc, id desc) where deleted_at is null;

alter table public.events add column language text check (language is null or language in ('az', 'tr', 'en', 'ru'));
alter table public.events add column capacity integer check (capacity is null or capacity between 1 and 10000);

alter table public.profiles add column campus_discoverable boolean not null default true;

-- reports: category, community target, one open report per reporter + target
alter table public.reports add column category text not null default 'other'
  check (category in ('spam', 'harassment', 'hate', 'misinformation', 'inappropriate', 'other'));
alter table public.reports add column community_id uuid references public.communities(id) on delete cascade;
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.reports'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%num_nonnulls%' loop
    execute format('alter table public.reports drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.reports add constraint reports_one_target
  check (num_nonnulls(post_id, comment_id, resource_id, reported_user_id, community_id) = 1);
create unique index reports_open_community_unique on public.reports(reporter_id, community_id)
  where status = 'open' and community_id is not null;

-- ---------------------------------------------------------------- internal tables (no client access)
create table public.campus_actions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  content_hash text,
  created_at timestamptz not null default public.now_utc()
);
create index campus_actions_user_idx on public.campus_actions(user_id, kind, created_at desc);

create table public.campus_notified (
  key text primary key,
  created_at timestamptz not null default now()
);

create table public.community_invites (
  community_id uuid primary key references public.communities(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Z0-9]{10}$'),
  created_at timestamptz not null default now()
);

create table public.event_rsvps (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('going', 'interested')),
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_rsvps_user_idx on public.event_rsvps(user_id);

create table public.event_planner_links (
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

alter table public.campus_actions enable row level security;
alter table public.campus_notified enable row level security;
alter table public.community_invites enable row level security;
alter table public.event_rsvps enable row level security;
alter table public.event_planner_links enable row level security;
revoke all on public.campus_actions, public.campus_notified, public.community_invites,
  public.event_rsvps, public.event_planner_links from anon, authenticated;
grant select on public.event_rsvps, public.event_planner_links to authenticated;
-- Explicit deny-all policies: these tables are only reachable through SECURITY DEFINER code (service_role bypasses RLS).
create policy campus_actions_none on public.campus_actions for select to authenticated using (false);
create policy campus_notified_none on public.campus_notified for select to authenticated using (false);
create policy community_invites_none on public.community_invites for select to authenticated using (false);
create policy event_rsvps_own on public.event_rsvps for select to authenticated using (user_id = (select auth.uid()));
create policy event_planner_links_own on public.event_planner_links for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- validators and rate limiting
-- Plain text only: no HTML tags, no non-https URL schemes, no control characters.
create function public.campus_text_ok(p text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select p is null or (
    p !~ '[\x00-\x08\x0B\x0C\x0E-\x1F]'
    and p !~* '<\s*/?\s*(script|iframe|img|a|b|i|u|div|span|p|br|svg|style|link|meta|object|embed|form|input|button|html|body|h[1-6]|ul|ol|li|table|video|audio|source|base)\M'
    and p !~ '<!--'
    and p !~* '(^|[^a-z0-9])(http|ftp|ftps|sftp|file|ws|wss)://'
    and p !~* '(^|[^a-z0-9])(javascript|vbscript):'
    and p !~* '(^|[^a-z0-9])data:[a-z]+/')
$$;

create function public.campus_assert_text(p text, p_label text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if not public.campus_text_ok(p) then
    raise exception 'invalid % (HTML, non-https links and control characters are not allowed)', p_label using errcode = '22023';
  end if;
end $$;

create function public.campus_uid() returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return v;
end $$;

create function public.campus_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks x where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a))
$$;

create function public.campus_like_escape(p text) returns text
language sql immutable set search_path = pg_catalog as $$
  select replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- Per-user sliding window + duplicate-content guard. Serialised per user with an advisory lock.
create function public.campus_rate_check(p_kind text, p_window interval, p_max integer, p_hash text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := public.now_utc();
begin
  if v_uid is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('campus:' || v_uid::text, 0));
  delete from public.campus_actions where user_id = v_uid and created_at < v_now - interval '2 days';
  if p_hash is not null and exists (select 1 from public.campus_actions
      where user_id = v_uid and kind = p_kind and content_hash = p_hash and created_at > v_now - interval '10 minutes') then
    raise exception 'duplicate content' using errcode = '23505';
  end if;
  if (select count(*) from public.campus_actions where user_id = v_uid and kind = p_kind and created_at > v_now - p_window) >= p_max then
    raise exception 'rate limit exceeded for %', p_kind using errcode = '54000';
  end if;
  insert into public.campus_actions (user_id, kind, content_hash, created_at) values (v_uid, p_kind, p_hash, v_now);
end $$;

-- ---------------------------------------------------------------- notification producer
create function public.campus_notify(p_user uuid, p_key text, p_params jsonb, p_dedupe text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_user is null then
    return;
  end if;
  if p_dedupe is not null then
    -- hashed: the key embeds user ids and must not outlive account deletion
    insert into public.campus_notified (key) values (md5(p_dedupe)) on conflict do nothing;
    if not found then
      return;
    end if;
  end if;
  perform public.notify_user(p_user, p_key, p_params, 'campus');
end $$;

create function public.campus_display_name(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(display_name), ''), username, 'UniMate') from public.profiles where id = p_user
$$;

-- Real author of a post (resolves anonymous posts); only used server-side to address notifications.
create function public.campus_post_owner(p_post uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p.author_id, (select a.author_id from public.post_private_authors a where a.post_id = p.id))
  from public.posts p where p.id = p_post
$$;

-- ---------------------------------------------------------------- triggers
create function public.campus_posts_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.campus_assert_text(new.title, 'title');
    perform public.campus_assert_text(new.body, 'body');
    perform public.campus_rate_check('post', interval '1 hour', 10, md5(lower(btrim(new.title || ' ' || new.body))));
  elsif new.title is distinct from old.title or new.body is distinct from old.body then
    perform public.campus_assert_text(new.title, 'title');
    perform public.campus_assert_text(new.body, 'body');
    new.edited_at := public.now_utc();
  end if;
  return new;
end $$;
create trigger posts_campus_guard before insert or update on public.posts
  for each row execute function public.campus_posts_guard();

create function public.campus_comments_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_depth smallint;
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      select depth + 1 into v_depth from public.comments where id = new.parent_id;
      if v_depth is null then
        raise exception 'parent comment not found' using errcode = 'P0002';
      end if;
      if v_depth > 3 then
        raise exception 'reply depth limit reached' using errcode = '54000';
      end if;
      new.depth := v_depth;
    else
      new.depth := 0;
    end if;
    if auth.uid() is not null then
      perform public.campus_assert_text(new.body, 'comment');
      perform public.campus_rate_check('comment_day', interval '1 day', 300);
      perform public.campus_rate_check('comment', interval '1 minute', 5, md5(lower(btrim(new.post_id::text || new.body))));
    end if;
  elsif auth.uid() is not null and new.body is distinct from old.body then
    perform public.campus_assert_text(new.body, 'comment');
    new.edited_at := public.now_utc();
  end if;
  return new;
end $$;
create trigger comments_campus_guard before insert or update on public.comments
  for each row execute function public.campus_comments_guard();

create function public.campus_comments_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_post record;
  v_owner uuid;
  v_parent_author uuid;
  v_name text;
  v_params jsonb;
begin
  select p.title, p.community_id into v_post from public.posts p where p.id = new.post_id;
  v_owner := public.campus_post_owner(new.post_id);
  v_name := public.campus_display_name(new.author_id);
  v_params := jsonb_build_object('name', v_name, 'title', left(v_post.title, 80), 'post_id', new.post_id,
                                 'comment_id', new.id, 'community_id', v_post.community_id, 'user_id', new.author_id);
  if v_owner is not null and v_owner <> new.author_id and not public.campus_blocked(v_owner, new.author_id) then
    perform public.campus_notify(v_owner, 'campus_post_reply', v_params);
  end if;
  if new.parent_id is not null then
    select c.author_id into v_parent_author from public.comments c where c.id = new.parent_id;
    if v_parent_author is not null and v_parent_author <> new.author_id and v_parent_author is distinct from v_owner
       and not public.campus_blocked(v_parent_author, new.author_id) then
      perform public.campus_notify(v_parent_author, 'campus_comment_reply', v_params);
    end if;
  end if;
  return new;
end $$;
create trigger comments_campus_notify after insert on public.comments
  for each row execute function public.campus_comments_notify();

-- Milestones 1, 5, 25 likes; each (target, milestone) notifies at most once, even across unlike/re-like.
create function public.campus_reactions_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
  v_author uuid;
  v_post uuid;
  v_target text;
begin
  if new.kind <> 'like' then
    return new;
  end if;
  if new.post_id is not null then
    select count(*) into v_count from public.reactions r where r.post_id = new.post_id and r.kind = 'like';
    v_author := public.campus_post_owner(new.post_id);
    v_post := new.post_id;
    v_target := 'post:' || new.post_id::text;
  else
    select count(*) into v_count from public.reactions r where r.comment_id = new.comment_id and r.kind = 'like';
    select c.author_id, c.post_id into v_author, v_post from public.comments c where c.id = new.comment_id;
    v_target := 'comment:' || new.comment_id::text;
  end if;
  if v_count in (1, 5, 25) and v_author is not null and v_author <> new.user_id then
    perform public.campus_notify(v_author, 'campus_reaction_milestone',
      jsonb_build_object('count', v_count, 'post_id', v_post), 'milestone:' || v_target || ':' || v_count);
  end if;
  return new;
end $$;
create trigger reactions_campus_notify after insert on public.reactions
  for each row execute function public.campus_reactions_notify();

create function public.campus_follows_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_notify(new.followee_id, 'campus_new_follower',
    jsonb_build_object('name', public.campus_display_name(new.follower_id), 'user_id', new.follower_id),
    'follow:' || new.follower_id::text || ':' || new.followee_id::text);
  return new;
end $$;
create trigger follows_campus_notify after insert on public.follows
  for each row execute function public.campus_follows_notify();

create function public.campus_memberships_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  c record;
begin
  select cm.name, cm.kind, cm.university_id into c from public.communities cm where cm.id = new.community_id;
  if current_user in ('anon', 'authenticated') and c.kind = 'university'
     and c.university_id is distinct from public.my_university_id() then
    raise exception 'only students of this university may join' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger memberships_campus_guard before insert on public.memberships
  for each row execute function public.campus_memberships_guard();

create function public.campus_memberships_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  r record;
begin
  if new.status = 'pending' then
    select name into v_name from public.communities where id = new.community_id;
    for r in select m.user_id from public.memberships m
             where m.community_id = new.community_id and m.status = 'active' and m.role in ('moderator', 'owner') limit 10 loop
      perform public.campus_notify(r.user_id, 'campus_join_request',
        jsonb_build_object('name', public.campus_display_name(new.user_id), 'community', v_name,
                           'community_id', new.community_id, 'user_id', new.user_id),
        'join:' || new.community_id::text || ':' || new.user_id::text || ':' || to_char(now(), 'YYYYMMDD'));
    end loop;
  end if;
  return new;
end $$;
create trigger memberships_campus_notify after insert on public.memberships
  for each row execute function public.campus_memberships_notify();

-- SECURITY INVOKER on purpose: current_user is the API role on direct writes and the owner inside the definer RPCs.
create function public.campus_communities_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    perform public.campus_assert_text(new.name, 'name');
    perform public.campus_assert_text(new.description, 'description');
    perform public.campus_assert_text(new.rules, 'rules');
  end if;
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.kind <> 'group' then
      raise exception 'community kind is set by the server' using errcode = '42501';
    elsif tg_op = 'UPDATE' and (new.kind is distinct from old.kind or new.university_id is distinct from old.university_id) then
      raise exception 'community kind and university are immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger communities_campus_guard before insert or update on public.communities
  for each row execute function public.campus_communities_guard();

create function public.campus_events_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    perform public.campus_assert_text(new.title, 'title');
    perform public.campus_assert_text(new.description, 'description');
    perform public.campus_assert_text(new.location, 'location');
  end if;
  return new;
end $$;
create trigger events_campus_guard before insert or update on public.events
  for each row execute function public.campus_events_guard();

create function public.campus_reports_resolved() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.status in ('open', 'reviewing') and new.status in ('actioned', 'dismissed') then
    perform public.campus_notify(new.reporter_id, 'report_resolved', jsonb_build_object('report_id', new.id),
      'report:' || new.id::text);
  end if;
  return new;
end $$;
create trigger reports_campus_resolved after update of status on public.reports
  for each row execute function public.campus_reports_resolved();

-- Notifications sent to OTHER users that carry this person's name/id (follower, join request, replies) die with the account.
create function public.campus_profile_cleanup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.notifications where params ->> 'user_id' = old.id::text;
  return old;
end $$;
create trigger profiles_campus_cleanup before delete on public.profiles
  for each row execute function public.campus_profile_cleanup();

-- ---------------------------------------------------------------- visibility helpers
create function public.campus_post_visible(p_post uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.posts p
    where p.id = p_post and p.deleted_at is null
      and (public.community_is_public(p.community_id) or public.is_member(p.community_id))
      and not public.campus_blocked(auth.uid(), p.author_id))
$$;

create function public.campus_community_visible(p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.communities c
    where c.id = p_community
      and (c.visibility = 'public' or public.is_member(c.id) or c.created_by = auth.uid()))
$$;

-- ---------------------------------------------------------------- row types
create type public.campus_post_row as (
  id uuid, community_id uuid, community_name text, kind text, title text, body text, language text,
  is_anonymous boolean, author_id uuid, author_name text, author_username text, is_mine boolean,
  created_at timestamptz, edited_at timestamptz, comment_count integer, like_count integer, helpful_count integer,
  my_liked boolean, accepted_comment_id uuid, can_moderate boolean);

create type public.campus_comment_row as (
  id uuid, post_id uuid, parent_id uuid, depth integer, author_id uuid, author_name text, author_username text,
  is_mine boolean, body text, language text, created_at timestamptz, edited_at timestamptz, is_deleted boolean,
  like_count integer, helpful_count integer, my_liked boolean, my_helpful boolean, is_accepted boolean);

create type public.campus_event_row as (
  id uuid, community_id uuid, community_name text, title text, description text, location text,
  starts_at timestamptz, ends_at timestamptz, capacity integer, language text, status text,
  going_count integer, interested_count integer, my_rsvp text, created_by uuid, is_mine boolean,
  can_moderate boolean, in_planner boolean);

-- Author identity is NULL for anonymous posts; is_mine is the only (caller-relative) ownership signal.
create function public.campus_post_card(p_post uuid) returns setof public.campus_post_row
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.community_id, c.name, p.kind::text, p.title, p.body, p.language, p.is_anonymous,
    p.author_id, pr.display_name, pr.username,
    (coalesce(p.author_id = auth.uid(), false) or public.owns_anon_post(p.id)),
    p.created_at, p.edited_at,
    (select count(*)::integer from public.comments x where x.post_id = p.id and x.deleted_at is null),
    (select count(*)::integer from public.reactions r where r.post_id = p.id and r.kind = 'like'),
    (select count(*)::integer from public.reactions r where r.post_id = p.id and r.kind = 'helpful'),
    exists (select 1 from public.reactions r where r.post_id = p.id and r.kind = 'like' and r.user_id = auth.uid()),
    p.accepted_comment_id,
    (public.is_community_mod(p.community_id) or public.is_moderator())
  from public.posts p
  join public.communities c on c.id = p.community_id
  left join public.profiles pr on pr.id = p.author_id
  where p.id = p_post
$$;

create function public.campus_event_card(p_event uuid) returns setof public.campus_event_row
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.community_id, c.name, e.title, e.description, e.location, e.starts_at, e.ends_at, e.capacity, e.language,
    e.status::text,
    (select count(*)::integer from public.event_rsvps r where r.event_id = e.id and r.status = 'going'),
    (select count(*)::integer from public.event_rsvps r where r.event_id = e.id and r.status = 'interested'),
    (select r.status from public.event_rsvps r where r.event_id = e.id and r.user_id = auth.uid()),
    e.created_by, (e.created_by = auth.uid()),
    (public.is_moderator() or (e.community_id is not null and public.is_community_mod(e.community_id))),
    exists (select 1 from public.event_planner_links l where l.event_id = e.id and l.user_id = auth.uid())
  from public.events e
  left join public.communities c on c.id = e.community_id
  where e.id = p_event
$$;

-- ---------------------------------------------------------------- feeds (cursor: created_at + id, newest first)
create function public.campus_feed(p_scope text, p_community uuid, p_author uuid, p_limit integer,
  p_before_ts timestamptz, p_before_id uuid, p_language text, p_kind text) returns setof public.campus_post_row
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if p_language is not null and p_language not in ('az', 'tr', 'en', 'ru') then
    raise exception 'invalid language' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('post', 'question') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  return query
  select c.* from (
    select p.id, p.created_at from public.posts p
    where p.deleted_at is null
      and (p_language is null or p.language = p_language)
      and (p_kind is null or p.kind::text = p_kind)
      and (p_before_ts is null or p.created_at < p_before_ts
           or (p_before_id is not null and p.created_at = p_before_ts and p.id < p_before_id))
      and not exists (select 1 from public.blocks b
                      where (b.blocker_id = v_uid and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = v_uid))
      and case p_scope
        when 'home' then
          p.community_id in (select m.community_id from public.memberships m where m.user_id = v_uid and m.status = 'active')
          or (p.author_id in (select f.followee_id from public.follows f where f.follower_id = v_uid)
              and public.community_is_public(p.community_id))
        when 'community' then
          p.community_id = p_community and (public.community_is_public(p.community_id) or public.is_member(p.community_id))
        else
          p.author_id = p_author and not p.is_anonymous and public.community_is_public(p.community_id)
      end
    order by p.created_at desc, p.id desc
    limit v_lim
  ) b
  cross join lateral public.campus_post_card(b.id) c
  order by b.created_at desc, b.id desc;
end $$;

create function public.home_feed(p_limit integer default 20, p_before_ts timestamptz default null, p_before_id uuid default null,
  p_language text default null, p_kind text default null) returns setof public.campus_post_row
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.campus_feed('home', null, null, p_limit, p_before_ts, p_before_id, p_language, p_kind)
$$;

create function public.community_feed(p_community uuid, p_limit integer default 20, p_before_ts timestamptz default null,
  p_before_id uuid default null, p_language text default null, p_kind text default null) returns setof public.campus_post_row
language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.campus_feed('community', p_community, null, p_limit, p_before_ts, p_before_id, p_language, p_kind)
$$;

-- Posts on a profile page: public communities only, never anonymous, hidden when the profile is not discoverable.
create function public.user_posts(p_user uuid, p_limit integer default 20, p_before_ts timestamptz default null,
  p_before_id uuid default null) returns setof public.campus_post_row
language sql stable security definer set search_path = public, pg_temp as $$
  select f.* from public.campus_feed('user', null, p_user, p_limit, p_before_ts, p_before_id, null, null) f
  where p_user = auth.uid() or exists (select 1 from public.profiles pr where pr.id = p_user and pr.campus_discoverable)
$$;

create function public.get_post(p_post uuid) returns setof public.campus_post_row
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not public.campus_post_visible(p_post) then
    return;
  end if;
  return query select * from public.campus_post_card(p_post);
end $$;

-- Flat, ordered by time; clients thread by parent_id/depth (cap 3). Deleted comments survive only as tombstones
-- when a visible reply hangs below them.
create function public.post_comments(p_post uuid, p_limit integer default 100, p_after_ts timestamptz default null,
  p_after_id uuid default null) returns setof public.campus_comment_row
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
begin
  if not public.campus_post_visible(p_post) then
    return;
  end if;
  return query
  select c.id, c.post_id, c.parent_id, c.depth::integer, c.author_id, pr.display_name, pr.username,
    (c.author_id = v_uid),
    case when c.deleted_at is null then c.body end, c.language, c.created_at, c.edited_at, (c.deleted_at is not null),
    (select count(*)::integer from public.reactions r where r.comment_id = c.id and r.kind = 'like'),
    (select count(*)::integer from public.reactions r where r.comment_id = c.id and r.kind = 'helpful'),
    exists (select 1 from public.reactions r where r.comment_id = c.id and r.kind = 'like' and r.user_id = v_uid),
    exists (select 1 from public.reactions r where r.comment_id = c.id and r.kind = 'helpful' and r.user_id = v_uid),
    (c.id = (select p.accepted_comment_id from public.posts p where p.id = c.post_id))
  from public.comments c
  left join public.profiles pr on pr.id = c.author_id
  where c.post_id = p_post
    and not public.campus_blocked(v_uid, c.author_id)
    and (c.deleted_at is null or exists (select 1 from public.comments ch where ch.parent_id = c.id and ch.deleted_at is null))
    and (p_after_ts is null or c.created_at > p_after_ts or (p_after_id is not null and c.created_at = p_after_ts and c.id > p_after_id))
  order by c.created_at, c.id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ---------------------------------------------------------------- posts and comments (write)
create function public.create_post(p_community uuid, p_title text, p_body text default '', p_kind text default 'post',
  p_anonymous boolean default false, p_language text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_id uuid;
begin
  if p_kind is null or p_kind not in ('post', 'question') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 300 or length(coalesce(p_body, '')) > 20000 then
    raise exception 'title (1-300) and body (<= 20000) are required' using errcode = '22023';
  end if;
  if p_language is not null and p_language not in ('az', 'tr', 'en', 'ru') then
    raise exception 'invalid language' using errcode = '22023';
  end if;
  if not public.is_member(p_community) then
    raise exception 'must be an active member of the community' using errcode = '42501';
  end if;
  if coalesce(p_anonymous, false) then
    if p_kind <> 'question' then
      raise exception 'only questions can be anonymous' using errcode = '22023';
    end if;
    v_id := public.create_anonymous_post(p_community, btrim(p_title), coalesce(p_body, ''));
    update public.posts set language = p_language where id = v_id;
  else
    insert into public.posts (community_id, author_id, kind, title, body, language)
    values (p_community, v_uid, p_kind::public.post_kind, btrim(p_title), coalesce(p_body, ''), p_language)
    returning id into v_id;
  end if;
  return v_id;
end $$;

create function public.edit_post(p_post uuid, p_title text, p_body text, p_language text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if p_title is null or length(btrim(p_title)) not between 1 and 300 or length(coalesce(p_body, '')) > 20000 then
    raise exception 'title (1-300) and body (<= 20000) are required' using errcode = '22023';
  end if;
  if p_language is not null and p_language not in ('az', 'tr', 'en', 'ru') then
    raise exception 'invalid language' using errcode = '22023';
  end if;
  update public.posts set title = btrim(p_title), body = coalesce(p_body, ''), language = coalesce(p_language, language)
  where id = p_post and deleted_at is null and (author_id = auth.uid() or public.owns_anon_post(id));
  if not found then
    raise exception 'post not found or not yours' using errcode = '42501';
  end if;
  return true;
end $$;

create function public.delete_post(p_post uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  update public.posts set deleted_at = public.now_utc()
  where id = p_post and deleted_at is null and (author_id = auth.uid() or public.owns_anon_post(id));
  if not found then
    raise exception 'post not found or not yours' using errcode = '42501';
  end if;
  return true;
end $$;

create function public.create_comment(p_post uuid, p_body text, p_parent uuid default null, p_language text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_id uuid;
begin
  if p_body is null or length(btrim(p_body)) not between 1 and 10000 then
    raise exception 'comment (1-10000 chars) is required' using errcode = '22023';
  end if;
  if p_language is not null and p_language not in ('az', 'tr', 'en', 'ru') then
    raise exception 'invalid language' using errcode = '22023';
  end if;
  if not public.campus_post_visible(p_post) or not public.is_member((select community_id from public.posts where id = p_post)) then
    raise exception 'you cannot comment on this post' using errcode = '42501';
  end if;
  if p_parent is not null and not exists (
      select 1 from public.comments c where c.id = p_parent and c.post_id = p_post and c.deleted_at is null
        and not public.campus_blocked(v_uid, c.author_id)) then
    raise exception 'parent comment not found' using errcode = 'P0002';
  end if;
  insert into public.comments (post_id, parent_id, author_id, body, language)
  values (p_post, p_parent, v_uid, btrim(p_body), p_language) returning id into v_id;
  return v_id;
end $$;

create function public.edit_comment(p_comment uuid, p_body text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if p_body is null or length(btrim(p_body)) not between 1 and 10000 then
    raise exception 'comment (1-10000 chars) is required' using errcode = '22023';
  end if;
  update public.comments set body = btrim(p_body) where id = p_comment and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'comment not found or not yours' using errcode = '42501';
  end if;
  return true;
end $$;

create function public.delete_comment(p_comment uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  update public.comments set deleted_at = public.now_utc() where id = p_comment and author_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'comment not found or not yours' using errcode = '42501';
  end if;
  update public.posts set accepted_comment_id = null where accepted_comment_id = p_comment;
  return true;
end $$;

-- Reactions: like (posts + comments) and helpful (answers = comments of question posts). One per user and kind; never on
-- your own content. p_on=false removes it.
create function public.react(p_target text, p_id uuid, p_kind text, p_on boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_post uuid;
  v_author uuid;
  v_pkind text;
begin
  if p_target not in ('post', 'comment') or p_kind not in ('like', 'helpful') then
    raise exception 'invalid reaction' using errcode = '22023';
  end if;
  perform public.campus_rate_check('react', interval '1 minute', 60);
  if p_target = 'post' then
    if p_kind = 'helpful' then
      raise exception 'helpful applies to answers only' using errcode = '22023';
    end if;
    v_post := p_id;
    v_author := public.campus_post_owner(p_id);
  else
    select c.post_id, c.author_id into v_post, v_author from public.comments c where c.id = p_id and c.deleted_at is null;
    if v_post is null then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if p_kind = 'helpful' then
      select p.kind::text into v_pkind from public.posts p where p.id = v_post;
      if v_pkind <> 'question' then
        raise exception 'helpful applies to answers only' using errcode = '22023';
      end if;
    end if;
    if public.campus_blocked(v_uid, v_author) then
      raise exception 'not found' using errcode = 'P0002';
    end if;
  end if;
  if not public.campus_post_visible(v_post) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_author = v_uid then
    raise exception 'you cannot react to your own content' using errcode = '42501';
  end if;
  if p_on then
    if p_target = 'post' then
      insert into public.reactions (user_id, post_id, kind) values (v_uid, p_id, p_kind) on conflict do nothing;
    else
      insert into public.reactions (user_id, comment_id, kind) values (v_uid, p_id, p_kind) on conflict do nothing;
    end if;
  elsif p_target = 'post' then
    delete from public.reactions where user_id = v_uid and post_id = p_id and kind = p_kind;
  else
    delete from public.reactions where user_id = v_uid and comment_id = p_id and kind = p_kind;
  end if;
  return jsonb_build_object(
    'like_count', (select count(*) from public.reactions r where r.kind = 'like'
                   and ((p_target = 'post' and r.post_id = p_id) or (p_target = 'comment' and r.comment_id = p_id))),
    'helpful_count', (select count(*) from public.reactions r where r.kind = 'helpful'
                      and ((p_target = 'post' and r.post_id = p_id) or (p_target = 'comment' and r.comment_id = p_id))),
    'my_like', exists (select 1 from public.reactions r where r.user_id = v_uid and r.kind = 'like'
                       and ((p_target = 'post' and r.post_id = p_id) or (p_target = 'comment' and r.comment_id = p_id))),
    'my_helpful', exists (select 1 from public.reactions r where r.user_id = v_uid and r.kind = 'helpful'
                          and ((p_target = 'post' and r.post_id = p_id) or (p_target = 'comment' and r.comment_id = p_id))));
end $$;

-- Asker (author or anonymous owner) or a community/site moderator marks one accepted answer; NULL clears it.
create function public.set_accepted_answer(p_post uuid, p_comment uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
begin
  perform public.campus_uid();
  select x.id, x.kind::text as kind, x.community_id, x.author_id into p from public.posts x where x.id = p_post and x.deleted_at is null;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if p.kind <> 'question' then
    raise exception 'only questions have accepted answers' using errcode = '22023';
  end if;
  if not (p.author_id = auth.uid() or public.owns_anon_post(p.id) or public.is_community_mod(p.community_id) or public.is_moderator()) then
    raise exception 'only the asker or a moderator may accept an answer' using errcode = '42501';
  end if;
  if p_comment is not null and not exists (
      select 1 from public.comments c where c.id = p_comment and c.post_id = p_post and c.deleted_at is null) then
    raise exception 'answer not found on this post' using errcode = 'P0002';
  end if;
  update public.posts set accepted_comment_id = p_comment where id = p_post;
  return true;
end $$;

-- ---------------------------------------------------------------- communities
create function public.ensure_university_community(p_university uuid, p_join boolean default false) returns uuid
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
    if p_university is distinct from (select university_id from public.profiles where id = v_uid) then
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

create function public.create_community(p_name text, p_kind text, p_visibility text default 'public',
  p_description text default null, p_rules text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_vis public.community_visibility;
  v_id uuid;
  v_base text;
begin
  if p_kind is null or p_kind not in ('faculty', 'course', 'group') then
    raise exception 'kind must be faculty, course or group' using errcode = '22023';
  end if;
  if p_visibility is null or p_visibility not in ('public', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if p_name is null or length(btrim(p_name)) not between 2 and 100 or length(coalesce(p_description, '')) > 1000
     or length(coalesce(p_rules, '')) > 2000 then
    raise exception 'name (2-100), description (<= 1000) and rules (<= 2000) are required' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_name, 'name');
  perform public.campus_assert_text(p_description, 'description');
  perform public.campus_assert_text(p_rules, 'rules');
  perform public.campus_rate_check('community', interval '1 day', 5);
  v_vis := (case when p_kind = 'group' then 'private' else p_visibility end)::public.community_visibility;
  v_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  insert into public.communities (university_id, name, slug, description, rules, visibility, kind, created_by)
  values (public.my_university_id(), btrim(p_name),
          left(coalesce(nullif(v_base, ''), 'c'), 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
          nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_rules, '')), ''), v_vis, p_kind, v_uid)
  returning id into v_id;
  if p_kind = 'group' then
    insert into public.community_invites (community_id, code)
    values (v_id, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)));
  end if;
  return v_id;
end $$;

create function public.update_community(p_community uuid, p_description text, p_rules text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not public.is_community_mod(p_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if length(coalesce(p_description, '')) > 1000 or length(coalesce(p_rules, '')) > 2000 then
    raise exception 'description (<= 1000) and rules (<= 2000)' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_description, 'description');
  perform public.campus_assert_text(p_rules, 'rules');
  update public.communities set description = nullif(btrim(coalesce(p_description, '')), ''),
    rules = nullif(btrim(coalesce(p_rules, '')), '') where id = p_community;
  return true;
end $$;

create function public.discover_communities(p_q text default null, p_kind text default null, p_joined boolean default null,
  p_limit integer default 30, p_offset integer default 0)
returns table (id uuid, name text, slug text, description text, kind text, visibility text, member_count integer,
               my_status text, my_role text, university_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_pat text := case when p_q is null or btrim(p_q) = '' then null else '%' || public.campus_like_escape(btrim(p_q)) || '%' end;
begin
  if p_kind is not null and p_kind not in ('university', 'faculty', 'course', 'group') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  return query
  select c.id, c.name, c.slug, c.description, c.kind, c.visibility::text,
    (select count(*)::integer from public.memberships m where m.community_id = c.id and m.status = 'active'),
    mm.status::text, mm.role::text, c.university_id
  from public.communities c
  left join public.memberships mm on mm.community_id = c.id and mm.user_id = v_uid
  where (c.visibility = 'public' or (c.kind <> 'group') or mm.user_id is not null)
    and coalesce(mm.status::text, '') <> 'banned'
    and (p_kind is null or c.kind = p_kind)
    and (p_joined is null or p_joined = coalesce(mm.status = 'active', false))
    and (v_pat is null or c.name ilike v_pat)
  order by c.name, c.id
  limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.get_community(p_community uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  c record;
  v_mstatus text;
  v_mrole text;
  v_member boolean;
begin
  select * into c from public.communities x where x.id = p_community;
  select m.status::text, m.role::text into v_mstatus, v_mrole from public.memberships m
    where m.community_id = p_community and m.user_id = v_uid;
  if c.id is null or coalesce(v_mstatus, '') = 'banned'
     or (c.visibility = 'private' and c.kind = 'group' and coalesce(v_mstatus, '') not in ('active', 'pending')) then
    return null;
  end if;
  v_member := coalesce(v_mstatus = 'active', false);
  return jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug, 'kind', c.kind, 'visibility', c.visibility,
    'description', c.description, 'university_id', c.university_id,
    'rules', case when v_member or c.visibility = 'public' then c.rules end,
    'member_count', (select count(*) from public.memberships m where m.community_id = c.id and m.status = 'active'),
    'my_status', v_mstatus, 'my_role', v_mrole,
    'can_moderate', (public.is_community_mod(c.id) or public.is_moderator()),
    'pending_requests', case when public.is_community_mod(c.id)
       then (select count(*) from public.memberships m where m.community_id = c.id and m.status = 'pending') end);
end $$;

-- Members are visible to members only; blocks hide both ways.
create function public.community_members(p_community uuid, p_limit integer default 50, p_offset integer default 0,
  p_status text default 'active')
returns table (user_id uuid, display_name text, username text, role text, status text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_mod boolean := public.is_community_mod(p_community);
begin
  if p_status not in ('active', 'pending', 'banned') or (p_status <> 'active' and not v_mod) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if not (public.is_member(p_community) or public.is_moderator()) then
    return;
  end if;
  return query
  select m.user_id, pr.display_name, pr.username, m.role::text, m.status::text, m.created_at
  from public.memberships m join public.profiles pr on pr.id = m.user_id
  where m.community_id = p_community and m.status::text = p_status and not public.campus_blocked(v_uid, m.user_id)
  order by (m.role = 'owner') desc, (m.role = 'moderator') desc, m.created_at, m.user_id
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.join_community(p_community uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  c record;
  v_status text;
begin
  select * into c from public.communities x where x.id = p_community;
  if not found or (c.kind = 'group' and c.visibility = 'private') then
    raise exception 'community not found (study groups are joined with an invite code)' using errcode = 'P0002';
  end if;
  select m.status::text into v_status from public.memberships m where m.community_id = p_community and m.user_id = v_uid;
  if v_status = 'banned' then
    raise exception 'you are banned from this community' using errcode = '42501';
  elsif v_status is not null then
    return v_status;
  end if;
  if c.kind = 'university' and c.university_id is distinct from public.my_university_id() then
    raise exception 'only students of this university may join' using errcode = '42501';
  end if;
  v_status := case when c.visibility = 'public' then 'active' else 'pending' end;
  insert into public.memberships (community_id, user_id, role, status)
  values (p_community, v_uid, 'member', v_status::public.membership_status);
  return v_status;
end $$;

create function public.leave_community(p_community uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if exists (select 1 from public.memberships m where m.community_id = p_community and m.user_id = auth.uid() and m.role = 'owner') then
    raise exception 'owners must transfer ownership before leaving' using errcode = '42501';
  end if;
  delete from public.memberships where community_id = p_community and user_id = auth.uid() and status <> 'banned';
  return found;
end $$;

create function public.join_by_code(p_code text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_id uuid;
begin
  perform public.campus_rate_check('invite_code', interval '1 hour', 20);
  select i.community_id into v_id from public.community_invites i where i.code = upper(btrim(coalesce(p_code, '')));
  if v_id is null then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.memberships m where m.community_id = v_id and m.user_id = v_uid and m.status = 'banned') then
    raise exception 'you are banned from this community' using errcode = '42501';
  end if;
  insert into public.memberships (community_id, user_id, role, status) values (v_id, v_uid, 'member', 'active')
  on conflict (community_id, user_id) do update set status = 'active' where public.memberships.status = 'pending';
  return v_id;
end $$;

create function public.get_invite_code(p_community uuid, p_rotate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_code text;
begin
  perform public.campus_uid();
  if not public.is_community_mod(p_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.communities c where c.id = p_community and c.kind = 'group') then
    raise exception 'only study groups have invite codes' using errcode = '22023';
  end if;
  if coalesce(p_rotate, false) then
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    insert into public.community_invites (community_id, code) values (p_community, v_code)
    on conflict (community_id) do update set code = excluded.code, created_at = now();
    return v_code;
  end if;
  select i.code into v_code from public.community_invites i where i.community_id = p_community;
  return v_code;
end $$;

create function public.review_join_request(p_community uuid, p_user uuid, p_approve boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not public.is_community_mod(p_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_approve then
    update public.memberships set status = 'active' where community_id = p_community and user_id = p_user and status = 'pending';
  else
    delete from public.memberships where community_id = p_community and user_id = p_user and status = 'pending';
  end if;
  if not found then
    raise exception 'no pending request' using errcode = 'P0002';
  end if;
  if p_approve then
    perform public.campus_notify(p_user, 'campus_join_approved',
      jsonb_build_object('community', (select name from public.communities where id = p_community), 'community_id', p_community));
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'community.request.' || case when p_approve then 'approve' else 'reject' end, 'community',
          p_community::text, jsonb_build_object('user_id', p_user));
  return true;
end $$;

-- Ban / unban. Moderators act on plain members; only the owner acts on moderators. Unban removes the membership row.
create function public.set_member_ban(p_community uuid, p_user uuid, p_ban boolean, p_reason text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t record;
begin
  perform public.campus_uid();
  if not public.is_community_mod(p_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot ban yourself' using errcode = '22023';
  end if;
  select m.role, m.status into t from public.memberships m where m.community_id = p_community and m.user_id = p_user;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if t.role = 'owner' or (t.role = 'moderator' and not public.is_community_owner(p_community)) then
    raise exception 'insufficient privileges for this member' using errcode = '42501';
  end if;
  if coalesce(p_ban, true) then
    update public.memberships set status = 'banned' where community_id = p_community and user_id = p_user;
  else
    delete from public.memberships where community_id = p_community and user_id = p_user and status = 'banned';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when coalesce(p_ban, true) then 'community.ban' else 'community.unban' end, 'community',
          p_community::text, jsonb_build_object('user_id', p_user, 'reason', left(p_reason, 500)));
  return true;
end $$;

-- Community moderators remove (soft-delete) posts/comments of their community only.
create function public.mod_remove_content(p_kind text, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_community uuid;
begin
  perform public.campus_uid();
  if p_kind not in ('post', 'comment') or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'valid kind and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  if p_kind = 'post' then
    select community_id into v_community from public.posts where id = p_id;
  else
    select p.community_id into v_community from public.comments c join public.posts p on p.id = c.post_id where c.id = p_id;
  end if;
  if v_community is null then
    raise exception 'content not found' using errcode = 'P0002';
  end if;
  if not public.is_community_mod(v_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_kind = 'post' then
    update public.posts set deleted_at = public.now_utc() where id = p_id and deleted_at is null;
  else
    update public.comments set deleted_at = public.now_utc() where id = p_id and deleted_at is null;
    update public.posts set accepted_comment_id = null where accepted_comment_id = p_id;
  end if;
  if found then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'content.remove', p_kind, p_id::text, jsonb_build_object('reason', btrim(p_reason), 'community_id', v_community));
  end if;
  return found;
end $$;

-- ---------------------------------------------------------------- reports and moderation queue
create function public.report_content(p_kind text, p_id uuid, p_category text, p_details text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_reason text := coalesce(nullif(btrim(p_details), ''), p_category);
  v_id uuid;
begin
  if p_kind not in ('post', 'comment', 'user', 'community')
     or p_category is null or p_category not in ('spam', 'harassment', 'hate', 'misinformation', 'inappropriate', 'other')
     or length(v_reason) not between 3 and 2000 then
    raise exception 'invalid report' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_details, 'details');
  perform public.campus_rate_check('report', interval '1 day', 20);
  if p_kind = 'post' then
    if not public.campus_post_visible(p_id) then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if public.owns_anon_post(p_id) or exists (select 1 from public.posts where id = p_id and author_id = v_uid) then
      raise exception 'you cannot report your own content' using errcode = '22023';
    end if;
    insert into public.reports (reporter_id, post_id, category, reason) values (v_uid, p_id, p_category, v_reason) returning id into v_id;
  elsif p_kind = 'comment' then
    if not public.can_view_comment(p_id) or not exists (select 1 from public.comments where id = p_id and deleted_at is null) then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.comments where id = p_id and author_id = v_uid) then
      raise exception 'you cannot report your own content' using errcode = '22023';
    end if;
    insert into public.reports (reporter_id, comment_id, category, reason) values (v_uid, p_id, p_category, v_reason) returning id into v_id;
  elsif p_kind = 'user' then
    if p_id = v_uid or not exists (select 1 from public.profiles where id = p_id) then
      raise exception 'invalid user' using errcode = '22023';
    end if;
    insert into public.reports (reporter_id, reported_user_id, category, reason) values (v_uid, p_id, p_category, v_reason) returning id into v_id;
  else
    if not public.campus_community_visible(p_id) and not exists (select 1 from public.communities where id = p_id and kind <> 'group') then
      raise exception 'not found' using errcode = 'P0002';
    end if;
    insert into public.reports (reporter_id, community_id, category, reason) values (v_uid, p_id, p_category, v_reason) returning id into v_id;
  end if;
  return v_id;
exception when unique_violation then
  raise exception 'you already have an open report for this item' using errcode = '23505';
end $$;

create function public.community_moderation_queue(p_community uuid, p_status text default 'open', p_limit integer default 50,
  p_offset integer default 0)
returns table (report_id uuid, target_kind text, target_id uuid, category text, reason text, status text, created_at timestamptz,
               excerpt text, author_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not public.is_community_mod(p_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_status not in ('open', 'reviewing', 'actioned', 'dismissed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  return query
  select r.id,
    case when r.post_id is not null then 'post' when r.comment_id is not null then 'comment' else 'community' end,
    coalesce(r.post_id, r.comment_id, r.community_id), r.category, r.reason, r.status::text, r.created_at,
    left(coalesce(p.title || ': ' || p.body, c.body), 300),
    coalesce(p.author_id, c.author_id)
  from public.reports r
  left join public.posts p on p.id = r.post_id
  left join public.comments c on c.id = r.comment_id
  left join public.posts cp on cp.id = c.post_id
  where r.status::text = p_status
    and (r.community_id = p_community or p.community_id = p_community or cp.community_id = p_community)
  order by r.created_at, r.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.community_resolve_report(p_report uuid, p_status text, p_note text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_community uuid;
  v_old public.report_status;
begin
  perform public.campus_uid();
  if p_status not in ('reviewing', 'actioned', 'dismissed') or length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid status or note' using errcode = '22023';
  end if;
  select r.status, coalesce(r.community_id, p.community_id, cp.community_id) into v_old, v_community
  from public.reports r
  left join public.posts p on p.id = r.post_id
  left join public.comments c on c.id = r.comment_id
  left join public.posts cp on cp.id = c.post_id
  where r.id = p_report for update of r;
  if not found or v_community is null then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if not public.is_community_mod(v_community) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if v_old in ('actioned', 'dismissed') then
    raise exception 'report already resolved' using errcode = '55000';
  end if;
  update public.reports set status = p_status::public.report_status, handled_by = auth.uid() where id = p_report;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'report.' || p_status, 'report', p_report::text, jsonb_build_object('from', v_old, 'note', p_note, 'community_id', v_community));
  return true;
end $$;

-- ---------------------------------------------------------------- follows, blocks, profile
create function public.follow_user(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
begin
  if p_user = v_uid or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'invalid user' using errcode = '22023';
  end if;
  if public.campus_blocked(v_uid, p_user) then
    raise exception 'you cannot follow this user' using errcode = '42501';
  end if;
  perform public.campus_rate_check('follow', interval '1 hour', 60);
  insert into public.follows (follower_id, followee_id) values (v_uid, p_user) on conflict do nothing;
  return found;
end $$;

create function public.unfollow_user(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  delete from public.follows where follower_id = auth.uid() and followee_id = p_user;
  return found;
end $$;

create function public.block_user(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
begin
  if p_user = v_uid or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'invalid user' using errcode = '22023';
  end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_uid, p_user) on conflict do nothing;
  delete from public.follows where (follower_id = v_uid and followee_id = p_user) or (follower_id = p_user and followee_id = v_uid);
  return true;
end $$;

create function public.unblock_user(p_user uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = p_user;
  return found;
end $$;

create function public.list_blocked_users() returns table (user_id uuid, display_name text, username text, blocked_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select b.blocked_id, pr.display_name, pr.username, b.created_at
  from public.blocks b join public.profiles pr on pr.id = b.blocked_id
  where b.blocker_id = auth.uid() order by b.created_at desc
$$;

create function public.set_campus_discoverable(p_value boolean) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  update public.profiles set campus_discoverable = coalesce(p_value, true) where id = auth.uid();
  return coalesce(p_value, true);
end $$;

-- Public student card. Nothing but name, username, university, bio and counts; null when either side blocked the other.
-- A profile that is not discoverable shows only name and university to others (no bio, no counts).
create function public.campus_profile(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  pr record;
  v_full boolean;
begin
  select p.id, p.display_name, p.username, p.bio, p.university_id, p.campus_discoverable into pr
  from public.profiles p where p.id = p_user;
  if not found or public.campus_blocked(v_uid, p_user) then
    return null;
  end if;
  v_full := p_user = v_uid or pr.campus_discoverable;
  return jsonb_build_object('id', pr.id, 'display_name', pr.display_name, 'username', pr.username,
    'university_id', pr.university_id, 'university_name', (select u.name from public.universities u where u.id = pr.university_id),
    'is_self', p_user = v_uid, 'discoverable', pr.campus_discoverable,
    'bio', case when v_full then pr.bio end,
    'follower_count', case when v_full then (select count(*) from public.follows f where f.followee_id = p_user) end,
    'following_count', case when v_full then (select count(*) from public.follows f where f.follower_id = p_user) end,
    'post_count', case when v_full then (select count(*) from public.posts x
        where x.author_id = p_user and not x.is_anonymous and x.deleted_at is null and public.community_is_public(x.community_id)) end,
    'is_following', exists (select 1 from public.follows f where f.follower_id = v_uid and f.followee_id = p_user));
end $$;

-- ---------------------------------------------------------------- search
create function public.search_campus(p_q text, p_limit integer default 10) returns jsonb
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
        select pr.id, pr.display_name, pr.username, (select u.name from public.universities u where u.id = pr.university_id) as university_name
        from public.profiles pr
        where pr.campus_discoverable and pr.id <> v_uid and (pr.display_name ilike v_pat or pr.username ilike v_pat)
          and not public.campus_blocked(v_uid, pr.id)
        order by pr.display_name, pr.id limit v_lim) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- events
create function public.create_event(p_community uuid, p_title text, p_starts_at timestamptz, p_description text default null,
  p_location text default null, p_ends_at timestamptz default null, p_capacity integer default null, p_language text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_status public.content_status;
  c record;
  v_id uuid;
begin
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_description, '')) > 4000
     or length(coalesce(p_location, '')) > 200 or p_starts_at is null then
    raise exception 'title (1-200), description (<= 4000), location (<= 200) and start time are required' using errcode = '22023';
  end if;
  if p_starts_at <= public.now_utc() or (p_ends_at is not null and p_ends_at < p_starts_at) then
    raise exception 'event must start in the future and end after it starts' using errcode = '22023';
  end if;
  if p_capacity is not null and p_capacity not between 1 and 10000 then
    raise exception 'capacity must be 1-10000' using errcode = '22023';
  end if;
  if p_language is not null and p_language not in ('az', 'tr', 'en', 'ru') then
    raise exception 'invalid language' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_title, 'title');
  perform public.campus_assert_text(p_description, 'description');
  perform public.campus_assert_text(p_location, 'location');
  perform public.campus_rate_check('event', interval '1 day', 5);
  if p_community is not null then
    select x.visibility, x.university_id into c from public.communities x where x.id = p_community;
    if not found or not public.is_member(p_community) then
      raise exception 'must be an active member of the community' using errcode = '42501';
    end if;
    v_status := case when c.visibility = 'private' or public.is_community_mod(p_community) or public.is_moderator()
                     then 'published' else 'pending' end;
  else
    v_status := case when public.is_moderator() then 'published' else 'pending' end;
  end if;
  insert into public.events (created_by, university_id, community_id, title, description, location, starts_at, ends_at,
                             capacity, language, status)
  values (v_uid, coalesce(c.university_id, public.my_university_id()), p_community, btrim(p_title),
          nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_location, '')), ''), p_starts_at, p_ends_at,
          p_capacity, p_language, v_status)
  returning id into v_id;
  return v_id;
end $$;

-- Creator edits; a published event in a public/campus-wide scope returns to review unless a moderator edits.
create function public.edit_event(p_event uuid, p_title text, p_description text, p_location text, p_starts_at timestamptz,
  p_ends_at timestamptz default null, p_capacity integer default null) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record;
  v_status text;
begin
  perform public.campus_uid();
  select x.created_by, x.status::text as status, x.community_id into e from public.events x where x.id = p_event for update;
  if not found or e.created_by <> auth.uid() or e.status = 'removed' then
    raise exception 'event not found or not yours' using errcode = '42501';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_description, '')) > 4000
     or length(coalesce(p_location, '')) > 200 or p_starts_at is null or (p_ends_at is not null and p_ends_at < p_starts_at)
     or (p_capacity is not null and p_capacity not between 1 and 10000) then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_title, 'title');
  perform public.campus_assert_text(p_description, 'description');
  perform public.campus_assert_text(p_location, 'location');
  v_status := e.status;
  if e.status = 'published' and not (public.is_moderator()
      or (e.community_id is not null and (public.is_community_mod(e.community_id)
          or exists (select 1 from public.communities c where c.id = e.community_id and c.visibility = 'private')))) then
    v_status := 'pending';
  end if;
  update public.events set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''),
    location = nullif(btrim(coalesce(p_location, '')), ''), starts_at = p_starts_at, ends_at = p_ends_at, capacity = p_capacity,
    status = v_status::public.content_status where id = p_event;
  return v_status;
end $$;

create function public.cancel_event(p_event uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record;
begin
  perform public.campus_uid();
  select x.created_by, x.community_id into e from public.events x where x.id = p_event;
  if not found or not (e.created_by = auth.uid() or public.is_moderator()
                       or (e.community_id is not null and public.is_community_mod(e.community_id))) then
    raise exception 'event not found or not allowed' using errcode = '42501';
  end if;
  update public.events set status = 'removed' where id = p_event and status <> 'removed';
  return found;
end $$;

create function public.moderate_event(p_event uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e record;
  v_new text := case when p_approve then 'published' else 'removed' end;
begin
  perform public.campus_uid();
  select x.community_id, x.status::text as status into e from public.events x where x.id = p_event for update;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if not (public.is_moderator() or (e.community_id is not null and public.is_community_mod(e.community_id))) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if e.status <> 'pending' then
    raise exception 'event is not pending review' using errcode = '55000';
  end if;
  update public.events set status = v_new::public.content_status where id = p_event;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'event.' || case when p_approve then 'approve' else 'reject' end, 'event', p_event::text, '{}'::jsonb);
  return v_new;
end $$;

create function public.list_events(p_scope text default 'upcoming', p_community uuid default null, p_limit integer default 20,
  p_after_ts timestamptz default null, p_after_id uuid default null) returns setof public.campus_event_row
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_now timestamptz := public.now_utc();
begin
  if p_scope is null or p_scope not in ('upcoming', 'mine', 'going', 'pending') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if p_scope = 'pending' and (p_community is null or not (public.is_community_mod(p_community) or public.is_moderator())) then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  return query
  select c.* from (
    select e.id, e.starts_at from public.events e
    where e.status <> 'removed'
      and (p_community is null or e.community_id = p_community)
      and ((p_scope = 'mine' and e.created_by = v_uid)
        or (p_scope = 'pending' and e.status = 'pending')
        or (p_scope in ('upcoming', 'going') and e.status = 'published' and coalesce(e.ends_at, e.starts_at) >= v_now
            and (e.community_id is null or public.community_is_public(e.community_id) or public.is_member(e.community_id))
            and not public.campus_blocked(v_uid, e.created_by)
            and (p_scope = 'upcoming' or exists (select 1 from public.event_rsvps r where r.event_id = e.id and r.user_id = v_uid))))
      and (p_after_ts is null or e.starts_at > p_after_ts or (p_after_id is not null and e.starts_at = p_after_ts and e.id > p_after_id))
    order by e.starts_at, e.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ) b
  cross join lateral public.campus_event_card(b.id) c
  order by b.starts_at, b.id;
end $$;

create function public.get_event(p_event uuid) returns setof public.campus_event_row
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not exists (
      select 1 from public.events e where e.id = p_event and e.status <> 'removed'
        and (e.created_by = auth.uid() or public.is_moderator()
             or (e.status = 'published' and (e.community_id is null or public.community_is_public(e.community_id)
                                             or public.is_member(e.community_id))
                 and not public.campus_blocked(auth.uid(), e.created_by)))) then
    return;
  end if;
  return query select * from public.campus_event_card(p_event);
end $$;

create function public.rsvp_event(p_event uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  e record;
  v_going integer;
  v_old text;
begin
  if p_status is null or p_status not in ('going', 'interested', 'none') then
    raise exception 'invalid rsvp' using errcode = '22023';
  end if;
  select x.status::text as status, x.community_id, x.capacity, x.starts_at, x.ends_at, x.created_by into e
  from public.events x where x.id = p_event for update;
  if not found or e.status <> 'published'
     or not (e.community_id is null or public.community_is_public(e.community_id) or public.is_member(e.community_id))
     or public.campus_blocked(v_uid, e.created_by) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  if p_status <> 'none' and coalesce(e.ends_at, e.starts_at) < public.now_utc() then
    raise exception 'event is over' using errcode = '55000';
  end if;
  select r.status into v_old from public.event_rsvps r where r.event_id = p_event and r.user_id = v_uid;
  if p_status = 'none' then
    delete from public.event_rsvps where event_id = p_event and user_id = v_uid;
  else
    if p_status = 'going' and v_old is distinct from 'going' and e.capacity is not null then
      select count(*) into v_going from public.event_rsvps r where r.event_id = p_event and r.status = 'going';
      if v_going >= e.capacity then
        raise exception 'event is full' using errcode = '53400';
      end if;
    end if;
    insert into public.event_rsvps (event_id, user_id, status) values (p_event, v_uid, p_status)
    on conflict (event_id, user_id) do update set status = excluded.status;
  end if;
  return jsonb_build_object(
    'going', (select count(*) from public.event_rsvps r where r.event_id = p_event and r.status = 'going'),
    'interested', (select count(*) from public.event_rsvps r where r.event_id = p_event and r.status = 'interested'),
    'my_rsvp', (select r.status from public.event_rsvps r where r.event_id = p_event and r.user_id = v_uid));
end $$;

-- Creates a real planner task (tasks table) due at the event start; idempotent per user and event.
create function public.add_event_to_planner(p_event uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  e record;
  v_task uuid;
begin
  select x.title, x.location, x.description, x.starts_at, x.status::text as status, x.community_id, x.created_by into e
  from public.events x where x.id = p_event;
  if not found or e.status <> 'published'
     or not (e.community_id is null or public.community_is_public(e.community_id) or public.is_member(e.community_id)) then
    raise exception 'event not found' using errcode = 'P0002';
  end if;
  select l.task_id into v_task from public.event_planner_links l where l.user_id = v_uid and l.event_id = p_event;
  if v_task is not null then
    return v_task;
  end if;
  insert into public.tasks (user_id, title, description, due_at)
  values (v_uid, left(e.title, 200), left(concat_ws(E'\n', e.location, e.description), 4000), e.starts_at)
  returning id into v_task;
  insert into public.event_planner_links (user_id, event_id, task_id) values (v_uid, p_event, v_task);
  return v_task;
end $$;

-- Reminder producer for a scheduler (service_role): one notification per (event, user); returns how many were sent.
create function public.send_event_reminders(p_within_hours integer default 24) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_n integer := 0;
  v_before integer;
begin
  for r in
    select e.id, e.title, e.starts_at, s.user_id from public.events e
    join public.event_rsvps s on s.event_id = e.id
    where e.status = 'published' and e.starts_at > public.now_utc()
      and e.starts_at <= public.now_utc() + make_interval(hours => least(greatest(coalesce(p_within_hours, 24), 1), 168))
  loop
    select count(*) into v_before from public.campus_notified where key = md5('event:' || r.id::text || ':' || r.user_id::text);
    if v_before = 0 then
      perform public.campus_notify(r.user_id, 'campus_event_reminder',
        jsonb_build_object('title', left(r.title, 80), 'date', to_char(r.starts_at at time zone 'Asia/Baku', 'DD.MM.YYYY HH24:MI'),
                           'event_id', r.id),
        'event:' || r.id::text || ':' || r.user_id::text);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- notification templates (NEEDS NATIVE REVIEW)
insert into public.notification_templates (key, locale, title, body) values
  ('campus_post_reply', 'az', 'Yeni cavab', '{name} “{title}” yazınıza cavab yazdı.'),
  ('campus_post_reply', 'tr', 'Yeni yanıt', '{name}, “{title}” gönderinize yanıt yazdı.'),
  ('campus_post_reply', 'en', 'New reply', '{name} replied to your post “{title}”.'),
  ('campus_post_reply', 'ru', 'Новый ответ', '{name} ответил(а) на вашу публикацию «{title}».'),
  ('campus_comment_reply', 'az', 'Şərhinizə cavab', '{name} şərhinizə cavab verdi.'),
  ('campus_comment_reply', 'tr', 'Yorumunuza yanıt', '{name} yorumunuza yanıt verdi.'),
  ('campus_comment_reply', 'en', 'Reply to your comment', '{name} replied to your comment.'),
  ('campus_comment_reply', 'ru', 'Ответ на ваш комментарий', '{name} ответил(а) на ваш комментарий.'),
  ('campus_reaction_milestone', 'az', 'Məzmununuz bəyənildi', 'Məzmununuz {count} bəyənmə topladı.'),
  ('campus_reaction_milestone', 'tr', 'İçeriğiniz beğenildi', 'İçeriğiniz {count} beğeni aldı.'),
  ('campus_reaction_milestone', 'en', 'People like your content', 'Your content reached {count} likes.'),
  ('campus_reaction_milestone', 'ru', 'Ваш материал оценили', 'Ваш материал набрал отметок «нравится»: {count}.'),
  ('campus_new_follower', 'az', 'Yeni izləyici', '{name} sizi izləməyə başladı.'),
  ('campus_new_follower', 'tr', 'Yeni takipçi', '{name} sizi takip etmeye başladı.'),
  ('campus_new_follower', 'en', 'New follower', '{name} started following you.'),
  ('campus_new_follower', 'ru', 'Новый подписчик', '{name} подписался(-лась) на вас.'),
  ('campus_join_request', 'az', 'Qoşulma sorğusu', '{name} “{community}” icmasına qoşulmaq istəyir.'),
  ('campus_join_request', 'tr', 'Katılma isteği', '{name}, “{community}” topluluğuna katılmak istiyor.'),
  ('campus_join_request', 'en', 'Join request', '{name} wants to join “{community}”.'),
  ('campus_join_request', 'ru', 'Запрос на вступление', '{name} хочет вступить в сообщество «{community}».'),
  ('campus_join_approved', 'az', 'Sorğunuz qəbul edildi', '“{community}” icmasına qoşulmağınız təsdiqləndi.'),
  ('campus_join_approved', 'tr', 'İsteğiniz onaylandı', '“{community}” topluluğuna katılımınız onaylandı.'),
  ('campus_join_approved', 'en', 'Request approved', 'You can now join the conversation in “{community}”.'),
  ('campus_join_approved', 'ru', 'Запрос одобрен', 'Ваше вступление в сообщество «{community}» одобрено.'),
  ('campus_event_reminder', 'az', 'Tədbir yaxınlaşır', '“{title}” tədbiri {date} tarixində başlayır.'),
  ('campus_event_reminder', 'tr', 'Etkinlik yaklaşıyor', '“{title}” etkinliği {date} tarihinde başlıyor.'),
  ('campus_event_reminder', 'en', 'Event coming up', '“{title}” starts on {date}.'),
  ('campus_event_reminder', 'ru', 'Скоро мероприятие', 'Мероприятие «{title}» начинается {date}.')
on conflict (key, locale) do nothing;

-- ---------------------------------------------------------------- privileges
do $$
declare
  r record;
  v_api text[] := array[
    'home_feed', 'community_feed', 'user_posts', 'get_post', 'post_comments', 'create_post', 'edit_post', 'delete_post',
    'create_comment', 'edit_comment', 'delete_comment', 'react', 'set_accepted_answer', 'ensure_university_community',
    'create_community', 'update_community', 'discover_communities', 'get_community', 'community_members', 'join_community',
    'leave_community', 'join_by_code', 'get_invite_code', 'review_join_request', 'set_member_ban', 'mod_remove_content',
    'report_content', 'community_moderation_queue', 'community_resolve_report', 'follow_user', 'unfollow_user', 'block_user',
    'unblock_user', 'list_blocked_users', 'set_campus_discoverable', 'campus_profile', 'search_campus', 'create_event',
    'edit_event', 'cancel_event', 'moderate_event', 'list_events', 'get_event', 'rsvp_event', 'add_event_to_planner'];
  v_internal text[] := array[
    'campus_uid', 'campus_blocked', 'campus_like_escape', 'campus_rate_check',
    'campus_notify', 'campus_display_name', 'campus_post_owner', 'campus_posts_guard', 'campus_comments_guard',
    'campus_comments_notify', 'campus_reactions_notify', 'campus_follows_notify', 'campus_memberships_guard',
    'campus_memberships_notify', 'campus_communities_guard', 'campus_events_guard', 'campus_reports_resolved', 'campus_profile_cleanup', 'campus_profile_cleanup',
    'campus_post_visible', 'campus_community_visible', 'campus_post_card', 'campus_event_card', 'campus_feed',
    'send_event_reminders'];
begin
  revoke all on function public.campus_text_ok(text), public.campus_assert_text(text, text) from public, anon;
  grant execute on function public.campus_text_ok(text), public.campus_assert_text(text, text) to authenticated, service_role;
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(v_api || v_internal) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = any(v_api) then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    elsif r.proname = 'send_event_reminders' then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $$;
