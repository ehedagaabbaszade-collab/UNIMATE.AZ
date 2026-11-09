-- Security hardening (review findings B1, S1-S9 and nits).
-- Trusted roles (postgres, service_role, auth admin) are unrestricted; guards apply to anon/authenticated only.

-- ---------------------------------------------------------------- helpers
create function public.is_community_owner(p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.community_id = p_community and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'owner')
$$;

-- Site moderator, or moderator/owner of the community the post lives in.
create function public.is_post_mod(p_post uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_moderator() or exists (
    select 1 from public.posts p where p.id = p_post and public.is_community_mod(p.community_id))
$$;

-- SECURITY DEFINER so the comments insert policy can inspect comments without recursing into comments RLS.
create function public.comment_belongs_to_post(p_comment uuid, p_post uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.comments c where c.id = p_comment and c.post_id = p_post)
$$;

revoke all on function public.is_community_owner(uuid), public.is_post_mod(uuid), public.comment_belongs_to_post(uuid, uuid)
  from public, anon;
grant execute on function public.is_community_owner(uuid), public.is_post_mod(uuid), public.comment_belongs_to_post(uuid, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------- B1: community privilege escalation
create function public.guard_membership_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_admin() then
    if new.user_id is distinct from old.user_id or new.community_id is distinct from old.community_id then
      raise exception 'membership user_id and community_id are immutable' using errcode = '42501';
    end if;
    if old.role = 'owner' or new.role = 'owner' then
      raise exception 'owner membership changes only via transfer_community_ownership' using errcode = '42501';
    end if;
    if new.role is distinct from old.role and not public.is_community_owner(old.community_id) then
      raise exception 'only the community owner may change roles' using errcode = '42501';
    end if;
    if old.role <> 'member' and not public.is_community_owner(old.community_id) then
      raise exception 'only the community owner may modify moderators' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger memberships_guard_update before update on public.memberships
  for each row execute function public.guard_membership_update();

create function public.transfer_community_ownership(p_community uuid, p_new_owner uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not (public.is_community_owner(p_community) or public.is_admin()) then
    raise exception 'only the community owner may transfer ownership' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships
                 where community_id = p_community and user_id = p_new_owner and status = 'active') then
    raise exception 'new owner must be an active member of the community' using errcode = '42501';
  end if;
  update public.memberships set role = 'moderator'
    where community_id = p_community and role = 'owner' and user_id <> p_new_owner;
  update public.memberships set role = 'owner' where community_id = p_community and user_id = p_new_owner;
end $$;
revoke all on function public.transfer_community_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_community_ownership(uuid, uuid) to authenticated, service_role;

drop policy memberships_leave on public.memberships;
create policy memberships_leave on public.memberships for delete to authenticated
  using ((user_id = (select auth.uid()) and status <> 'banned' and role <> 'owner')
         or (public.is_community_mod(community_id) and role = 'member')
         or (public.is_community_owner(community_id) and role <> 'owner')
         or public.is_admin());

create function public.guard_community_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and new.created_by is distinct from old.created_by then
    raise exception 'communities.created_by is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger communities_guard_update before update on public.communities
  for each row execute function public.guard_community_update();

drop policy communities_delete on public.communities;
create policy communities_delete on public.communities for delete to authenticated
  using (public.is_community_owner(id) or public.is_admin());

-- ---------------------------------------------------------------- S1: account deletion
alter table public.communities drop constraint communities_created_by_fkey;
alter table public.communities alter column created_by drop not null;
alter table public.communities add constraint communities_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

create or replace function public.handle_new_community() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.created_by is not null then
    insert into public.memberships (community_id, user_id, role, status)
    values (new.id, new.created_by, 'owner', 'active')
    on conflict do nothing;
  end if;
  return new;
end $$;

-- Append-only, except the FK action that detaches a deleted actor (actor_id: not null -> null, nothing else).
create or replace function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.actor_id is not null and new.actor_id is null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- S2/S3: posts and comments
create or replace function public.guard_post_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.author_id is distinct from old.author_id
       or new.is_anonymous is distinct from old.is_anonymous
       or new.community_id is distinct from old.community_id then
      raise exception 'post authorship and community are immutable' using errcode = '42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at
       and not (public.is_moderator() or public.is_community_mod(old.community_id)) then
      raise exception 'only moderators may restore removed content' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create function public.guard_comment_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.post_id is distinct from old.post_id
       or new.parent_id is distinct from old.parent_id
       or new.author_id is distinct from old.author_id then
      raise exception 'comment post, parent and author are immutable' using errcode = '42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at
       and not public.is_post_mod(old.post_id) then
      raise exception 'only moderators may restore removed content' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger comments_guard_update before update on public.comments
  for each row execute function public.guard_comment_update();

drop policy comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_comment_on_post(post_id)
              and (parent_id is null or public.comment_belongs_to_post(parent_id, post_id)));

-- ---------------------------------------------------------------- S4: events / resources
create or replace function public.guard_moderated_status() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_moderator() then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'new content must start as pending' using errcode = '42501';
    elsif tg_op = 'UPDATE' then
      if new.status is distinct from old.status then
        raise exception 'only moderators may change status' using errcode = '42501';
      elsif old.status = 'published'
            and (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
        -- edited content must be re-reviewed
        new.status := 'pending';
      end if;
    end if;
  end if;
  return new;
end $$;

create function public.guard_resource_owner() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and new.uploader_id is distinct from old.uploader_id then
    raise exception 'resources.uploader_id is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger resources_guard_owner before update on public.resources
  for each row execute function public.guard_resource_owner();

create function public.guard_event_owner() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and new.created_by is distinct from old.created_by then
    raise exception 'events.created_by is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger events_guard_owner before update on public.events
  for each row execute function public.guard_event_owner();

drop policy events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (created_by = (select auth.uid()) or public.is_moderator())
  with check ((created_by = (select auth.uid()) and (community_id is null or public.is_member(community_id)))
              or public.is_moderator());

-- ---------------------------------------------------------------- S5: documents
drop policy documents_owner_insert on public.documents;
create policy documents_owner_insert on public.documents for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'pending_upload' and page_count is null and error is null);

create or replace function public.guard_document_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.user_id is distinct from old.user_id
       or new.storage_path is distinct from old.storage_path
       or new.page_count is distinct from old.page_count
       or new.idempotency_key is distinct from old.idempotency_key
       or new.error is distinct from old.error then
      raise exception 'protected document columns are immutable' using errcode = '42501';
    end if;
    if old.status <> 'pending_upload'
       and (new.size_bytes is distinct from old.size_bytes or new.mime_type is distinct from old.mime_type) then
      raise exception 'document upload metadata is immutable after upload' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'pending_upload' and new.status = 'uploaded') then
      raise exception 'status is managed by the processing pipeline' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- S9: storage paths
alter table public.documents add constraint documents_storage_path_no_traversal
  check (storage_path !~ '(^|/)\.\.(/|$)');
alter table public.resources add constraint resources_storage_path_owner_folder
  check (storage_path is null or (storage_path like uploader_id::text || '/%' and storage_path !~ '(^|/)\.\.(/|$)'));

-- ---------------------------------------------------------------- S6: messages
drop policy messages_owner_insert on public.messages;
create policy messages_owner_insert on public.messages for insert to authenticated
  with check (exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = (select auth.uid()))
              and role = 'user' and model is null and input_tokens is null and output_tokens is null);
revoke update on public.messages from authenticated;
grant update (feedback) on public.messages to authenticated;

-- ---------------------------------------------------------------- S7: anonymous posts die with their author
create function public.delete_anonymous_posts_of_profile() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.posts p using public.post_private_authors a
    where a.post_id = p.id and a.author_id = old.id;
  return old;
end $$;
revoke all on function public.delete_anonymous_posts_of_profile() from public, anon, authenticated;
create trigger profiles_delete_anonymous_posts before delete on public.profiles
  for each row execute function public.delete_anonymous_posts_of_profile();

-- ---------------------------------------------------------------- S8: reports / takedowns
drop policy reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open' and handled_by is null
              and (post_id is null or public.can_view_post(post_id))
              and (comment_id is null or public.can_view_comment(comment_id))
              and (resource_id is null or public.can_view_resource(resource_id)));
create unique index reports_open_post_unique on public.reports(reporter_id, post_id)
  where status = 'open' and post_id is not null;
create unique index reports_open_comment_unique on public.reports(reporter_id, comment_id)
  where status = 'open' and comment_id is not null;
create unique index reports_open_resource_unique on public.reports(reporter_id, resource_id)
  where status = 'open' and resource_id is not null;
create unique index reports_open_user_unique on public.reports(reporter_id, reported_user_id)
  where status = 'open' and reported_user_id is not null;

drop policy takedown_insert on public.takedown_requests;
create policy takedown_insert on public.takedown_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'open' and resolved_by is null
              and public.can_view_resource(resource_id));
create unique index takedown_open_unique on public.takedown_requests(requester_id, resource_id) where status = 'open';

-- ---------------------------------------------------------------- nits
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.profiles add constraint profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~ '^https://');

-- Admins may not edit super_admin profiles (only a super_admin may).
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (public.is_admin() and (role <> 'super_admin' or public.is_super_admin())))
  with check (id = (select auth.uid()) or (public.is_admin() and (role <> 'super_admin' or public.is_super_admin())));
