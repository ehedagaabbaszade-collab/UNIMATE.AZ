-- CAMPUS hardening (review round 1). Postgres 15 syntax only. Does not edit applied migrations.
--  1. Anonymous asker anonymity in threads, notifications, moderation queue, direct table reads
--  2. join_by_code: durable failed-attempt accounting, per-user + global throttle, strong invite codes (rotated)
--  3. Reports about a community are for SITE moderators only
--  4. Direct-write bypass guards (reactions, communities, memberships) mirroring the RPC rules, API roles only
--  5. Nits: pin accepted_comment_id/edited_at, add_event_to_planner block check
--
-- RENDERING CONTRACT: every user-controlled string (names, titles, post/comment bodies, community names) that reaches
-- HTML or email MUST be escaped by the renderer (packages/core text/template.ts: escapeHtml / renderEmailTemplate do
-- this and are unit-tested). Notification params stored here are raw text, never markup.

-- ---------------------------------------------------------------- 1. anonymous asker
-- Internal: is p_user the (private) author of the anonymous post p_post?  Not callable by clients (it would be an oracle).
create function public.campus_is_anon_op(p_post uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_user is not null and exists (
    select 1 from public.posts p join public.post_private_authors a on a.post_id = p.id
    where p.id = p_post and p.is_anonymous and a.author_id = p_user)
$$;

-- Client-callable (RLS policy below needs it): only says whether a COMMENT was written by its anonymous post's asker,
-- which every client already learns through is_op, and never WHO that is.
create function public.campus_comment_is_anon_op(p_comment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.comments c
    join public.posts p on p.id = c.post_id and p.is_anonymous
    join public.post_private_authors a on a.post_id = p.id and a.author_id = c.author_id
    where c.id = p_comment)
$$;

-- Direct table reads: the asker's own replies in an anonymous thread carry the real author_id, so they are invisible to
-- everyone but the author and site moderators on the table (clients use post_comments(), which nulls the author).
drop policy comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (public.is_moderator() or author_id = (select auth.uid())
         or (deleted_at is null and not public.has_block_between(author_id) and public.can_view_post(post_id)
             and not public.campus_comment_is_anon_op(id)));

alter type public.campus_comment_row add attribute is_op boolean;

create or replace function public.post_comments(p_post uuid, p_limit integer default 100, p_after_ts timestamptz default null,
  p_after_id uuid default null) returns setof public.campus_comment_row
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
begin
  if not public.campus_post_visible(p_post) then
    return;
  end if;
  return query
  select c.id, c.post_id, c.parent_id, c.depth::integer,
    case when x.anon_op then null else c.author_id end,
    case when x.anon_op then null else pr.display_name end,
    case when x.anon_op then null else pr.username end,
    (c.author_id = v_uid),
    case when c.deleted_at is null then c.body end, c.language, c.created_at, c.edited_at, (c.deleted_at is not null),
    (select count(*)::integer from public.reactions r where r.comment_id = c.id and r.kind = 'like'),
    (select count(*)::integer from public.reactions r where r.comment_id = c.id and r.kind = 'helpful'),
    exists (select 1 from public.reactions r where r.comment_id = c.id and r.kind = 'like' and r.user_id = v_uid),
    exists (select 1 from public.reactions r where r.comment_id = c.id and r.kind = 'helpful' and r.user_id = v_uid),
    (c.id = p.accepted_comment_id),
    x.is_op
  from public.comments c
  join public.posts p on p.id = c.post_id
  cross join lateral (select (c.author_id = public.campus_post_owner(p.id)) as is_op,
                             (p.is_anonymous and c.author_id = public.campus_post_owner(p.id)) as anon_op) x
  left join public.profiles pr on pr.id = c.author_id
  where c.post_id = p_post
    -- never hide the asker's replies because of a block: that would reveal who the anonymous asker is
    and (x.anon_op or not public.campus_blocked(v_uid, c.author_id))
    and (c.deleted_at is null or exists (select 1 from public.comments ch where ch.parent_id = c.id and ch.deleted_at is null))
    and (p_after_ts is null or c.created_at > p_after_ts or (p_after_id is not null and c.created_at = p_after_ts and c.id > p_after_id))
  order by c.created_at, c.id
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.create_comment(p_post uuid, p_body text, p_parent uuid default null, p_language text default null) returns uuid
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
        and (public.campus_is_anon_op(c.post_id, c.author_id) or not public.campus_blocked(v_uid, c.author_id))) then
    raise exception 'parent comment not found' using errcode = 'P0002';
  end if;
  insert into public.comments (post_id, parent_id, author_id, body, language)
  values (p_post, p_parent, v_uid, btrim(p_body), p_language) returning id into v_id;
  return v_id;
end $$;

create or replace function public.react(p_target text, p_id uuid, p_kind text, p_on boolean default true) returns jsonb
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
    if not public.campus_is_anon_op(v_post, v_author) and public.campus_blocked(v_uid, v_author) then
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

-- Reply notifications: nothing identifying the asker (no name, no user_id) when the asker of an anonymous post replies.
create or replace function public.campus_comments_notify() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_post record;
  v_owner uuid;
  v_parent_author uuid;
  v_anon_op boolean;
  v_params jsonb;
begin
  select p.title, p.community_id into v_post from public.posts p where p.id = new.post_id;
  v_owner := public.campus_post_owner(new.post_id);
  v_anon_op := public.campus_is_anon_op(new.post_id, new.author_id);
  if v_anon_op then
    v_params := jsonb_build_object('title', left(v_post.title, 80), 'post_id', new.post_id,
                                   'comment_id', new.id, 'community_id', v_post.community_id);
  else
    v_params := jsonb_build_object('name', public.campus_display_name(new.author_id), 'title', left(v_post.title, 80),
                                   'post_id', new.post_id, 'comment_id', new.id, 'community_id', v_post.community_id,
                                   'user_id', new.author_id);
  end if;
  if v_owner is not null and v_owner <> new.author_id and not public.campus_blocked(v_owner, new.author_id) then
    perform public.campus_notify(v_owner, 'campus_post_reply', v_params);
  end if;
  if new.parent_id is not null then
    select c.author_id into v_parent_author from public.comments c where c.id = new.parent_id;
    if v_parent_author is not null and v_parent_author <> new.author_id and v_parent_author is distinct from v_owner
       and not public.campus_blocked(v_parent_author, new.author_id) then
      perform public.campus_notify(v_parent_author, case when v_anon_op then 'campus_comment_reply_op' else 'campus_comment_reply' end, v_params);
    end if;
  end if;
  return new;
end $$;

insert into public.notification_templates (key, locale, title, body) values
  ('campus_comment_reply_op', 'az', 'Şərhinizə cavab', 'Sualın müəllifi şərhinizə cavab verdi.'),
  ('campus_comment_reply_op', 'tr', 'Yorumunuza yanıt', 'Sorunun sahibi yorumunuza yanıt verdi.'),
  ('campus_comment_reply_op', 'en', 'Reply to your comment', 'The asker replied to your comment.'),
  ('campus_comment_reply_op', 'ru', 'Ответ на ваш комментарий', 'Автор вопроса ответил(а) на ваш комментарий.')
on conflict (key, locale) do nothing;

-- Scrub identity from notifications already stored for replies written by an anonymous asker.
update public.notifications n
set template_key = case when n.template_key = 'campus_comment_reply' then 'campus_comment_reply_op' else n.template_key end,
    params = n.params - 'name' - 'user_id'
where n.template_key in ('campus_comment_reply', 'campus_post_reply')
  and n.params ? 'comment_id'
  and exists (select 1 from public.comments c where c.id::text = n.params ->> 'comment_id'
              and public.campus_is_anon_op(c.post_id, c.author_id));

-- Moderation queue: community moderators see the report TARGET, never the author of an anonymous asker's reply, and no
-- longer see reports about their own community (site moderators handle those).
create or replace function public.community_moderation_queue(p_community uuid, p_status text default 'open', p_limit integer default 50,
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
    case when r.post_id is not null then 'post' else 'comment' end,
    coalesce(r.post_id, r.comment_id), r.category, r.reason, r.status::text, r.created_at,
    left(coalesce(p.title || ': ' || p.body, c.body), 300),
    case when c.id is not null and public.campus_is_anon_op(c.post_id, c.author_id) then null
         else coalesce(p.author_id, c.author_id) end
  from public.reports r
  left join public.posts p on p.id = r.post_id
  left join public.comments c on c.id = r.comment_id
  left join public.posts cp on cp.id = c.post_id
  where r.status::text = p_status and r.community_id is null
    and (p.community_id = p_community or cp.community_id = p_community)
  order by r.created_at, r.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------- 3. community reports: site moderators only
create or replace function public.community_resolve_report(p_report uuid, p_status text, p_note text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_community uuid;
  v_old public.report_status;
begin
  perform public.campus_uid();
  if p_status not in ('reviewing', 'actioned', 'dismissed') or length(coalesce(p_note, '')) > 500 then
    raise exception 'invalid status or note' using errcode = '22023';
  end if;
  select r.status, coalesce(p.community_id, cp.community_id) into v_old, v_community
  from public.reports r
  left join public.posts p on p.id = r.post_id
  left join public.comments c on c.id = r.comment_id
  left join public.posts cp on cp.id = c.post_id
  where r.id = p_report and r.community_id is null for update of r;
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

-- ---------------------------------------------------------------- 2. invite codes + join_by_code
-- 20 chars from the full A-Z0-9 alphabet (~103 bits). Bytes come from gen_random_uuid() (CSPRNG in core Postgres, so no
-- pgcrypto/extension-schema dependency); the version/variant bytes (6 and 8) are skipped and bytes >= 252 rejected, so
-- every character is uniform.
create function public.campus_gen_invite_code() returns text
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_alpha constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  v_code text := '';
  v_bytes bytea;
  v_b integer;
  i integer;
begin
  while length(v_code) < 20 loop
    v_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    for i in 0..15 loop
      continue when i in (6, 8);
      v_b := get_byte(v_bytes, i);
      if v_b < 252 and length(v_code) < 20 then
        v_code := v_code || substr(v_alpha, (v_b % 36) + 1, 1);
      end if;
    end loop;
  end loop;
  return v_code;
end $$;
revoke all on function public.campus_gen_invite_code() from public, anon, authenticated;

alter table public.community_invites drop constraint community_invites_code_check;
-- Rotate every existing (10 char) code; old codes stop working.
update public.community_invites set code = public.campus_gen_invite_code(), created_at = now();
alter table public.community_invites add constraint community_invites_code_check check (code ~ '^[A-Z0-9]{16,64}$');
create index campus_actions_kind_idx on public.campus_actions(kind, created_at desc);

-- A miss returns NULL instead of raising, so the 'invite_miss' row COMMITS (a raise would roll the accounting back).
-- Limits: 10 misses / hour per user, 500 misses / 10 minutes across all users, 20 attempts / hour per user.
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
  insert into public.memberships (community_id, user_id, role, status) values (v_id, v_uid, 'member', 'active')
  on conflict (community_id, user_id) do update set status = 'active' where public.memberships.status = 'pending';
  return v_id;
end $$;

create or replace function public.get_invite_code(p_community uuid, p_rotate boolean default false) returns text
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
    v_code := public.campus_gen_invite_code();
    insert into public.community_invites (community_id, code) values (p_community, v_code)
    on conflict (community_id) do update set code = excluded.code, created_at = now();
    return v_code;
  end if;
  select i.code into v_code from public.community_invites i where i.community_id = p_community;
  return v_code;
end $$;

-- ---------------------------------------------------------------- 4. direct-write bypass guards (API roles only)
-- Fixed-kind wrapper so BEFORE triggers that must stay SECURITY INVOKER (current_user tells direct writes from the
-- SECURITY DEFINER RPCs) can still charge the per-user limiter. Clients can call it, but only with these two kinds.
create function public.campus_direct_rate(p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_kind = 'react' then
    perform public.campus_rate_check('react', interval '1 minute', 60);
  elsif p_kind = 'community' then
    perform public.campus_rate_check('community', interval '1 day', 5);
  else
    raise exception 'unknown rate kind' using errcode = '22023';
  end if;
end $$;

-- Study groups cannot be joined by direct membership writes (invite code / join_by_code only). Safe to expose: it
-- reveals only a community's kind, which discover/search already show for visible communities.
create function public.campus_is_study_group(p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.communities c where c.id = p_community and c.kind = 'group')
$$;

create function public.campus_reactions_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_post uuid;
  v_author uuid;
  v_pkind text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.kind not in ('like', 'helpful') then
    raise exception 'invalid reaction' using errcode = '22023';
  end if;
  if new.post_id is not null then
    if new.kind = 'helpful' then
      raise exception 'helpful applies to answers only' using errcode = '22023';
    end if;
    select p.author_id into v_author from public.posts p where p.id = new.post_id;
    if v_author = new.user_id or public.owns_anon_post(new.post_id) then
      raise exception 'you cannot react to your own content' using errcode = '42501';
    end if;
  else
    select c.post_id, c.author_id into v_post, v_author from public.comments c where c.id = new.comment_id;
    if v_author = new.user_id then
      raise exception 'you cannot react to your own content' using errcode = '42501';
    end if;
    if new.kind = 'helpful' then
      select p.kind::text into v_pkind from public.posts p where p.id = v_post;
      if v_pkind is distinct from 'question' then
        raise exception 'helpful applies to answers only' using errcode = '22023';
      end if;
    end if;
  end if;
  perform public.campus_direct_rate('react');
  return new;
end $$;
create trigger reactions_campus_guard before insert on public.reactions
  for each row execute function public.campus_reactions_guard();

-- Invite code for every study group, however it was created (RPC or direct insert).
create function public.campus_communities_invite() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'group' then
    insert into public.community_invites (community_id, code) values (new.id, public.campus_gen_invite_code())
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger communities_campus_invite after insert on public.communities
  for each row execute function public.campus_communities_invite();

create or replace function public.campus_communities_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.uid() is not null then
    perform public.campus_assert_text(new.name, 'name');
    perform public.campus_assert_text(new.description, 'description');
    perform public.campus_assert_text(new.rules, 'rules');
  end if;
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.kind <> 'group' then
        raise exception 'community kind is set by the server' using errcode = '42501';
      end if;
      new.visibility := 'private';
      perform public.campus_direct_rate('community');
    elsif new.kind is distinct from old.kind or new.university_id is distinct from old.university_id then
      raise exception 'community kind and university are immutable' using errcode = '42501';
    elsif new.visibility is distinct from old.visibility and new.kind = 'group' then
      raise exception 'study groups are always private' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function public.campus_memberships_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  c record;
begin
  if current_user in ('anon', 'authenticated') and public.campus_is_study_group(new.community_id) then
    raise exception 'study groups are joined with an invite code' using errcode = '42501';
  end if;
  select cm.name, cm.kind, cm.university_id into c from public.communities cm where cm.id = new.community_id;
  if current_user in ('anon', 'authenticated') and c.kind = 'university'
     and c.university_id is distinct from public.my_university_id() then
    raise exception 'only students of this university may join' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.create_community(p_name text, p_kind text, p_visibility text default 'public',
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
  -- the invite code of a study group is created by the communities_campus_invite trigger
  insert into public.communities (university_id, name, slug, description, rules, visibility, kind, created_by)
  values (public.my_university_id(), btrim(p_name),
          left(coalesce(nullif(v_base, ''), 'c'), 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8),
          nullif(btrim(coalesce(p_description, '')), ''), nullif(btrim(coalesce(p_rules, '')), ''), v_vis, p_kind, v_uid)
  returning id into v_id;
  return v_id;
end $$;

-- Existing study groups created by direct inserts: make them private and give them a code.
update public.communities set visibility = 'private' where kind = 'group' and visibility <> 'private';
insert into public.community_invites (community_id, code)
select c.id, public.campus_gen_invite_code() from public.communities c
where c.kind = 'group' and not exists (select 1 from public.community_invites i where i.community_id = c.id);

-- ---------------------------------------------------------------- 5. nits
-- Pin server-owned columns for direct API writes (the RPCs run as the function owner and are not affected).
create function public.campus_posts_pin() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.accepted_comment_id := null;
      new.edited_at := null;
    else
      new.accepted_comment_id := old.accepted_comment_id;
      new.edited_at := old.edited_at;
    end if;
  end if;
  return new;
end $$;
-- named so it fires BEFORE posts_campus_guard (which stamps edited_at on a real text edit)
create trigger posts_a_pin before insert or update on public.posts
  for each row execute function public.campus_posts_pin();

create function public.campus_comments_pin() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.edited_at := case when tg_op = 'INSERT' then null else old.edited_at end;
  end if;
  return new;
end $$;
create trigger comments_a_pin before insert or update on public.comments
  for each row execute function public.campus_comments_pin();

create or replace function public.add_event_to_planner(p_event uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  e record;
  v_task uuid;
begin
  select x.title, x.location, x.description, x.starts_at, x.status::text as status, x.community_id, x.created_by into e
  from public.events x where x.id = p_event;
  if not found or e.status <> 'published'
     or not (e.community_id is null or public.community_is_public(e.community_id) or public.is_member(e.community_id))
     or public.campus_blocked(v_uid, e.created_by) then
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

-- ---------------------------------------------------------------- privileges (re-grant after create or replace)
do $$
declare
  r record;
  v_internal text[] := array['campus_is_anon_op', 'campus_gen_invite_code', 'campus_reactions_guard', 'campus_communities_invite',
    'campus_posts_pin', 'campus_comments_pin', 'campus_comments_notify', 'campus_communities_guard', 'campus_memberships_guard'];
  v_api text[] := array['post_comments', 'create_comment', 'react', 'community_moderation_queue', 'community_resolve_report',
    'join_by_code', 'get_invite_code', 'create_community', 'add_event_to_planner'];
  v_client_helper text[] := array['campus_comment_is_anon_op', 'campus_direct_rate', 'campus_is_study_group'];
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = any(v_internal || v_api || v_client_helper) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    if r.proname = any(v_api) or r.proname = any(v_client_helper) then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    end if;
  end loop;
end $$;
