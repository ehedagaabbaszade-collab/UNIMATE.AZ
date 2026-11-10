-- Admin console part 2 (apps/admin). Postgres 15 syntax only.
-- Adds what the UI needs on top of 20260101001900 / 001700 / 003300 without weakening any RLS policy:
--  * reason-carrying wrappers for the AI config writers (reason is stored on config_versions and in audit_logs),
--  * an audited manual sweeper for stuck AI reservations,
--  * versioned + audited system_config writes (+ revert),
--  * template history + revert for notification_templates,
--  * learning-activity and retention aggregates (no per-user rows),
--  * processing-job failure list (sanitized) and an audited requeue.
-- Every function is SECURITY DEFINER, authorizes the caller itself (is_admin()) and is executable by authenticated only.

-- ---------------------------------------------------------------- AI config: reason on every version
alter table public.config_versions add column reason text check (reason is null or length(reason) <= 500);

-- Same behaviour as before; the optional reason arrives through the transaction-local setting unimate.cfg_reason
-- (set by the wrappers below) or p_extra->>'reason' (admin_revert_config).
create or replace function public.ai_cfg_commit(p_action text, p_entity_type text, p_entity_id text, p_old jsonb, p_new jsonb, p_extra jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version bigint;
  v_reason text := coalesce(nullif(current_setting('unimate.cfg_reason', true), ''), nullif(p_extra ->> 'reason', ''));
begin
  perform public.ai_validate_routes();
  insert into public.config_versions (snapshot, action, actor_id, reason)
  values (public.ai_config_snapshot(), p_action, auth.uid(), v_reason) returning version into v_version;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id,
          jsonb_build_object('old', p_old, 'new', p_new, 'version', v_version)
          || case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end
          || coalesce(p_extra, '{}'::jsonb));
  return v_version;
end $$;

create function public.admin_ai_set_provider(p_name text, p_kind text, p_enabled boolean, p_base_url_label text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.ai_require_admin();
  perform public.admin_reason_ok(p_reason);
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  v_id := public.admin_set_ai_provider(p_name, p_kind, p_enabled, p_base_url_label);
  perform set_config('unimate.cfg_reason', '', true);
  return v_id;
end $$;

create function public.admin_ai_set_model(p_provider_id uuid, p_model text, p_tier text, p_input bigint, p_output bigint, p_cached bigint,
  p_max_output_tokens integer, p_enabled boolean, p_approved_fallback boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.ai_require_admin();
  perform public.admin_reason_ok(p_reason);
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  v_id := public.admin_set_ai_model(p_provider_id, p_model, p_tier, p_input, p_output, p_cached, p_max_output_tokens, p_enabled, p_approved_fallback);
  perform set_config('unimate.cfg_reason', '', true);
  return v_id;
end $$;

create function public.admin_ai_set_route(p_task public.ai_task, p_plan public.sub_plan, p_primary_model_id uuid, p_fallback_model_ids uuid[],
  p_rate_limit_per_min integer, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.ai_require_admin();
  perform public.admin_reason_ok(p_reason);
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  v_id := public.admin_set_ai_route(p_task, p_plan, p_primary_model_id, p_fallback_model_ids, p_rate_limit_per_min);
  perform set_config('unimate.cfg_reason', '', true);
  return v_id;
end $$;

create function public.admin_ai_delete_route(p_task public.ai_task, p_plan public.sub_plan, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  perform public.ai_require_admin();
  perform public.admin_reason_ok(p_reason);
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  v_ok := public.admin_delete_ai_route(p_task, p_plan);
  perform set_config('unimate.cfg_reason', '', true);
  return v_ok;
end $$;

create function public.admin_ai_set_budget(p_scope text, p_key text, p_period text, p_hard_limit_micro_usd bigint, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.ai_require_admin();
  perform public.admin_reason_ok(p_reason);
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  v_id := public.admin_set_ai_budget(p_scope, p_key, p_period, p_hard_limit_micro_usd);
  perform set_config('unimate.cfg_reason', '', true);
  return v_id;
end $$;

create function public.admin_ai_delete_budget(p_scope text, p_key text, p_period text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ok boolean;
begin
  perform public.ai_require_admin();
  perform public.admin_reason_ok(p_reason);
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  v_ok := public.admin_delete_ai_budget(p_scope, p_key, p_period);
  perform set_config('unimate.cfg_reason', '', true);
  return v_ok;
end $$;

-- Manual run of the orphan sweeper (the scheduled one is service_role only). Releases reservations older than p_minutes (>= 5).
create function public.admin_ai_sweep_reservations(p_minutes integer, p_reason text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  v_n := public.ai_sweep_orphan_reservations(p_minutes);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'ai.sweep.manual', 'ai_reservations', null, jsonb_build_object('minutes', p_minutes, 'released', v_n, 'reason', btrim(p_reason)));
  return v_n;
end $$;

-- ---------------------------------------------------------------- system_config: versioned writes
create table public.system_config_versions (
  id bigint generated always as identity primary key,
  key text not null,
  value jsonb,                       -- null = the key was deleted
  action text not null,              -- insert | update | delete (written only by the trigger below)
  reason text check (reason is null or length(reason) <= 500),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index system_config_versions_key_idx on public.system_config_versions(key, id desc);
alter table public.system_config_versions enable row level security;
revoke all on public.system_config_versions from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.system_config_versions from service_role;
grant select on public.system_config_versions to authenticated;
create policy system_config_versions_admin_select on public.system_config_versions for select to authenticated using (public.is_admin());
create policy system_config_versions_service_select on public.system_config_versions for select to service_role using (true);

-- Captures every write path (RPC and direct admin writes alike). Direct writes simply carry no reason.
create function public.system_config_version_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.system_config_versions (key, value, action, reason, actor_id)
  values (case when tg_op = 'DELETE' then old.key else new.key end,
          case when tg_op = 'DELETE' then null else new.value end,
          lower(tg_op), nullif(current_setting('unimate.cfg_reason', true), ''), auth.uid());
  return null;
end $$;
revoke all on function public.system_config_version_log() from public, anon, authenticated;
create trigger system_config_version_log after insert or update or delete on public.system_config
  for each row execute function public.system_config_version_log();

-- Audit row now also carries the reason when there is one (still never the value).
create or replace function public.system_config_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := case when tg_op = 'DELETE' then old.key else new.key end;
begin
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'config.' || lower(tg_op), 'system_config', v_key,
          jsonb_strip_nulls(jsonb_build_object('reason', nullif(current_setting('unimate.cfg_reason', true), ''))));
  return null;
end $$;

create function public.admin_set_system_config(p_key text, p_value jsonb, p_reason text) returns bigint
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
  perform pg_advisory_xact_lock(hashtextextended('sysconfig:' || p_key, 0));
  perform set_config('unimate.cfg_reason', btrim(p_reason), true);
  insert into public.system_config (key, value, updated_by) values (p_key, p_value, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
  perform set_config('unimate.cfg_reason', '', true);
  select max(id) into v_ver from public.system_config_versions where key = p_key;
  return v_ver;
end $$;

-- Restores the value (or the deletion) recorded in a version; recorded as a NEW version.
create function public.admin_revert_system_config(p_version_id bigint, p_reason text) returns bigint
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
  perform pg_advisory_xact_lock(hashtextextended('sysconfig:' || v.key, 0));
  perform set_config('unimate.cfg_reason', 'revert to v' || p_version_id || ': ' || btrim(p_reason), true);
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

-- ---------------------------------------------------------------- notification templates: history + revert
create table public.notification_template_versions (
  id bigint generated always as identity primary key,
  key text not null,
  locale text not null,
  title text not null,
  body text,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index notification_template_versions_idx on public.notification_template_versions(key, locale, id desc);
alter table public.notification_template_versions enable row level security;
revoke all on public.notification_template_versions from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.notification_template_versions from service_role;
grant select on public.notification_template_versions to authenticated;
create policy notification_template_versions_admin_select on public.notification_template_versions for select to authenticated using (public.is_admin());
create policy notification_template_versions_service_select on public.notification_template_versions for select to service_role using (true);

-- Same contract as before (20260101003300), plus a history row.
create or replace function public.admin_set_notification_template(p_key text, p_locale text, p_title text, p_body text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_.]{1,80}$' or p_locale is null or p_locale not in ('az', 'tr', 'en', 'ru')
     or p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_body, '')) > 2000
     or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'valid key, locale, title, body and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  insert into public.notification_templates (key, locale, title, body, updated_by) values (p_key, p_locale, btrim(p_title), p_body, v_actor)
  on conflict (key, locale) do update set title = excluded.title, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into public.notification_template_versions (key, locale, title, body, actor_id, reason)
  values (p_key, p_locale, btrim(p_title), p_body, v_actor, btrim(p_reason));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'notification_template.set', 'notification_template', p_key || ':' || p_locale,
          jsonb_build_object('reason', btrim(p_reason)));
  return v_id;
end $$;

create function public.admin_revert_notification_template(p_version_id bigint, p_reason text) returns uuid
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
  return public.admin_set_notification_template(v.key, v.locale, v.title, v.body, 'revert to v' || p_version_id || ': ' || btrim(p_reason));
end $$;

-- ---------------------------------------------------------------- analytics (aggregates only)
-- Asia/Baku calendar days. flashcards_reviewed = review_completed xp events (the server awards at most 100/day/user, so this
-- under-counts heavy users; there is no per-review log table). study_minutes = completed study sessions started that day.
create function public.admin_learning_metrics(p_days integer default 30)
returns table (day date, quizzes_taken integer, flashcards_reviewed integer, study_minutes integer, documents_uploaded integer)
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
  v_from := ((v_today - (p_days - 1))::timestamp at time zone 'Asia/Baku');
  return query
  select d.d,
    (select count(*)::integer from public.attempts a where a.completed_at >= v_from and (a.completed_at at time zone 'Asia/Baku')::date = d.d),
    (select count(*)::integer from public.xp_events x where x.kind = 'review_completed' and x.created_at >= v_from and (x.created_at at time zone 'Asia/Baku')::date = d.d),
    (select coalesce(sum(s.duration_seconds) / 60, 0)::integer from public.study_sessions s where s.started_at >= v_from and (s.started_at at time zone 'Asia/Baku')::date = d.d),
    (select count(*)::integer from public.documents o where o.created_at >= v_from and (o.created_at at time zone 'Asia/Baku')::date = d.d)
  from (select (v_today - n)::date as d from generate_series(0, p_days - 1) n) d order by d.d;
end $$;

-- Weekly signup cohorts: users active (xp event or study session) in week 0, 1, 2 ... after the signup week.
create function public.admin_retention_cohorts(p_weeks integer default 8)
returns table (cohort_week date, cohort_size integer, week_offset integer, active integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_cur date := date_trunc('week', now() at time zone 'Asia/Baku')::date;
  v_first date;
  v_from timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_weeks is null or p_weeks not between 1 and 26 then
    raise exception 'weeks must be between 1 and 26' using errcode = '22023';
  end if;
  v_first := v_cur - 7 * (p_weeks - 1);
  v_from := (v_first::timestamp at time zone 'Asia/Baku');
  return query
  with coh as (
    select p.id as uid, date_trunc('week', p.created_at at time zone 'Asia/Baku')::date as cw
    from public.profiles p where p.created_at >= v_from
  ), act as (
    select x.user_id as uid, date_trunc('week', x.created_at at time zone 'Asia/Baku')::date as wk from public.xp_events x where x.created_at >= v_from
    union
    select s.user_id, date_trunc('week', s.started_at at time zone 'Asia/Baku')::date from public.study_sessions s where s.started_at >= v_from
  ), sizes as (
    select c.cw, count(*)::integer as n from coh c group by c.cw
  ), offs as (
    select z.cw, z.n, o.k from sizes z cross join lateral generate_series(0, (v_cur - z.cw) / 7) as o(k)
  )
  select f.cw, f.n, f.k,
         (select count(distinct a.uid)::integer from act a join coh c on c.uid = a.uid where c.cw = f.cw and a.wk = f.cw + f.k * 7)
  from offs f order by f.cw, f.k;
end $$;

-- ---------------------------------------------------------------- processing jobs
-- Failed and dead jobs without payload, user id or raw error text: last_error is flattened, e-mails and URLs are
-- masked and it is cut to 200 characters.
create function public.admin_processing_failures(p_state text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, document_id uuid, kind text, state public.job_state, attempts integer, max_attempts integer,
               last_error text, updated_at timestamptz, total bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_state is not null and p_state not in ('failed', 'dead') then
    raise exception 'state must be failed or dead' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset < 0 then
    raise exception 'invalid page' using errcode = '22023';
  end if;
  return query
  select j.id, j.document_id, j.kind, j.state, j.attempts, j.max_attempts,
         left(regexp_replace(regexp_replace(regexp_replace(coalesce(j.last_error, ''), '[[:space:]]+', ' ', 'g'),
              '[^[:space:]]+@[^[:space:]]+', '[email]', 'g'), 'https?://[^[:space:]]+', '[url]', 'g'), 200),
         j.updated_at, count(*) over ()
  from public.processing_jobs j
  where j.state in ('failed', 'dead') and (p_state is null or j.state::text = p_state)
  order by j.updated_at desc, j.id limit p_limit offset p_offset;
end $$;

-- Puts a failed/dead job back in the queue with a fresh attempt budget. Any other state is a conflict.
create function public.admin_requeue_job(p_job_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j public.processing_jobs;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform public.admin_reason_ok(p_reason);
  select * into j from public.processing_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  if j.state not in ('failed', 'dead') then
    raise exception 'only failed or dead jobs can be requeued' using errcode = '55000';
  end if;
  update public.processing_jobs set state = 'queued', attempts = 0, run_after = now(), locked_at = null, locked_by = null, updated_at = now()
    where id = p_job_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'job.requeue', 'processing_job', p_job_id::text,
          jsonb_build_object('kind', j.kind, 'from', j.state, 'attempts', j.attempts, 'reason', btrim(p_reason)));
  return true;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function
  public.admin_ai_set_provider(text, text, boolean, text, text),
  public.admin_ai_set_model(uuid, text, text, bigint, bigint, bigint, integer, boolean, boolean, text),
  public.admin_ai_set_route(public.ai_task, public.sub_plan, uuid, uuid[], integer, text),
  public.admin_ai_delete_route(public.ai_task, public.sub_plan, text),
  public.admin_ai_set_budget(text, text, text, bigint, text), public.admin_ai_delete_budget(text, text, text, text),
  public.admin_ai_sweep_reservations(integer, text),
  public.admin_set_system_config(text, jsonb, text), public.admin_revert_system_config(bigint, text),
  public.admin_revert_notification_template(bigint, text),
  public.admin_learning_metrics(integer), public.admin_retention_cohorts(integer),
  public.admin_processing_failures(text, integer, integer), public.admin_requeue_job(uuid, text)
  from public, anon;
grant execute on function
  public.admin_ai_set_provider(text, text, boolean, text, text),
  public.admin_ai_set_model(uuid, text, text, bigint, bigint, bigint, integer, boolean, boolean, text),
  public.admin_ai_set_route(public.ai_task, public.sub_plan, uuid, uuid[], integer, text),
  public.admin_ai_delete_route(public.ai_task, public.sub_plan, text),
  public.admin_ai_set_budget(text, text, text, bigint, text), public.admin_ai_delete_budget(text, text, text, text),
  public.admin_ai_sweep_reservations(integer, text),
  public.admin_set_system_config(text, jsonb, text), public.admin_revert_system_config(bigint, text),
  public.admin_revert_notification_template(bigint, text),
  public.admin_learning_metrics(integer), public.admin_retention_cohorts(integer),
  public.admin_processing_failures(text, integer, integer), public.admin_requeue_job(uuid, text)
  to authenticated;
