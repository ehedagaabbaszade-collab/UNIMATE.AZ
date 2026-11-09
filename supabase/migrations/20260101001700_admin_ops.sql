-- Admin operations. Postgres 15 syntax only.
-- All RPCs are SECURITY DEFINER, so the guard triggers (which only restrict anon/authenticated current_user) do not
-- apply inside them: every function authorizes the caller itself (auth.uid() -> profiles.role) and validates inputs.
-- Roles: moderator = moderation RPCs only. admin = + plans, config, prompts, analytics. super_admin = + roles.
-- Analytics are admin-only (aggregates, no raw student content). prompt_versions CRUD policies (admin only) already
-- exist in 20260101001000_rls.sql; activation goes through admin_activate_prompt_version.

-- ---------------------------------------------------------------- system_config
create table public.system_config (
  key text primary key check (key ~ '^[a-z0-9_.-]{1,100}$'),
  value jsonb not null,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.system_config enable row level security;
revoke all on public.system_config from anon;
revoke truncate, references, trigger on public.system_config from authenticated;
create policy system_config_admin_select on public.system_config for select to authenticated using (public.is_admin());
create policy system_config_admin_insert on public.system_config for insert to authenticated with check (public.is_admin());
create policy system_config_admin_update on public.system_config for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy system_config_admin_delete on public.system_config for delete to authenticated using (public.is_admin());
create policy system_config_service_all on public.system_config for all to service_role using (true) with check (true);

create function public.system_config_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  if current_user in ('anon', 'authenticated') then
    new.updated_by = auth.uid();
  end if;
  return new;
end $$;
create trigger system_config_stamp before insert or update on public.system_config
  for each row execute function public.system_config_stamp();

-- Audit trail of config changes (key only, never the value: it may be sensitive).
create function public.system_config_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := case when tg_op = 'DELETE' then old.key else new.key end;
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'config.' || lower(tg_op), 'system_config', v_key, '{}'::jsonb);
  return null;
end $$;
revoke all on function public.system_config_audit() from public, anon, authenticated;
create trigger system_config_audit after insert or update or delete on public.system_config
  for each row execute function public.system_config_audit();

-- ---------------------------------------------------------------- manual plan grants
alter table public.subscriptions add column source text not null default 'paid' check (source in ('paid', 'manual'));
alter table public.subscriptions add column granted_by uuid references public.profiles(id) on delete set null;
alter table public.subscriptions add column grant_reason text check (grant_reason is null or length(grant_reason) <= 500);
alter table public.subscriptions add constraint subscriptions_manual_has_reason
  check ((source = 'manual') = (grant_reason is not null));

create function public.admin_grant_plan(p_user_id uuid, p_plan public.sub_plan, p_until timestamptz, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_plan is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'plan and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  if p_until is not null and p_until <= now() then
    raise exception 'until must be in the future' using errcode = '22023';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sub:' || p_user_id::text, 0));
  if exists (select 1 from public.subscriptions
             where user_id = p_user_id and source = 'paid' and status in ('active', 'trialing', 'past_due')) then
    raise exception 'user has a live paid subscription' using errcode = '55000';
  end if;
  update public.subscriptions set status = 'canceled', cancel_at_period_end = false
    where user_id = p_user_id and source = 'manual' and status in ('active', 'trialing', 'past_due');
  if p_plan <> 'free' then
    insert into public.subscriptions (user_id, plan, status, provider, current_period_start, current_period_end,
                                      source, granted_by, grant_reason)
    values (p_user_id, p_plan, 'active', 'manual', now(), p_until, 'manual', v_actor, btrim(p_reason))
    returning id into v_id;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'plan.grant', 'user', p_user_id::text,
          jsonb_build_object('plan', p_plan, 'until', p_until, 'reason', btrim(p_reason), 'source', 'manual'));
  return v_id;
end $$;

-- ---------------------------------------------------------------- roles
create function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_old public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'super_admin privileges required' using errcode = '42501';
  end if;
  if p_role is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'role and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  if p_user_id = v_actor then
    raise exception 'cannot change your own role' using errcode = '42501';
  end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_old = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.profiles where role = 'super_admin') <= 1 then
    raise exception 'cannot demote the last super_admin' using errcode = '42501';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'role.set', 'user', p_user_id::text,
          jsonb_build_object('from', v_old, 'to', p_role, 'reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------- moderation
-- Soft delete / restore. Returns true when something changed (audited only then).
-- posts/comments: deleted_at. resources/events: status 'removed'; restore -> 'published' (moderator decision).
create function public.admin_moderate_content(p_kind text, p_id uuid, p_action text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_changed boolean := false;
  v_exists boolean;
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
    select exists (select 1 from public.posts where id = p_id) into v_exists;
    if p_action = 'remove' then
      update public.posts set deleted_at = now() where id = p_id and deleted_at is null;
    else
      update public.posts set deleted_at = null where id = p_id and deleted_at is not null;
    end if;
  elsif p_kind = 'comment' then
    select exists (select 1 from public.comments where id = p_id) into v_exists;
    if p_action = 'remove' then
      update public.comments set deleted_at = now() where id = p_id and deleted_at is null;
    else
      update public.comments set deleted_at = null where id = p_id and deleted_at is not null;
    end if;
  elsif p_kind = 'resource' then
    select exists (select 1 from public.resources where id = p_id) into v_exists;
    if p_action = 'remove' then
      update public.resources set status = 'removed' where id = p_id and status <> 'removed';
    else
      update public.resources set status = 'published' where id = p_id and status = 'removed';
    end if;
  else
    select exists (select 1 from public.events where id = p_id) into v_exists;
    if p_action = 'remove' then
      update public.events set status = 'removed' where id = p_id and status <> 'removed';
    else
      update public.events set status = 'published' where id = p_id and status = 'removed';
    end if;
  end if;
  v_changed := found;
  if not v_exists then
    raise exception 'content not found' using errcode = 'P0002';
  end if;
  if v_changed then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'content.' || p_action, p_kind, p_id::text, jsonb_build_object('reason', btrim(p_reason)));
  end if;
  return v_changed;
end $$;

create function public.admin_resolve_report(p_report_id uuid, p_status public.report_status, p_note text default null)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.report_status;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_status is null or p_status = 'open' then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'note too long' using errcode = '22023';
  end if;
  select status into v_old from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if v_old in ('actioned', 'dismissed') then
    raise exception 'report already resolved' using errcode = '55000';
  end if;
  update public.reports set status = p_status, handled_by = auth.uid() where id = p_report_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'report.' || p_status, 'report', p_report_id::text,
          jsonb_build_object('from', v_old, 'note', p_note));
end $$;

create function public.admin_resolve_takedown(p_id uuid, p_decision public.takedown_status, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.takedown_status;
  v_resource uuid;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision = 'open' then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  select status, resource_id into v_old, v_resource from public.takedown_requests where id = p_id for update;
  if not found then
    raise exception 'takedown not found' using errcode = 'P0002';
  end if;
  if v_old <> 'open' then
    raise exception 'takedown already resolved' using errcode = '55000';
  end if;
  update public.takedown_requests set status = p_decision, resolved_by = auth.uid(), resolved_at = now() where id = p_id;
  if p_decision = 'accepted' then
    update public.resources set status = 'removed' where id = v_resource and status <> 'removed';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'takedown.' || p_decision, 'takedown', p_id::text,
          jsonb_build_object('resource_id', v_resource, 'reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------- prompt versions
create function public.admin_activate_prompt_version(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  select name into v_name from public.prompt_versions where id = p_id;
  if not found then
    raise exception 'prompt version not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prompt:' || v_name, 0));
  update public.prompt_versions set is_active = false where name = v_name and is_active and id <> p_id;
  update public.prompt_versions set is_active = true where id = p_id and not is_active;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'prompt.activate', 'prompt_version', p_id::text, jsonb_build_object('name', v_name));
end $$;

-- ---------------------------------------------------------------- analytics (aggregates only, admin only)
-- Days are Asia/Baku calendar days. DAU/WAU count distinct users with an xp_event or study_session that day
-- (WAU: trailing 7 days including the day).
create function public.admin_active_users(p_days integer default 30)
returns table (day date, dau integer, wau integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Baku')::date;
  v_from timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'days must be between 1 and 366' using errcode = '22023';
  end if;
  v_from := ((v_today - (p_days + 6))::timestamp at time zone 'Asia/Baku');
  return query
  with activity as (
    select (x.created_at at time zone 'Asia/Baku')::date as d, x.user_id as uid
      from public.xp_events x where x.created_at >= v_from
    union
    select (s.started_at at time zone 'Asia/Baku')::date, s.user_id
      from public.study_sessions s where s.started_at >= v_from
  ), days as (
    select (v_today - n)::date as d from generate_series(0, p_days - 1) n
  )
  select days.d,
         (select count(*)::integer from activity a where a.d = days.d),
         (select count(distinct a.uid)::integer from activity a where a.d between days.d - 6 and days.d)
  from days order by days.d;
end $$;

create function public.admin_documents_by_status() returns table (status public.doc_status, n integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  return query select d.status, count(*)::integer from public.documents d group by d.status order by d.status;
end $$;

create function public.admin_jobs_by_state() returns table (kind text, state public.job_state, n integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  return query select j.kind, j.state, count(*)::integer from public.processing_jobs j
    group by j.kind, j.state order by j.kind, j.state;
end $$;

create function public.admin_ai_cost_by_day(p_days integer default 30)
returns table (day date, model text, requests integer, input_tokens bigint, output_tokens bigint, cost_micro_usd bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Baku')::date;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'days must be between 1 and 366' using errcode = '22023';
  end if;
  return query
  select (u.created_at at time zone 'Asia/Baku')::date, coalesce(u.model, 'unknown'), count(*)::integer,
         sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint, sum(u.cost_micro_usd)::bigint
  from public.ai_usage u
  where u.created_at >= ((v_today - (p_days - 1))::timestamp at time zone 'Asia/Baku')
  group by 1, 2 order by 1, 2;
end $$;

create function public.admin_subscriptions_by_plan() returns table (plan public.sub_plan, source text, n integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  return query select s.plan, s.source, count(*)::integer from public.subscriptions s
    where s.status in ('active', 'trialing', 'past_due') group by s.plan, s.source order by s.plan, s.source;
end $$;

-- ---------------------------------------------------------------- grants: authenticated only (service_role has no JWT user)
revoke all on function
  public.admin_grant_plan(uuid, public.sub_plan, timestamptz, text), public.admin_set_role(uuid, public.app_role, text),
  public.admin_moderate_content(text, uuid, text, text), public.admin_resolve_report(uuid, public.report_status, text),
  public.admin_resolve_takedown(uuid, public.takedown_status, text), public.admin_activate_prompt_version(uuid),
  public.admin_active_users(integer), public.admin_documents_by_status(), public.admin_jobs_by_state(),
  public.admin_ai_cost_by_day(integer), public.admin_subscriptions_by_plan()
  from public, anon;
grant execute on function
  public.admin_grant_plan(uuid, public.sub_plan, timestamptz, text), public.admin_set_role(uuid, public.app_role, text),
  public.admin_moderate_content(text, uuid, text, text), public.admin_resolve_report(uuid, public.report_status, text),
  public.admin_resolve_takedown(uuid, public.takedown_status, text), public.admin_activate_prompt_version(uuid),
  public.admin_active_users(integer), public.admin_documents_by_status(), public.admin_jobs_by_state(),
  public.admin_ai_cost_by_day(integer), public.admin_subscriptions_by_plan()
  to authenticated;
