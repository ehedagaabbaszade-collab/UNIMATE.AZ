-- Admin console hardening (security review). Postgres 15 syntax only. Adds on top of 20260101004600 / 004700; never edits them.
--  * moderation records who/when removed content; restore only reverts moderator removals and never bypasses a copyright hold,
--  * the reason-less AI config writers are owner-only (the reason wrappers keep working), prompt_versions and system_config
--    have no direct API write path any more, system_config values are validated server-side,
--  * AI routes need enabled models and providers, budgets get caps and a user <= plan <= global rule,
--  * academic updates audit the old row, courses with enrollments cannot be deleted, baseline versions for revert.

-- ---------------------------------------------------------------- moderation: who/when
alter table public.posts add column removed_by uuid references public.profiles(id) on delete set null, add column moderated_at timestamptz;
alter table public.comments add column removed_by uuid references public.profiles(id) on delete set null, add column moderated_at timestamptz;
alter table public.resources add column removed_by uuid references public.profiles(id) on delete set null, add column moderated_at timestamptz;
alter table public.events add column removed_by uuid references public.profiles(id) on delete set null, add column moderated_at timestamptz;

-- Old moderator removals are recognisable in the audit log (author self-deletes never wrote 'content.remove').
update public.posts p set removed_by = a.actor_id, moderated_at = a.created_at
  from (select distinct on (entity_id) entity_id, actor_id, created_at from public.audit_logs
        where action = 'content.remove' and entity_type = 'post' order by entity_id, id desc) a
  where a.entity_id = p.id::text and p.deleted_at is not null and p.moderated_at is null;
update public.comments p set removed_by = a.actor_id, moderated_at = a.created_at
  from (select distinct on (entity_id) entity_id, actor_id, created_at from public.audit_logs
        where action = 'content.remove' and entity_type = 'comment' order by entity_id, id desc) a
  where a.entity_id = p.id::text and p.deleted_at is not null and p.moderated_at is null;
update public.resources p set removed_by = a.actor_id, moderated_at = a.created_at
  from (select distinct on (entity_id) entity_id, actor_id, created_at from public.audit_logs
        where action = 'content.remove' and entity_type = 'resource' order by entity_id, id desc) a
  where a.entity_id = p.id::text and p.status = 'removed' and p.moderated_at is null;
update public.events p set removed_by = a.actor_id, moderated_at = a.created_at
  from (select distinct on (entity_id) entity_id, actor_id, created_at from public.audit_logs
        where action = 'content.remove' and entity_type = 'event' order by entity_id, id desc) a
  where a.entity_id = p.id::text and p.status = 'removed' and p.moderated_at is null;

-- API roles cannot forge or clear the moderation stamp, and cannot undo a moderator removal themselves (only the
-- SECURITY DEFINER moderation functions, which run as the owner, change it).
create function public.moderation_stamp_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.removed_by := null; new.moderated_at := null;
    else
      new.removed_by := old.removed_by; new.moderated_at := old.moderated_at;
      if old.moderated_at is not null then
        if tg_table_name in ('posts', 'comments') then
          if old.deleted_at is not null and new.deleted_at is null then new.deleted_at := old.deleted_at; end if;
        elsif old.status = 'removed' and new.status <> 'removed' then
          new.status := old.status;
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.moderation_stamp_guard() from public, anon, authenticated;
create trigger posts_moderation_stamp before insert or update on public.posts for each row execute function public.moderation_stamp_guard();
create trigger comments_moderation_stamp before insert or update on public.comments for each row execute function public.moderation_stamp_guard();
create trigger resources_moderation_stamp before insert or update on public.resources for each row execute function public.moderation_stamp_guard();
create trigger events_moderation_stamp before insert or update on public.events for each row execute function public.moderation_stamp_guard();

-- Remove stamps who/when. Restore only reverts moderator removals: content its author deleted stays deleted, and a
-- resource under (or removed by) a copyright takedown cannot be republished this way.
create or replace function public.admin_moderate_content(p_kind text, p_id uuid, p_action text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_removed boolean;
  v_mod boolean;
  v_hold boolean := false;
  v_changed boolean := false;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('post', 'comment', 'resource', 'event') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('remove', 'restore') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;

  if p_kind = 'post' then
    select deleted_at is not null, moderated_at is not null into v_removed, v_mod from public.posts where id = p_id for update;
  elsif p_kind = 'comment' then
    select deleted_at is not null, moderated_at is not null into v_removed, v_mod from public.comments where id = p_id for update;
  elsif p_kind = 'resource' then
    select status = 'removed', moderated_at is not null, takedown_hold into v_removed, v_mod, v_hold from public.resources where id = p_id for update;
  else
    select status = 'removed', moderated_at is not null into v_removed, v_mod from public.events where id = p_id for update;
  end if;
  if not found then
    raise exception 'content not found' using errcode = 'P0002';
  end if;

  if p_action = 'restore' and v_removed then
    if not v_mod then
      raise exception 'content was not removed by moderation (author deletion or takedown) and cannot be restored here' using errcode = '55000';
    end if;
    if p_kind = 'resource' and (v_hold or exists (select 1 from public.takedown_requests t
         where t.resource_id = p_id and t.status in ('open', 'accepted'))) then
      raise exception 'resource is under a copyright takedown: resolve the takedown request' using errcode = '55000';
    end if;
  end if;

  if p_action = 'remove' and not v_removed then
    if p_kind = 'post' then
      update public.posts set deleted_at = now(), removed_by = auth.uid(), moderated_at = now() where id = p_id;
    elsif p_kind = 'comment' then
      update public.comments set deleted_at = now(), removed_by = auth.uid(), moderated_at = now() where id = p_id;
    elsif p_kind = 'resource' then
      update public.resources set status = 'removed', removed_by = auth.uid(), moderated_at = now() where id = p_id;
    else
      update public.events set status = 'removed', removed_by = auth.uid(), moderated_at = now() where id = p_id;
    end if;
    v_changed := true;
  elsif p_action = 'restore' and v_removed then
    if p_kind = 'post' then
      update public.posts set deleted_at = null, removed_by = null, moderated_at = null where id = p_id;
    elsif p_kind = 'comment' then
      update public.comments set deleted_at = null, removed_by = null, moderated_at = null where id = p_id;
    elsif p_kind = 'resource' then
      update public.resources set status = 'published', removed_by = null, moderated_at = null where id = p_id;
    else
      update public.events set status = 'published', removed_by = null, moderated_at = null where id = p_id;
    end if;
    v_changed := true;
  end if;

  if v_changed then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'content.' || p_action, p_kind, p_id::text, jsonb_build_object('reason', btrim(p_reason)));
  end if;
  return v_changed;
end $$;


-- Staff accounts cannot be suspended, but restoring one (e.g. after a role change) must stay possible.
create or replace function public.admin_set_user_suspended(p_user_id uuid, p_suspended boolean, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.app_role;
  v_changed boolean;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_suspended is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot suspend yourself' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if p_suspended and v_role <> 'student' then
    raise exception 'staff accounts cannot be suspended: change the role first' using errcode = '42501';
  end if;
  if p_suspended then
    insert into public.account_suspensions (user_id, reason, suspended_by) values (p_user_id, btrim(p_reason), auth.uid())
      on conflict (user_id) do nothing;
  else
    delete from public.account_suspensions where user_id = p_user_id;
  end if;
  v_changed := found;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'banned_until') then
    execute 'update auth.users set banned_until = $1 where id = $2'
      using (case when p_suspended then now() + interval '100 years' else null end), p_user_id;
  end if;
  if v_changed then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), case when p_suspended then 'user.suspend' else 'user.restore' end, 'user', p_user_id::text,
            jsonb_build_object('reason', btrim(p_reason)));
  end if;
  return v_changed;
end $$;

create or replace function public.admin_upsert_university(p_id uuid, p_name text, p_short_name text, p_city text, p_type text, p_ownership text,
  p_affiliated_with text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_type is null or p_type not in ('university', 'college') or p_ownership is null or p_ownership not in ('state', 'private') then
    raise exception 'invalid type or ownership' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.universities (name, short_name, city, institution_type, ownership, affiliated_with, source)
    values (btrim(p_name), nullif(btrim(p_short_name), ''), nullif(btrim(p_city), ''), p_type, p_ownership, nullif(btrim(p_affiliated_with), ''), 'admin_verified')
    returning id into v_id;
  else
    select to_jsonb(x) into v_old from public.universities x where x.id = p_id;
    update public.universities set name = btrim(p_name), short_name = nullif(btrim(p_short_name), ''), city = nullif(btrim(p_city), ''),
      institution_type = p_type, ownership = p_ownership, affiliated_with = nullif(btrim(p_affiliated_with), ''), updated_at = now()
      where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'institution not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.university.create' else 'academic.university.update' end, 'university', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'reason', btrim(p_reason), 'old', v_old));
  return v_id;
end $$;

create or replace function public.admin_upsert_faculty(p_id uuid, p_university_id uuid, p_name text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_id is null then
    insert into public.faculties (university_id, name) values (p_university_id, btrim(p_name)) returning id into v_id;
  else
    select to_jsonb(x) into v_old from public.faculties x where x.id = p_id;
    update public.faculties set university_id = p_university_id, name = btrim(p_name), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'faculty not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.faculty.create' else 'academic.faculty.update' end, 'faculty', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'reason', btrim(p_reason), 'old', v_old));
  return v_id;
end $$;

create or replace function public.admin_upsert_major(p_id uuid, p_faculty_id uuid, p_name text, p_degree_level text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_id is null then
    insert into public.majors (faculty_id, name, degree_level) values (p_faculty_id, btrim(p_name), coalesce(p_degree_level, 'bachelor')) returning id into v_id;
  else
    select to_jsonb(x) into v_old from public.majors x where x.id = p_id;
    update public.majors set faculty_id = p_faculty_id, name = btrim(p_name), degree_level = coalesce(p_degree_level, 'bachelor'), updated_at = now()
      where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'major not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.major.create' else 'academic.major.update' end, 'major', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'reason', btrim(p_reason), 'old', v_old));
  return v_id;
end $$;

create or replace function public.admin_upsert_course(p_id uuid, p_university_id uuid, p_major_id uuid, p_code text, p_title text, p_credits numeric,
  p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_id is null then
    insert into public.courses (university_id, major_id, code, title, credits) values (p_university_id, p_major_id, btrim(p_code), btrim(p_title), p_credits)
      returning id into v_id;
  else
    select to_jsonb(x) into v_old from public.courses x where x.id = p_id;
    update public.courses set university_id = p_university_id, major_id = p_major_id, code = btrim(p_code), title = btrim(p_title),
      credits = p_credits, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'course not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.course.create' else 'academic.course.update' end, 'course', v_id::text,
          jsonb_build_object('code', btrim(p_code), 'reason', btrim(p_reason), 'old', v_old));
  return v_id;
end $$;

create or replace function public.admin_delete_academic(p_kind text, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_kind is null or p_kind not in ('university', 'faculty', 'major', 'course') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_kind = 'university' then
    select name into v_name from public.universities where id = p_id for update;
    if found and (exists (select 1 from public.profiles where university_id = p_id) or exists (select 1 from public.faculties where university_id = p_id)
                  or exists (select 1 from public.courses where university_id = p_id)) then
      raise exception 'institution is in use (students, faculties or courses reference it)' using errcode = '55000';
    end if;
    delete from public.universities where id = p_id;
  elsif p_kind = 'faculty' then
    select name into v_name from public.faculties where id = p_id for update;
    if found and exists (select 1 from public.majors where faculty_id = p_id) then
      raise exception 'faculty still has majors' using errcode = '55000';
    end if;
    delete from public.faculties where id = p_id;
  elsif p_kind = 'major' then
    select name into v_name from public.majors where id = p_id for update;
    if found and (exists (select 1 from public.profiles where major_id = p_id) or exists (select 1 from public.courses where major_id = p_id)) then
      raise exception 'major is in use (students or courses reference it)' using errcode = '55000';
    end if;
    delete from public.majors where id = p_id;
  else
    select title into v_name from public.courses where id = p_id for update;
    if found and exists (select 1 from public.enrollments where course_id = p_id) then
      raise exception 'course has enrollments' using errcode = '55000';
    end if;
    delete from public.courses where id = p_id;
  end if;
  if not found then
    return false;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'academic.' || p_kind || '.delete', p_kind, p_id::text, jsonb_build_object('name', v_name, 'reason', btrim(p_reason)));
  return true;
end $$;

create or replace function public.mod_remove_content(p_kind text, p_id uuid, p_reason text) returns boolean
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
    update public.posts set deleted_at = public.now_utc(), removed_by = auth.uid(), moderated_at = now() where id = p_id and deleted_at is null;
  else
    update public.comments set deleted_at = public.now_utc(), removed_by = auth.uid(), moderated_at = now() where id = p_id and deleted_at is null;
    update public.posts set accepted_comment_id = null where accepted_comment_id = p_id;
  end if;
  if found then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'content.remove', p_kind, p_id::text, jsonb_build_object('reason', btrim(p_reason), 'community_id', v_community));
  end if;
  return found;
end $$;


-- ---------------------------------------------------------------- AI config: owner-only legacy writers
-- The reason-less writers stay as the implementation behind the reason wrappers (SECURITY DEFINER wrappers run as the owner,
-- who keeps EXECUTE) but API roles can no longer call them.
revoke execute on function
  public.admin_set_ai_provider(text, text, boolean, text),
  public.admin_set_ai_model(uuid, text, text, bigint, bigint, bigint, integer, boolean, boolean),
  public.admin_set_ai_route(public.ai_task, public.sub_plan, uuid, uuid[], integer),
  public.admin_delete_ai_route(public.ai_task, public.sub_plan),
  public.admin_set_ai_budget(text, text, text, bigint), public.admin_delete_ai_budget(text, text, text)
  from public, anon, authenticated;

-- Routes must use enabled models of enabled providers. Disabling a model/provider that a live route uses is blocked
-- (every write and revert re-validates in ai_cfg_commit) with an error that lists the routes.
create or replace function public.ai_validate_routes() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  pm public.ai_models;
  fm public.ai_models;
  fid uuid;
  v_bad text;
begin
  select string_agg(x.route, ', ' order by x.route) into v_bad from (
    select r2.task::text || '/' || r2.plan::text as route from public.ai_task_routes r2
    where exists (select 1 from public.ai_models m join public.ai_providers p on p.id = m.provider_id
                  where (m.id = r2.primary_model_id or m.id = any (r2.fallback_model_ids)) and (not m.enabled or not p.enabled))) x;
  if v_bad is not null then
    raise exception 'a disabled model or provider is still used by live routes: %', v_bad using errcode = '55000';
  end if;
  for r in select * from public.ai_task_routes loop
    select * into pm from public.ai_models where id = r.primary_model_id;
    if not found then
      raise exception 'route %/%: primary model not found', r.task, r.plan using errcode = '22023';
    end if;
    if (select count(distinct x) from unnest(r.fallback_model_ids) x) <> coalesce(cardinality(r.fallback_model_ids), 0) then
      raise exception 'route %/%: duplicate fallback', r.task, r.plan using errcode = '22023';
    end if;
    foreach fid in array r.fallback_model_ids loop
      select * into fm from public.ai_models where id = fid;
      if not found then
        raise exception 'route %/%: fallback model not found', r.task, r.plan using errcode = '22023';
      end if;
      if fid = r.primary_model_id then
        raise exception 'route %/%: fallback equals primary', r.task, r.plan using errcode = '22023';
      end if;
      if not fm.approved_fallback then
        raise exception 'route %/%: fallback % is not approved', r.task, r.plan, fm.model using errcode = '22023';
      end if;
      if fm.input_micro_usd_per_mtok > pm.input_micro_usd_per_mtok
         or fm.output_micro_usd_per_mtok > pm.output_micro_usd_per_mtok
         or fm.cached_input_micro_usd_per_mtok > pm.cached_input_micro_usd_per_mtok
         or public.ai_tier_rank(fm.tier) > public.ai_tier_rank(pm.tier) then
        raise exception 'route %/%: fallback % costs more than the primary', r.task, r.plan, fm.model using errcode = '22023';
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.ai_validate_routes() from public, anon, authenticated, service_role;

-- Budgets: absolute cap (1,000,000 USD = 1e12 micro-USD) and, per period, user default <= every plan <= global.
create function public.ai_validate_budgets() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  b record;
  v_global bigint;
begin
  if exists (select 1 from public.ai_budgets where hard_limit_micro_usd > 1000000000000) then
    raise exception 'budget limit exceeds the sanity cap of 1,000,000 USD' using errcode = '22023';
  end if;
  for b in select * from public.ai_budgets where scope <> 'global' loop
    select hard_limit_micro_usd into v_global from public.ai_budgets where scope = 'global' and key = '*' and period = b.period;
    if v_global is not null and b.hard_limit_micro_usd > v_global then
      raise exception '% budget % (%) exceeds the global % ceiling', b.scope, b.key, b.hard_limit_micro_usd, b.period using errcode = '22023';
    end if;
    if b.scope = 'user' and b.key = '*' and exists (select 1 from public.ai_budgets p
         where p.scope = 'plan' and p.period = b.period and p.hard_limit_micro_usd < b.hard_limit_micro_usd) then
      raise exception 'the default user budget (%) exceeds a plan budget for the same % period', b.hard_limit_micro_usd, b.period using errcode = '22023';
    end if;
  end loop;
end $$;
revoke all on function public.ai_validate_budgets() from public, anon, authenticated, service_role;

create or replace function public.ai_cfg_commit(p_action text, p_entity_type text, p_entity_id text, p_old jsonb, p_new jsonb, p_extra jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version bigint;
  v_reason text := left(coalesce(nullif(current_setting('unimate.cfg_reason', true), ''), nullif(p_extra ->> 'reason', '')), 500);
begin
  perform public.ai_validate_routes();
  perform public.ai_validate_budgets();
  insert into public.config_versions (snapshot, action, actor_id, reason)
  values (public.ai_config_snapshot(), p_action, auth.uid(), v_reason) returning version into v_version;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id,
          jsonb_build_object('old', p_old, 'new', p_new, 'version', v_version)
          || case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end
          || coalesce(p_extra, '{}'::jsonb));
  return v_version;
end $$;
revoke all on function public.ai_cfg_commit(text, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- prompt_versions: audited RPCs only
drop policy prompt_versions_admin_insert on public.prompt_versions;
drop policy prompt_versions_admin_update on public.prompt_versions;
drop policy prompt_versions_admin_delete on public.prompt_versions;
revoke insert, update, delete, truncate, references, trigger on public.prompt_versions from anon, authenticated;

-- Versions are created by admin_create_prompt_version (new row, never an in-place edit); activation needs a reason.
drop function public.admin_activate_prompt_version(uuid);
create function public.admin_activate_prompt_version(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  select name into v_name from public.prompt_versions where id = p_id;
  if not found then
    raise exception 'prompt version not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prompt:' || v_name, 0));
  update public.prompt_versions set is_active = false where name = v_name and is_active and id <> p_id;
  update public.prompt_versions set is_active = true where id = p_id and not is_active;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'prompt.activate', 'prompt_version', p_id::text, jsonb_build_object('name', v_name, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.admin_activate_prompt_version(uuid, text) from public, anon;
grant execute on function public.admin_activate_prompt_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------- system_config: RPC writes only
drop policy system_config_admin_insert on public.system_config;
drop policy system_config_admin_update on public.system_config;
drop policy system_config_admin_delete on public.system_config;
revoke insert, update, delete, truncate, references, trigger on public.system_config from anon, authenticated;

-- Mirrors apps/admin/src/lib/config-keys.ts. Unknown keys are refused when written by hand.
create function public.system_config_validate(p_key text, p_value jsonb) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_ok boolean := false;
  v_num numeric;
begin
  if p_key = 'maintenance.mode' then
    v_ok := jsonb_typeof(p_value) = 'object'
      and not exists (select 1 from jsonb_object_keys(p_value) k where k not in ('enabled', 'message_key'))
      and jsonb_typeof(p_value -> 'enabled') = 'boolean'
      and (not (p_value ? 'message_key') or (jsonb_typeof(p_value -> 'message_key') = 'string' and length(btrim(p_value ->> 'message_key')) <= 80));
  elsif p_key = 'signup.enabled' then
    v_ok := jsonb_typeof(p_value) = 'boolean';
  elsif p_key = 'uploads.max_file_mb' then
    if jsonb_typeof(p_value) = 'number' then
      v_num := (p_value #>> '{}')::numeric;
      v_ok := v_num = trunc(v_num) and v_num between 1 and 200;
    end if;
  elsif p_key = 'support.contact_url' then
    v_ok := jsonb_typeof(p_value) = 'string' and public.career_https_url(p_value #>> '{}');
  else
    raise exception 'unknown config key %', p_key using errcode = '22023';
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'invalid value for config key %', p_key using errcode = '22023';
  end if;
end $$;
revoke all on function public.system_config_validate(text, jsonb) from public, anon, authenticated;

create or replace function public.admin_set_system_config(p_key text, p_value jsonb, p_reason text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ver bigint;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_key is null or p_key !~ '^[a-z0-9_.-]{1,100}$' or p_value is null or jsonb_typeof(p_value) = 'null' or pg_column_size(p_value) > 20000 then
    raise exception 'valid key and a non-null value (<= 20 KB) are required' using errcode = '22023';
  end if;
  perform public.system_config_validate(p_key, p_value);
  perform pg_advisory_xact_lock(hashtextextended('sysconfig:' || p_key, 0));
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  insert into public.system_config (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform set_config('unimate.cfg_reason', '', true);
  select max(id) into v_ver from public.system_config_versions where key = p_key;
  return v_ver;
end $$;

-- Known keys are re-validated on revert; unknown (pre-console) keys can still be restored to what they were.
create or replace function public.admin_revert_system_config(p_version_id bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.system_config_versions;
  v_ver bigint;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  select * into v from public.system_config_versions where id = p_version_id;
  if not found then
    raise exception 'config version not found' using errcode = 'P0002';
  end if;
  if v.value is not null and v.key in ('maintenance.mode', 'signup.enabled', 'uploads.max_file_mb', 'support.contact_url') then
    perform public.system_config_validate(v.key, v.value);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sysconfig:' || v.key, 0));
  perform set_config('unimate.cfg_reason', left('revert to v' || p_version_id || ': ' || btrim(p_reason), 500), true);
  if v.value is null then
    delete from public.system_config where key = v.key;
  else
    insert into public.system_config (key, value, updated_by) values (v.key, v.value, auth.uid())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  end if;
  perform set_config('unimate.cfg_reason', '', true);
  select max(id) into v_ver from public.system_config_versions where key = v.key;
  return v_ver;
end $$;

create or replace function public.admin_revert_notification_template(p_version_id bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.notification_template_versions;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  select * into v from public.notification_template_versions where id = p_version_id;
  if not found then
    raise exception 'template version not found' using errcode = 'P0002';
  end if;
  return public.admin_set_notification_template(v.key, v.locale, v.title, v.body, left('revert to v' || p_version_id || ': ' || btrim(p_reason), 500));
end $$;

-- ---------------------------------------------------------------- baselines so pre-console values can be reverted to (idempotent)
insert into public.system_config_versions (key, value, action, reason, actor_id)
select c.key, c.value, 'insert', 'baseline before versioning', c.updated_by from public.system_config c
where not exists (select 1 from public.system_config_versions v where v.key = c.key);

insert into public.notification_template_versions (key, locale, title, body, actor_id, reason)
select t.key, t.locale, t.title, t.body, t.updated_by, 'baseline before versioning' from public.notification_templates t
where not exists (select 1 from public.notification_template_versions v where v.key = t.key and v.locale = t.locale);

insert into public.config_versions (snapshot, action, reason)
select public.ai_config_snapshot(), 'ai_config.baseline', 'baseline before versioning'
where not exists (select 1 from public.config_versions)
  and (exists (select 1 from public.ai_providers) or exists (select 1 from public.ai_models)
       or exists (select 1 from public.ai_task_routes) or exists (select 1 from public.ai_budgets));
