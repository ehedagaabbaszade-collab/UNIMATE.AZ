-- Admin console support (apps/admin part 1). Postgres 15 syntax only.
-- Every function is SECURITY DEFINER and authorizes the caller itself (auth.uid() -> profiles.role); the admin UI only
-- ever uses the signed-in user's JWT. Lists return aggregates / minimal public fields: never document contents, chat
-- messages, quiz answers, e-mail addresses or anonymous-author identities. Destructive actions need a 3-500 char reason
-- and write audit_logs. No RLS policy is changed.

-- ---------------------------------------------------------------- suspensions
-- A separate table (not a profiles column) so a user can never clear their own suspension through profiles_update.
create table public.account_suspensions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  suspended_by uuid references public.profiles(id) on delete set null,
  suspended_at timestamptz not null default now()
);
alter table public.account_suspensions enable row level security;
revoke all on public.account_suspensions from anon, authenticated;
grant select on public.account_suspensions to authenticated;
create policy account_suspensions_admin_select on public.account_suspensions for select to authenticated using (public.is_admin());
create policy account_suspensions_service_all on public.account_suspensions for all to service_role using (true) with check (true);

-- Marks the account suspended or restored. On hosted Supabase it also sets auth.users.banned_until (when that column
-- exists) so no new sign-in or token refresh succeeds; access tokens already issued stay valid until they expire.
-- Staff accounts cannot be suspended (change the role first). Returns true when something changed.
create function public.admin_set_user_suspended(p_user_id uuid, p_suspended boolean, p_reason text) returns boolean
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
  if v_role <> 'student' then
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

-- ---------------------------------------------------------------- users (admin only; no e-mail, no content)
create function public.admin_list_users(p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, display_name text, username text, role public.app_role, university_name text, plan text,
               created_at timestamptz, suspended boolean, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_pat text;
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if v_term is not null and length(v_term) > 100 then
    raise exception 'search too long' using errcode = '22023';
  end if;
  v_pat := case when v_term is null then null
                else '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  return query
  select p.id, p.display_name, p.username, p.role, u.name, public.effective_plan(p.id), p.created_at,
         exists (select 1 from public.account_suspensions s where s.user_id = p.id),
         count(*) over ()
  from public.profiles p
  left join public.universities u on u.id = p.university_id
  where v_term is null or p.id::text = lower(v_term) or p.display_name ilike v_pat or p.username ilike v_pat
  order by p.created_at desc, p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.admin_user_subscriptions(p_user_id uuid)
returns table (id uuid, plan public.sub_plan, status public.sub_status, source text, provider text,
               current_period_end timestamptz, grant_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  return query select s.id, s.plan, s.status, s.source, s.provider, s.current_period_end, s.grant_reason, s.created_at
    from public.subscriptions s where s.user_id = p_user_id order by s.created_at desc limit 50;
end $$;

-- Live subscriptions ending within p_days (or already past their end but not yet swept), soonest first.
create function public.admin_expiring_subscriptions(p_days integer default 14, p_limit integer default 50, p_offset integer default 0)
returns table (subscription_id uuid, user_id uuid, display_name text, plan public.sub_plan, status public.sub_status, source text,
               current_period_end timestamptz, overdue boolean, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'days must be between 1 and 366' using errcode = '22023';
  end if;
  return query
  select s.id, s.user_id, p.display_name, s.plan, s.status, s.source, s.current_period_end,
         s.current_period_end <= public.now_utc(), count(*) over ()
  from public.subscriptions s join public.profiles p on p.id = s.user_id
  where s.status in ('active', 'trialing', 'past_due') and s.current_period_end is not null
    and s.current_period_end <= public.now_utc() + make_interval(days => p_days)
  order by s.current_period_end, s.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Manual trigger for the idempotent sweeper (the scheduled job is service-role only). Admin only; audited.
create function public.admin_run_subscription_expiry() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  v_n := public.expire_subscriptions(1000);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'subscription.sweep.manual', 'subscription', null, jsonb_build_object('expired', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------- dashboard counters (aggregates only)
-- Moderators get the moderation counters; the platform counters are absent for them.
create function public.admin_overview_counters() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_admin boolean := public.is_admin();
  v jsonb;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  v := jsonb_build_object(
    'open_reports', (select count(*) from public.reports where status in ('open', 'reviewing')),
    'open_takedowns', (select count(*) from public.takedown_requests where status = 'open'),
    'pending_resources', (select count(*) from public.resources where status = 'pending'),
    'pending_events', (select count(*) from public.events where status = 'pending'));
  if v_admin then
    v := v || jsonb_build_object(
      'users_total', (select count(*) from public.profiles),
      'users_suspended', (select count(*) from public.account_suspensions),
      'expiring_subscriptions_7d', (select count(*) from public.subscriptions
         where status in ('active', 'trialing', 'past_due') and current_period_end is not null
           and current_period_end <= public.now_utc() + interval '7 days' and current_period_end > public.now_utc()),
      'overdue_subscriptions', (select count(*) from public.subscriptions
         where status in ('active', 'trialing', 'past_due') and current_period_end is not null
           and current_period_end <= public.now_utc()),
      'unverified_institutions', (select count(*) from public.universities where source = 'user_supplied_unverified'));
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- moderation lists (moderator+; no author identities)
create function public.admin_reports_queue(p_status text default 'open', p_limit integer default 25, p_offset integer default 0)
returns table (report_id uuid, target_kind text, target_id uuid, category text, reason text, status text,
               created_at timestamptz, excerpt text, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('open', 'reviewing', 'actioned', 'dismissed') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  return query
  select r.id,
    case when r.post_id is not null then 'post' when r.comment_id is not null then 'comment'
         when r.resource_id is not null then 'resource' when r.reported_user_id is not null then 'user' else 'community' end,
    coalesce(r.post_id, r.comment_id, r.resource_id, r.reported_user_id, r.community_id),
    r.category, r.reason, r.status::text, r.created_at,
    left(coalesce(p.title || ': ' || p.body, c.body, res.title, pu.display_name, com.name, ''), 300),
    count(*) over ()
  from public.reports r
  left join public.posts p on p.id = r.post_id
  left join public.comments c on c.id = r.comment_id
  left join public.resources res on res.id = r.resource_id
  left join public.profiles pu on pu.id = r.reported_user_id
  left join public.communities com on com.id = r.community_id
  where r.status::text = p_status
  order by r.created_at, r.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create function public.admin_removed_content(p_kind text, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, title text, updated_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('resource', 'event') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_kind = 'resource' then
    return query select x.id, x.title, x.updated_at, count(*) over () from public.resources x where x.status = 'removed'
      order by x.updated_at desc, x.id limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
  else
    return query select x.id, x.title, x.updated_at, count(*) over () from public.events x where x.status = 'removed'
      order by x.updated_at desc, x.id limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
  end if;
end $$;

create function public.admin_communities_overview(p_search text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, name text, slug text, visibility text, members bigint, open_reports bigint, created_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_pat text;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if v_term is not null and length(v_term) > 100 then
    raise exception 'search too long' using errcode = '22023';
  end if;
  v_pat := case when v_term is null then null
                else '%' || replace(replace(replace(v_term, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  return query
  select c.id, c.name, c.slug, c.visibility::text,
    (select count(*) from public.memberships m where m.community_id = c.id and m.status = 'active'),
    (select count(*) from public.reports r where r.status in ('open', 'reviewing')
       and (r.community_id = c.id or r.post_id in (select x.id from public.posts x where x.community_id = c.id)
            or r.comment_id in (select cm.id from public.comments cm join public.posts x on x.id = cm.post_id where x.community_id = c.id))),
    c.created_at, count(*) over ()
  from public.communities c
  where v_term is null or c.name ilike v_pat or c.slug ilike v_pat
  order by c.created_at desc, c.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- ---------------------------------------------------------------- academic data (admin only, audited)
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'public.universities'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%user_supplied_unverified%' loop
    execute format('alter table public.universities drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.universities add constraint universities_source_check
  check (source in ('edu.gov.az', 'wikipedia', 'user_supplied_unverified', 'admin_verified'));

create function public.admin_reason_ok(p_reason text) returns void
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
end $$;
revoke all on function public.admin_reason_ok(text) from public, anon, authenticated;

create function public.admin_upsert_university(p_id uuid, p_name text, p_short_name text, p_city text, p_type text, p_ownership text,
  p_affiliated_with text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
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
    update public.universities set name = btrim(p_name), short_name = nullif(btrim(p_short_name), ''), city = nullif(btrim(p_city), ''),
      institution_type = p_type, ownership = p_ownership, affiliated_with = nullif(btrim(p_affiliated_with), ''), updated_at = now()
      where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'institution not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.university.create' else 'academic.university.update' end, 'university', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'reason', btrim(p_reason)));
  return v_id;
end $$;

create function public.admin_verify_university(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  update public.universities set source = 'admin_verified', updated_at = now() where id = p_id and source = 'user_supplied_unverified';
  if not found then
    if not exists (select 1 from public.universities where id = p_id) then
      raise exception 'institution not found' using errcode = 'P0002';
    end if;
    return false;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'academic.university.verify', 'university', p_id::text, jsonb_build_object('reason', btrim(p_reason)));
  return true;
end $$;

create function public.admin_upsert_faculty(p_id uuid, p_university_id uuid, p_name text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_id is null then
    insert into public.faculties (university_id, name) values (p_university_id, btrim(p_name)) returning id into v_id;
  else
    update public.faculties set university_id = p_university_id, name = btrim(p_name), updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'faculty not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.faculty.create' else 'academic.faculty.update' end, 'faculty', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'reason', btrim(p_reason)));
  return v_id;
end $$;

create function public.admin_upsert_major(p_id uuid, p_faculty_id uuid, p_name text, p_degree_level text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_id is null then
    insert into public.majors (faculty_id, name, degree_level) values (p_faculty_id, btrim(p_name), coalesce(p_degree_level, 'bachelor')) returning id into v_id;
  else
    update public.majors set faculty_id = p_faculty_id, name = btrim(p_name), degree_level = coalesce(p_degree_level, 'bachelor'), updated_at = now()
      where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'major not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.major.create' else 'academic.major.update' end, 'major', v_id::text,
          jsonb_build_object('name', btrim(p_name), 'reason', btrim(p_reason)));
  return v_id;
end $$;

create function public.admin_upsert_course(p_id uuid, p_university_id uuid, p_major_id uuid, p_code text, p_title text, p_credits numeric,
  p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if p_id is null then
    insert into public.courses (university_id, major_id, code, title, credits) values (p_university_id, p_major_id, btrim(p_code), btrim(p_title), p_credits)
      returning id into v_id;
  else
    update public.courses set university_id = p_university_id, major_id = p_major_id, code = btrim(p_code), title = btrim(p_title),
      credits = p_credits, updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'course not found' using errcode = 'P0002';
    end if;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), case when p_id is null then 'academic.course.create' else 'academic.course.update' end, 'course', v_id::text,
          jsonb_build_object('code', btrim(p_code), 'reason', btrim(p_reason)));
  return v_id;
end $$;

-- Deletion refuses when dependants exist (cascades would silently remove other people's academic structure).
create function public.admin_delete_academic(p_kind text, p_id uuid, p_reason text) returns boolean
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
    delete from public.courses where id = p_id;
  end if;
  if not found then
    return false;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'academic.' || p_kind || '.delete', p_kind, p_id::text, jsonb_build_object('name', v_name, 'reason', btrim(p_reason)));
  return true;
end $$;

-- ---------------------------------------------------------------- prompt versions
-- New version number = max + 1 per name (serialised). Optionally activates (exactly one active per name is kept by the unique index).
create function public.admin_create_prompt_version(p_name text, p_template text, p_model text, p_activate boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_ver integer;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  if length(v_name) not between 1 and 100 or v_name !~ '^[A-Za-z0-9_.:-]+$' then
    raise exception 'name must be 1-100 characters (letters, digits, _ . : -)' using errcode = '22023';
  end if;
  if p_template is null or length(btrim(p_template)) = 0 or length(p_template) > 50000 then
    raise exception 'template must be 1-50000 characters' using errcode = '22023';
  end if;
  if p_model is not null and length(p_model) > 100 then
    raise exception 'model too long' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('prompt:' || v_name, 0));
  select coalesce(max(version), 0) + 1 into v_ver from public.prompt_versions where name = v_name;
  if p_activate then
    update public.prompt_versions set is_active = false where name = v_name and is_active;
  end if;
  insert into public.prompt_versions (name, version, template, model, is_active, created_by)
  values (v_name, v_ver, p_template, nullif(btrim(p_model), ''), coalesce(p_activate, false), auth.uid()) returning id into v_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'prompt.create', 'prompt_version', v_id::text,
          jsonb_build_object('name', v_name, 'version', v_ver, 'activated', coalesce(p_activate, false), 'reason', btrim(p_reason)));
  return v_id;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  public.admin_set_user_suspended(uuid, boolean, text), public.admin_list_users(text, integer, integer),
  public.admin_user_subscriptions(uuid), public.admin_expiring_subscriptions(integer, integer, integer),
  public.admin_run_subscription_expiry(), public.admin_overview_counters(),
  public.admin_reports_queue(text, integer, integer), public.admin_removed_content(text, integer, integer),
  public.admin_communities_overview(text, integer, integer),
  public.admin_upsert_university(uuid, text, text, text, text, text, text, text), public.admin_verify_university(uuid, text),
  public.admin_upsert_faculty(uuid, uuid, text, text), public.admin_upsert_major(uuid, uuid, text, text, text),
  public.admin_upsert_course(uuid, uuid, uuid, text, text, numeric, text), public.admin_delete_academic(text, uuid, text),
  public.admin_create_prompt_version(text, text, text, boolean, text)
  from public, anon;
grant execute on function
  public.admin_set_user_suspended(uuid, boolean, text), public.admin_list_users(text, integer, integer),
  public.admin_user_subscriptions(uuid), public.admin_expiring_subscriptions(integer, integer, integer),
  public.admin_run_subscription_expiry(), public.admin_overview_counters(),
  public.admin_reports_queue(text, integer, integer), public.admin_removed_content(text, integer, integer),
  public.admin_communities_overview(text, integer, integer),
  public.admin_upsert_university(uuid, text, text, text, text, text, text, text), public.admin_verify_university(uuid, text),
  public.admin_upsert_faculty(uuid, uuid, text, text), public.admin_upsert_major(uuid, uuid, text, text, text),
  public.admin_upsert_course(uuid, uuid, uuid, text, text, numeric, text), public.admin_delete_academic(text, uuid, text),
  public.admin_create_prompt_version(text, text, text, boolean, text)
  to authenticated;
