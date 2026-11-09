-- AI cost architecture. Postgres 15 syntax only.
-- * Config (providers, models, task routes, budgets) is admin-only data, written ONLY through audited SECURITY DEFINER
--   RPCs that validate and snapshot every change into config_versions (revertable). No secrets are stored here.
-- * Spend ceilings (user / plan / global) are enforced atomically by reserve_ai_budget (reserve-then-settle),
--   idempotent per request_id. All spend/reservation/rate-limit objects are service_role-only (via RPCs).
-- * Prices are integer micro-USD per 1,000,000 tokens (1 USD/MTok = 1,000,000). Costs are ceil(tokens * price / 1e6).
-- Default privileges in this project grant ALL on new tables/functions to API roles, so every object below is revoked
-- explicitly and re-granted to exactly the intended role.

create type public.ai_task as enum
  ('extract_cleanup', 'summarize', 'rag', 'chat', 'quiz', 'flashcards', 'exam_simulation', 'embed');

-- ---------------------------------------------------------------- config tables
create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name ~ '^[a-z0-9_.-]{1,60}$'),
  kind text not null check (kind in ('openai', 'anthropic')),
  enabled boolean not null default true,
  -- A human label for the endpoint (e.g. "openrouter"); NOT a URL with credentials and never a key.
  base_url_label text check (base_url_label is null or length(base_url_label) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.ai_providers(id) on delete restrict,
  model text not null check (length(btrim(model)) between 1 and 200),
  tier text not null check (tier in ('small', 'standard', 'premium')),
  input_micro_usd_per_mtok bigint not null check (input_micro_usd_per_mtok > 0),
  -- 0 is allowed: embedding models have no output tokens.
  output_micro_usd_per_mtok bigint not null check (output_micro_usd_per_mtok >= 0),
  cached_input_micro_usd_per_mtok bigint not null check (cached_input_micro_usd_per_mtok >= 0),
  enabled boolean not null default true,
  approved_fallback boolean not null default false,
  max_output_tokens integer not null check (max_output_tokens between 1 and 1000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model),
  check (cached_input_micro_usd_per_mtok <= input_micro_usd_per_mtok)
);

create table public.ai_task_routes (
  id uuid primary key default gen_random_uuid(),
  task public.ai_task not null,
  plan public.sub_plan not null,
  primary_model_id uuid not null references public.ai_models(id) on delete restrict,
  -- Ordered; every element must be an approved, cheaper-or-equal model (validated by ai_validate_routes).
  fallback_model_ids uuid[] not null default '{}',
  rate_limit_per_min integer not null default 20 check (rate_limit_per_min between 1 and 100000),
  updated_at timestamptz not null default now(),
  unique (task, plan)
);

create table public.ai_budgets (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('user', 'plan', 'global')),
  -- global: '*'. plan: free|plus|pro. user: a profile uuid, or '*' = default limit applied to EACH user.
  key text not null check (length(key) between 1 and 64),
  period text not null check (period in ('day', 'month')),
  hard_limit_micro_usd bigint not null check (hard_limit_micro_usd >= 0),
  updated_at timestamptz not null default now(),
  unique (scope, key, period),
  check ((scope = 'global' and key = '*') or (scope = 'plan' and key in ('free', 'plus', 'pro')) or scope = 'user')
);

create table public.config_versions (
  version bigint generated always as identity primary key,
  snapshot jsonb not null,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- ledger tables (service_role via RPC only)
create table public.ai_spend (
  scope text not null check (scope in ('user', 'plan', 'global')),
  key text not null,
  period text not null check (period in ('day', 'month')),
  period_start date not null,
  spent_micro_usd bigint not null default 0 check (spent_micro_usd >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, key, period, period_start)
);

create table public.ai_reservations (
  request_id text primary key check (length(request_id) between 8 and 200),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan text not null,
  task text,
  model_id uuid references public.ai_models(id) on delete set null,
  estimate_micro_usd bigint not null check (estimate_micro_usd >= 0),
  charged jsonb not null default '[]'::jsonb,
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released')),
  actual_micro_usd bigint check (actual_micro_usd is null or actual_micro_usd >= 0),
  clamped boolean not null default false,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index ai_reservations_open_idx on public.ai_reservations(created_at) where status = 'reserved';
create index ai_reservations_user_idx on public.ai_reservations(user_id);

create table public.ai_rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  task text not null,
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (user_id, task)
);

-- ---------------------------------------------------------------- ai_usage: new columns (all nullable/defaulted: old rows and inserts stay valid)
alter table public.ai_usage
  add column provider text,
  add column task text,
  add column model_id uuid references public.ai_models(id) on delete set null,
  add column plan text,
  add column cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  add column estimated_cost_micro_usd bigint check (estimated_cost_micro_usd is null or estimated_cost_micro_usd >= 0),
  add column request_id text check (request_id is null or length(request_id) between 8 and 200),
  add column status text not null default 'settled' check (status in ('settled', 'failed_billable', 'failed_unbilled')),
  add column fallback_used boolean not null default false;
-- NULLs are distinct: legacy rows without a request_id never conflict; guarded rows are idempotent per request.
create unique index ai_usage_request_id_key on public.ai_usage(request_id);
create index ai_usage_created_idx on public.ai_usage(created_at);

-- ---------------------------------------------------------------- privileges + RLS
alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
alter table public.ai_task_routes enable row level security;
alter table public.ai_budgets enable row level security;
alter table public.config_versions enable row level security;
alter table public.ai_spend enable row level security;
alter table public.ai_reservations enable row level security;
alter table public.ai_rate_limits enable row level security;

revoke all on public.ai_providers, public.ai_models, public.ai_task_routes, public.ai_budgets, public.config_versions,
  public.ai_spend, public.ai_reservations, public.ai_rate_limits from anon, authenticated;
-- Nobody writes config or the ledger directly (service_role included): only the RPCs below (owner privileges).
revoke insert, update, delete, truncate, references, trigger on public.ai_providers, public.ai_models, public.ai_task_routes,
  public.ai_budgets, public.config_versions, public.ai_spend, public.ai_reservations, public.ai_rate_limits from service_role;
-- Admins may read config and its history directly; service_role reads config. Spend/reservations/limits: RPC only.
grant select on public.ai_providers, public.ai_models, public.ai_task_routes, public.ai_budgets, public.config_versions to authenticated;
create policy ai_providers_admin_select on public.ai_providers for select to authenticated using (public.is_admin());
create policy ai_models_admin_select on public.ai_models for select to authenticated using (public.is_admin());
create policy ai_task_routes_admin_select on public.ai_task_routes for select to authenticated using (public.is_admin());
create policy ai_budgets_admin_select on public.ai_budgets for select to authenticated using (public.is_admin());
create policy config_versions_admin_select on public.config_versions for select to authenticated using (public.is_admin());
create policy ai_providers_service_select on public.ai_providers for select to service_role using (true);
create policy ai_models_service_select on public.ai_models for select to service_role using (true);
create policy ai_task_routes_service_select on public.ai_task_routes for select to service_role using (true);
create policy ai_budgets_service_select on public.ai_budgets for select to service_role using (true);
create policy config_versions_service_select on public.config_versions for select to service_role using (true);
-- Ledger tables: no policy for authenticated/anon (deny-all); service_role may read, all writes go through the RPCs.
create policy ai_spend_service_select on public.ai_spend for select to service_role using (true);
create policy ai_reservations_service_select on public.ai_reservations for select to service_role using (true);
create policy ai_rate_limits_service_select on public.ai_rate_limits for select to service_role using (true);
-- ai_usage keeps its existing owner-select policy (data export); writes stay service_role/RPC only. Admins see aggregates via the admin_ai_* views.

-- ---------------------------------------------------------------- helpers
create function public.ai_tier_rank(p_tier text) returns integer
language sql immutable set search_path = pg_temp as $$
  select case p_tier when 'small' then 1 when 'standard' then 2 when 'premium' then 3 else 99 end
$$;

-- Plan comes from subscriptions only (same rule as the pipeline's getPlan, highest live plan wins).
create function public.ai_plan_of(p_user_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select s.plan::text from public.subscriptions s
    where s.user_id = p_user_id and s.status in ('active', 'trialing')
      and (s.current_period_end is null or s.current_period_end > now())
    order by case s.plan::text when 'pro' then 3 when 'plus' then 2 else 1 end desc limit 1), 'free')
$$;

create function public.ai_period_start(p_period text) returns date
language sql stable set search_path = pg_temp as $$
  select case p_period when 'day' then (now() at time zone 'UTC')::date
                       else date_trunc('month', now() at time zone 'UTC')::date end
$$;

create function public.ai_config_snapshot() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'providers', coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.ai_providers p), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from public.ai_models m), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from public.ai_task_routes r), '[]'::jsonb),
    'budgets', coalesce((select jsonb_agg(to_jsonb(b) order by b.id) from public.ai_budgets b), '[]'::jsonb))
$$;

-- service_role entry point for the pipeline (read-only).
create function public.ai_load_config() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public.ai_config_snapshot()
$$;

-- One rule for every write and for revert: fallbacks exist, are approved, distinct from the primary and not more
-- expensive (input, output, cached input, tier) than the primary at the CURRENT prices.
create function public.ai_validate_routes() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r record;
  pm public.ai_models;
  fm public.ai_models;
  fid uuid;
begin
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

-- Validates all routes, records a new config version and the audit entry. Returns the version.
create function public.ai_cfg_commit(p_action text, p_entity_type text, p_entity_id text, p_old jsonb, p_new jsonb, p_extra jsonb default '{}'::jsonb)
returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_version bigint;
begin
  perform public.ai_validate_routes();
  insert into public.config_versions (snapshot, action, actor_id)
  values (public.ai_config_snapshot(), p_action, auth.uid()) returning version into v_version;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id,
          jsonb_build_object('old', p_old, 'new', p_new, 'version', v_version) || coalesce(p_extra, '{}'::jsonb));
  return v_version;
end $$;

create function public.ai_require_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_config', 0));
end $$;

-- ---------------------------------------------------------------- admin config RPCs
create function public.admin_set_ai_provider(p_name text, p_kind text, p_enabled boolean, p_base_url_label text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_row public.ai_providers;
begin
  perform public.ai_require_admin();
  if p_name is null or p_name !~ '^[a-z0-9_.-]{1,60}$' then
    raise exception 'invalid provider name' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('openai', 'anthropic') then
    raise exception 'unknown provider kind' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'enabled is required' using errcode = '22023';
  end if;
  if p_base_url_label is not null and (length(p_base_url_label) > 100 or p_base_url_label ~* '(://|@|key|secret|token)') then
    raise exception 'base_url_label must be a short label without URL or credentials' using errcode = '22023';
  end if;
  select to_jsonb(p) into v_old from public.ai_providers p where p.name = p_name;
  insert into public.ai_providers (name, kind, enabled, base_url_label) values (p_name, p_kind, p_enabled, p_base_url_label)
  on conflict (name) do update set kind = excluded.kind, enabled = excluded.enabled,
    base_url_label = excluded.base_url_label, updated_at = now()
  returning * into v_row;
  perform public.ai_cfg_commit('ai_config.provider.set', 'ai_provider', v_row.id::text, v_old, to_jsonb(v_row));
  return v_row.id;
end $$;

create function public.admin_set_ai_model(
  p_provider_id uuid, p_model text, p_tier text, p_input_micro_usd_per_mtok bigint, p_output_micro_usd_per_mtok bigint,
  p_cached_input_micro_usd_per_mtok bigint, p_max_output_tokens integer, p_enabled boolean, p_approved_fallback boolean)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_row public.ai_models;
begin
  perform public.ai_require_admin();
  if p_provider_id is null or not exists (select 1 from public.ai_providers where id = p_provider_id) then
    raise exception 'provider not found' using errcode = 'P0002';
  end if;
  if p_model is null or length(btrim(p_model)) not between 1 and 200 then
    raise exception 'invalid model name' using errcode = '22023';
  end if;
  if p_tier is null or p_tier not in ('small', 'standard', 'premium') then
    raise exception 'invalid tier' using errcode = '22023';
  end if;
  if p_input_micro_usd_per_mtok is null or p_input_micro_usd_per_mtok <= 0
     or p_output_micro_usd_per_mtok is null or p_output_micro_usd_per_mtok < 0
     or p_cached_input_micro_usd_per_mtok is null or p_cached_input_micro_usd_per_mtok < 0 then
    raise exception 'prices must be positive (output/cached may be 0)' using errcode = '22023';
  end if;
  if p_cached_input_micro_usd_per_mtok > p_input_micro_usd_per_mtok then
    raise exception 'cached input price cannot exceed input price' using errcode = '22023';
  end if;
  if p_max_output_tokens is null or p_max_output_tokens not between 1 and 1000000 then
    raise exception 'max_output_tokens out of range' using errcode = '22023';
  end if;
  if p_enabled is null or p_approved_fallback is null then
    raise exception 'enabled and approved_fallback are required' using errcode = '22023';
  end if;
  select to_jsonb(m) into v_old from public.ai_models m where m.provider_id = p_provider_id and m.model = btrim(p_model);
  insert into public.ai_models (provider_id, model, tier, input_micro_usd_per_mtok, output_micro_usd_per_mtok,
    cached_input_micro_usd_per_mtok, enabled, approved_fallback, max_output_tokens)
  values (p_provider_id, btrim(p_model), p_tier, p_input_micro_usd_per_mtok, p_output_micro_usd_per_mtok,
    p_cached_input_micro_usd_per_mtok, p_enabled, p_approved_fallback, p_max_output_tokens)
  on conflict (provider_id, model) do update set tier = excluded.tier,
    input_micro_usd_per_mtok = excluded.input_micro_usd_per_mtok,
    output_micro_usd_per_mtok = excluded.output_micro_usd_per_mtok,
    cached_input_micro_usd_per_mtok = excluded.cached_input_micro_usd_per_mtok,
    enabled = excluded.enabled, approved_fallback = excluded.approved_fallback,
    max_output_tokens = excluded.max_output_tokens, updated_at = now()
  returning * into v_row;
  -- ai_cfg_commit re-validates every route: a price or approval change that makes a fallback pricier is rejected.
  perform public.ai_cfg_commit('ai_config.model.set', 'ai_model', v_row.id::text, v_old, to_jsonb(v_row));
  return v_row.id;
end $$;

create function public.admin_set_ai_route(p_task public.ai_task, p_plan public.sub_plan, p_primary_model_id uuid,
  p_fallback_model_ids uuid[] default '{}', p_rate_limit_per_min integer default 20)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_row public.ai_task_routes;
  v_fallbacks uuid[] := coalesce(p_fallback_model_ids, '{}');
begin
  perform public.ai_require_admin();
  if p_task is null or p_plan is null then
    raise exception 'task and plan are required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.ai_models where id = p_primary_model_id and enabled) then
    raise exception 'primary model not found or disabled' using errcode = 'P0002';
  end if;
  if exists (select 1 from unnest(v_fallbacks) f where f is null or not exists (select 1 from public.ai_models m where m.id = f and m.enabled)) then
    raise exception 'fallback model not found or disabled' using errcode = 'P0002';
  end if;
  if p_rate_limit_per_min is null or p_rate_limit_per_min not between 1 and 100000 then
    raise exception 'rate limit must be between 1 and 100000 per minute' using errcode = '22023';
  end if;
  select to_jsonb(r) into v_old from public.ai_task_routes r where r.task = p_task and r.plan = p_plan;
  insert into public.ai_task_routes (task, plan, primary_model_id, fallback_model_ids, rate_limit_per_min)
  values (p_task, p_plan, p_primary_model_id, v_fallbacks, p_rate_limit_per_min)
  on conflict (task, plan) do update set primary_model_id = excluded.primary_model_id,
    fallback_model_ids = excluded.fallback_model_ids, rate_limit_per_min = excluded.rate_limit_per_min, updated_at = now()
  returning * into v_row;
  perform public.ai_cfg_commit('ai_config.route.set', 'ai_task_route', v_row.id::text, v_old, to_jsonb(v_row));
  return v_row.id;
end $$;

create function public.admin_delete_ai_route(p_task public.ai_task, p_plan public.sub_plan) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
begin
  perform public.ai_require_admin();
  delete from public.ai_task_routes where task = p_task and plan = p_plan returning to_jsonb(ai_task_routes.*) into v_old;
  if v_old is null then return false; end if;
  perform public.ai_cfg_commit('ai_config.route.delete', 'ai_task_route', v_old ->> 'id', v_old, null);
  return true;
end $$;

create function public.admin_set_ai_budget(p_scope text, p_key text, p_period text, p_hard_limit_micro_usd bigint) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
  v_row public.ai_budgets;
begin
  perform public.ai_require_admin();
  if p_scope is null or p_scope not in ('user', 'plan', 'global') then
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  if p_period is null or p_period not in ('day', 'month') then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  if p_hard_limit_micro_usd is null or p_hard_limit_micro_usd < 0 then
    raise exception 'limit must be non-negative' using errcode = '22023';
  end if;
  if p_scope = 'global' and p_key is distinct from '*' then
    raise exception 'global budget key must be *' using errcode = '22023';
  elsif p_scope = 'plan' and (p_key is null or p_key not in ('free', 'plus', 'pro')) then
    raise exception 'plan budget key must be free, plus or pro' using errcode = '22023';
  elsif p_scope = 'user' and p_key is distinct from '*' then
    if p_key is null or p_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from public.profiles where id = p_key::uuid) then
      raise exception 'user not found' using errcode = 'P0002';
    end if;
    p_key := lower(p_key);
  end if;
  select to_jsonb(b) into v_old from public.ai_budgets b where b.scope = p_scope and b.key = p_key and b.period = p_period;
  insert into public.ai_budgets (scope, key, period, hard_limit_micro_usd) values (p_scope, p_key, p_period, p_hard_limit_micro_usd)
  on conflict (scope, key, period) do update set hard_limit_micro_usd = excluded.hard_limit_micro_usd, updated_at = now()
  returning * into v_row;
  perform public.ai_cfg_commit('ai_config.budget.set', 'ai_budget', v_row.id::text, v_old, to_jsonb(v_row));
  return v_row.id;
end $$;

create function public.admin_delete_ai_budget(p_scope text, p_key text, p_period text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb;
begin
  perform public.ai_require_admin();
  delete from public.ai_budgets where scope = p_scope and key = p_key and period = p_period returning to_jsonb(ai_budgets.*) into v_old;
  if v_old is null then return false; end if;
  perform public.ai_cfg_commit('ai_config.budget.delete', 'ai_budget', v_old ->> 'id', v_old, null);
  return true;
end $$;

-- Restores the four config tables to the snapshot of a version (validated, then recorded as a NEW version).
create function public.admin_revert_config(p_version bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_snap jsonb;
  v_before jsonb;
begin
  perform public.ai_require_admin();
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  select snapshot into v_snap from public.config_versions where version = p_version;
  if not found then
    raise exception 'config version not found' using errcode = 'P0002';
  end if;
  v_before := public.ai_config_snapshot();
  -- Never delete rows that the snapshot keeps: ai_usage / ai_reservations reference models with ON DELETE SET NULL and
  -- would lose their history. Routes and budgets are rebuilt; providers and models are upserted by id.
  delete from public.ai_task_routes where true;
  delete from public.ai_budgets where true;
  delete from public.ai_models where id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_snap -> 'models') x);
  delete from public.ai_providers where id not in (select (x ->> 'id')::uuid from jsonb_array_elements(v_snap -> 'providers') x);
  insert into public.ai_providers select * from jsonb_populate_recordset(null::public.ai_providers, v_snap -> 'providers')
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, enabled = excluded.enabled,
    base_url_label = excluded.base_url_label, created_at = excluded.created_at, updated_at = excluded.updated_at;
  insert into public.ai_models select * from jsonb_populate_recordset(null::public.ai_models, v_snap -> 'models')
  on conflict (id) do update set provider_id = excluded.provider_id, model = excluded.model, tier = excluded.tier,
    input_micro_usd_per_mtok = excluded.input_micro_usd_per_mtok, output_micro_usd_per_mtok = excluded.output_micro_usd_per_mtok,
    cached_input_micro_usd_per_mtok = excluded.cached_input_micro_usd_per_mtok, enabled = excluded.enabled,
    approved_fallback = excluded.approved_fallback, max_output_tokens = excluded.max_output_tokens,
    created_at = excluded.created_at, updated_at = excluded.updated_at;
  insert into public.ai_task_routes select * from jsonb_populate_recordset(null::public.ai_task_routes, v_snap -> 'routes');
  insert into public.ai_budgets select * from jsonb_populate_recordset(null::public.ai_budgets, v_snap -> 'budgets');
  return public.ai_cfg_commit('ai_config.revert', 'ai_config', p_version::text, v_before, v_snap,
    jsonb_build_object('reverted_to', p_version, 'reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------- budget ledger
-- Internal: give back an open reservation. Idempotent (false when it is not 'reserved').
create function public.ai_release_internal(p_request_id text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res public.ai_reservations;
  c jsonb;
  v_m public.ai_models;
  v_prov text;
begin
  perform pg_advisory_xact_lock(hashtextextended('ai_res:' || p_request_id, 0));
  select * into v_res from public.ai_reservations where request_id = p_request_id for update;
  if not found or v_res.status <> 'reserved' then
    return false;
  end if;
  for c in select value from jsonb_array_elements(v_res.charged) loop
    update public.ai_spend set reserved_micro_usd = greatest(0, reserved_micro_usd - v_res.estimate_micro_usd), updated_at = now()
      where scope = c ->> 'scope' and key = c ->> 'key' and period = c ->> 'period' and period_start = (c ->> 'period_start')::date;
  end loop;
  update public.ai_reservations set status = 'released', settled_at = now() where request_id = p_request_id;
  select m.* into v_m from public.ai_models m where m.id = v_res.model_id;
  select p.name into v_prov from public.ai_providers p where p.id = v_m.provider_id;
  insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd, provider, task, model_id,
                               plan, estimated_cost_micro_usd, request_id, status)
  values (v_res.user_id, coalesce(v_res.task, 'ai'), v_m.model, 0, 0, 0, v_prov, v_res.task, v_res.model_id, v_res.plan,
          v_res.estimate_micro_usd, p_request_id, 'failed_unbilled')
  on conflict (request_id) do nothing;
  return true;
end $$;

-- Atomically checks user + plan + global limits and reserves p_estimate in ONE transaction. Rows are locked in a fixed
-- order (global, plan, user) after an advisory lock on the request_id, so same-id retries are serialised and never
-- double-reserve. Returns jsonb: {ok:true, existing, status, estimate_micro_usd} or {ok:false, error, scope?}.
create function public.reserve_ai_budget(p_request_id text, p_user_id uuid, p_plan text, p_estimate_micro_usd bigint,
  p_task text default null, p_model_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.ai_reservations;
  v_plan text;
  v_charged jsonb := '[]'::jsonb;
  b record;
  sp public.ai_spend;
  v_start date;
  v_limit bigint;
  c jsonb;
begin
  if p_request_id is null or length(p_request_id) not between 8 and 200 then
    raise exception 'invalid request_id' using errcode = '22023';
  end if;
  if p_estimate_micro_usd is null or p_estimate_micro_usd < 0 then
    raise exception 'estimate must be non-negative' using errcode = '22023';
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_res:' || p_request_id, 0));

  select * into v_existing from public.ai_reservations where request_id = p_request_id for update;
  if found and v_existing.status <> 'released' then
    if v_existing.user_id <> p_user_id then
      return jsonb_build_object('ok', false, 'error', 'request_id_conflict');
    end if;
    return jsonb_build_object('ok', true, 'existing', true, 'status', v_existing.status,
                              'estimate_micro_usd', v_existing.estimate_micro_usd);
  end if;

  v_plan := public.ai_plan_of(p_user_id);
  if p_plan is not null and lower(p_plan) <> v_plan then
    return jsonb_build_object('ok', false, 'error', 'plan_mismatch');
  end if;
  -- A hard global ceiling must exist: missing global budget means "not configured", never "unlimited".
  if not exists (select 1 from public.ai_budgets where scope = 'global' and key = '*') then
    return jsonb_build_object('ok', false, 'error', 'ai_not_configured', 'reason', 'no_global_budget');
  end if;

  -- Spend is tracked for global, plan and user x day and month ALWAYS (a limit added mid-period still sees earlier
  -- spend); a limit is only enforced where a budget row exists. Fixed lock order: global, plan, user; day, month.
  for b in
    select t.scope, t.spend_key, t.period,
           (select x.hard_limit_micro_usd from public.ai_budgets x
             where x.scope = t.scope and x.period = t.period
               and x.key = case t.scope when 'global' then '*' when 'plan' then v_plan else p_user_id::text end) as own_limit,
           (select x.hard_limit_micro_usd from public.ai_budgets x
             where t.scope = 'user' and x.scope = 'user' and x.key = '*' and x.period = t.period) as default_limit
    from (values (1, 'global', '*', 'day'), (1, 'global', '*', 'month'), (2, 'plan', v_plan, 'day'), (2, 'plan', v_plan, 'month'),
                 (3, 'user', p_user_id::text, 'day'), (3, 'user', p_user_id::text, 'month')) as t(ord, scope, spend_key, period)
    order by t.ord, t.period
  loop
    v_start := public.ai_period_start(b.period);
    insert into public.ai_spend (scope, key, period, period_start) values (b.scope, b.spend_key, b.period, v_start)
      on conflict do nothing;
    select * into sp from public.ai_spend
      where scope = b.scope and key = b.spend_key and period = b.period and period_start = v_start for update;
    v_limit := coalesce(b.own_limit, b.default_limit);
    if v_limit is not null and sp.spent_micro_usd + sp.reserved_micro_usd + p_estimate_micro_usd > v_limit then
      return jsonb_build_object('ok', false, 'error', 'budget_exceeded', 'scope', b.scope, 'period', b.period);
    end if;
    v_charged := v_charged || jsonb_build_array(jsonb_build_object(
      'scope', b.scope, 'key', b.spend_key, 'period', b.period, 'period_start', v_start));
  end loop;

  for c in select value from jsonb_array_elements(v_charged) loop
    update public.ai_spend set reserved_micro_usd = reserved_micro_usd + p_estimate_micro_usd, updated_at = now()
      where scope = c ->> 'scope' and key = c ->> 'key' and period = c ->> 'period' and period_start = (c ->> 'period_start')::date;
  end loop;

  insert into public.ai_reservations (request_id, user_id, plan, task, model_id, estimate_micro_usd, charged)
  values (p_request_id, p_user_id, v_plan, p_task, p_model_id, p_estimate_micro_usd, v_charged)
  on conflict (request_id) do update set status = 'reserved', plan = excluded.plan, task = excluded.task,
    model_id = excluded.model_id, estimate_micro_usd = excluded.estimate_micro_usd, charged = excluded.charged,
    actual_micro_usd = null, clamped = false, created_at = now(), settled_at = null;
  return jsonb_build_object('ok', true, 'existing', false, 'status', 'reserved', 'estimate_micro_usd', p_estimate_micro_usd);
end $$;

-- Converts a reservation into actual spend. Tokens NULL = usage unknown (billable failure): charge the reserved
-- estimate. Cost is computed here from the model's stored prices; anything above the reservation is clamped + flagged.
create function public.settle_ai_budget(p_request_id text, p_model_id uuid, p_input_tokens integer, p_output_tokens integer,
  p_cached_input_tokens integer default 0, p_status text default 'settled', p_fallback_used boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_res public.ai_reservations;
  v_m public.ai_models;
  v_prov text;
  v_cached bigint;
  v_actual bigint;
  v_clamped boolean := false;
  c jsonb;
begin
  if p_status is null or p_status not in ('settled', 'failed_billable') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 or coalesce(p_cached_input_tokens, 0) < 0 then
    raise exception 'negative token usage' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_res:' || p_request_id, 0));
  select * into v_res from public.ai_reservations where request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;
  if v_res.status = 'settled' then
    return jsonb_build_object('ok', true, 'already', true, 'actual_micro_usd', v_res.actual_micro_usd, 'clamped', v_res.clamped);
  end if;
  if v_res.status = 'released' then
    return jsonb_build_object('ok', false, 'error', 'reservation_released');
  end if;

  select m.* into v_m from public.ai_models m where m.id = coalesce(p_model_id, v_res.model_id);
  if p_input_tokens is null or not found then
    v_actual := v_res.estimate_micro_usd;
  else
    v_cached := least(coalesce(p_cached_input_tokens, 0), p_input_tokens);
    v_actual := ((p_input_tokens - v_cached) * v_m.input_micro_usd_per_mtok
                 + v_cached * v_m.cached_input_micro_usd_per_mtok
                 + coalesce(p_output_tokens, 0)::bigint * v_m.output_micro_usd_per_mtok + 999999) / 1000000;
  end if;
  if v_actual > v_res.estimate_micro_usd then
    v_actual := v_res.estimate_micro_usd;
    v_clamped := true;
  end if;

  for c in select value from jsonb_array_elements(v_res.charged) loop
    update public.ai_spend
      set reserved_micro_usd = greatest(0, reserved_micro_usd - v_res.estimate_micro_usd),
          spent_micro_usd = spent_micro_usd + v_actual, updated_at = now()
      where scope = c ->> 'scope' and key = c ->> 'key' and period = c ->> 'period' and period_start = (c ->> 'period_start')::date;
  end loop;
  update public.ai_reservations set status = 'settled', actual_micro_usd = v_actual, clamped = v_clamped, settled_at = now(),
    model_id = coalesce(v_m.id, model_id) where request_id = p_request_id;

  select p.name into v_prov from public.ai_providers p where p.id = v_m.provider_id;
  insert into public.ai_usage (user_id, feature, model, input_tokens, output_tokens, cost_micro_usd, provider, task, model_id,
                               plan, cached_input_tokens, estimated_cost_micro_usd, request_id, status, fallback_used)
  values (v_res.user_id, coalesce(v_res.task, 'ai'), v_m.model, coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0),
          v_actual, v_prov, v_res.task, v_m.id, v_res.plan, coalesce(v_cached, 0), v_res.estimate_micro_usd, p_request_id,
          p_status, coalesce(p_fallback_used, false))
  on conflict (request_id) do update set feature = excluded.feature, model = excluded.model,
    input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, cost_micro_usd = excluded.cost_micro_usd,
    provider = excluded.provider, model_id = excluded.model_id, cached_input_tokens = excluded.cached_input_tokens,
    status = excluded.status, fallback_used = excluded.fallback_used
    where public.ai_usage.status = 'failed_unbilled';
  return jsonb_build_object('ok', true, 'already', false, 'actual_micro_usd', v_actual, 'clamped', v_clamped);
end $$;

-- For requests that were never sent (or were refused before any work). Idempotent.
create function public.release_ai_budget(p_request_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_released boolean;
  v_status text;
begin
  v_released := public.ai_release_internal(p_request_id);
  select status into v_status from public.ai_reservations where request_id = p_request_id;
  return jsonb_build_object('ok', v_status is not null, 'released', v_released, 'status', v_status);
end $$;

-- Releases reservations that never settled (crashed workers). Minimum age 5 minutes. Returns how many.
create function public.ai_sweep_orphan_reservations(p_minutes integer default 30) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  n integer := 0;
begin
  if p_minutes is null or p_minutes < 5 then
    raise exception 'minutes must be at least 5' using errcode = '22023';
  end if;
  for r in select request_id from public.ai_reservations
           where status = 'reserved' and created_at < now() - make_interval(mins => p_minutes) order by created_at loop
    if public.ai_release_internal(r.request_id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Fixed 60 s window counter per (user, task); limit comes from the user's plan route. One atomic statement.
create function public.ai_rate_limit_check(p_user_id uuid, p_task public.ai_task) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_limit integer;
  v_win timestamptz := date_trunc('minute', now());
  v_n integer;
begin
  select r.rate_limit_per_min into v_limit from public.ai_task_routes r
    where r.task = p_task and r.plan::text = public.ai_plan_of(p_user_id);
  if v_limit is null then
    return jsonb_build_object('ok', false, 'error', 'ai_not_configured', 'reason', 'no_route');
  end if;
  insert into public.ai_rate_limits as l (user_id, task, window_start, n) values (p_user_id, p_task::text, v_win, 1)
  on conflict (user_id, task) do update
    set window_start = v_win, n = case when l.window_start < v_win then 1 else l.n + 1 end
    where l.window_start < v_win or l.n < v_limit
  returning n into v_n;
  if v_n is null then
    return jsonb_build_object('ok', false, 'error', 'rate_limited',
                              'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_win + interval '1 minute' - now())))::integer));
  end if;
  return jsonb_build_object('ok', true, 'n', v_n, 'limit', v_limit);
end $$;

-- ---------------------------------------------------------------- admin cost views (aggregates, no content)
create function public.admin_ai_cost_breakdown(p_days integer, p_group text)
returns table (bucket text, requests bigint, input_tokens bigint, output_tokens bigint, cached_input_tokens bigint, cost_micro_usd bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'days must be between 1 and 366' using errcode = '22023';
  end if;
  if p_group is null or p_group not in ('day', 'model', 'provider', 'task', 'plan') then
    raise exception 'group must be day, model, provider, task or plan' using errcode = '22023';
  end if;
  return query
  select case p_group when 'day' then ((u.created_at at time zone 'Asia/Baku')::date)::text
                      when 'model' then coalesce(u.model, 'unknown')
                      when 'provider' then coalesce(u.provider, 'unknown')
                      when 'task' then coalesce(u.task, u.feature)
                      else coalesce(u.plan, 'unknown') end,
         count(*), coalesce(sum(u.input_tokens), 0)::bigint, coalesce(sum(u.output_tokens), 0)::bigint,
         coalesce(sum(u.cached_input_tokens), 0)::bigint, coalesce(sum(u.cost_micro_usd), 0)::bigint
  from public.ai_usage u
  where u.created_at >= now() - make_interval(days => p_days) and u.status <> 'failed_unbilled'
  group by 1 order by 1;
end $$;

create function public.admin_ai_top_spenders(p_days integer default 30, p_limit integer default 20)
returns table (user_id uuid, requests bigint, cost_micro_usd bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 or p_limit is null or p_limit not between 1 and 200 then
    raise exception 'days must be 1-366 and limit 1-200' using errcode = '22023';
  end if;
  return query
  select u.user_id, count(*), sum(u.cost_micro_usd)::bigint from public.ai_usage u
  where u.created_at >= now() - make_interval(days => p_days) and u.status <> 'failed_unbilled'
  group by u.user_id order by 3 desc, 1 limit p_limit;
end $$;

create function public.admin_ai_budget_utilisation()
returns table (scope text, key text, period text, period_start date, hard_limit_micro_usd bigint, spent_micro_usd bigint,
               reserved_micro_usd bigint, utilisation_pct numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  -- user-scope budgets are per user: the row reports the most-used user for the current period (no ids).
  return query
  select b.scope, b.key, b.period, public.ai_period_start(b.period), b.hard_limit_micro_usd,
         coalesce(max(s.spent_micro_usd), 0)::bigint, coalesce(max(s.reserved_micro_usd), 0)::bigint,
         case when b.hard_limit_micro_usd = 0 then null
              else round(100.0 * coalesce(max(s.spent_micro_usd + s.reserved_micro_usd), 0) / b.hard_limit_micro_usd, 2) end
  from public.ai_budgets b
  left join public.ai_spend s on s.scope = b.scope and s.period = b.period and s.period_start = public.ai_period_start(b.period)
       and ((b.scope = 'user' and b.key = '*') or s.key = b.key)
  group by b.scope, b.key, b.period, b.hard_limit_micro_usd order by b.scope, b.key, b.period;
end $$;

create function public.admin_ai_failure_rates(p_days integer default 30)
returns table (task text, requests bigint, failed_billable bigint, failed_unbilled bigint, fallback_used bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'days must be between 1 and 366' using errcode = '22023';
  end if;
  return query
  select coalesce(u.task, u.feature), count(*), count(*) filter (where u.status = 'failed_billable'),
         count(*) filter (where u.status = 'failed_unbilled'), count(*) filter (where u.fallback_used)
  from public.ai_usage u where u.created_at >= now() - make_interval(days => p_days) group by 1 order by 1;
end $$;

create function public.admin_ai_stuck_reservations(p_minutes integer default 30)
returns table (request_id text, user_id uuid, task text, estimate_micro_usd bigint, age_minutes integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 then
    raise exception 'minutes must be positive' using errcode = '22023';
  end if;
  return query
  select r.request_id, r.user_id, r.task, r.estimate_micro_usd, (extract(epoch from now() - r.created_at) / 60)::integer
  from public.ai_reservations r
  where r.status = 'reserved' and r.created_at < now() - make_interval(mins => p_minutes) order by r.created_at;
end $$;

-- ---------------------------------------------------------------- function grants
revoke all on function
  public.ai_tier_rank(text), public.ai_plan_of(uuid), public.ai_period_start(text), public.ai_config_snapshot(),
  public.ai_load_config(), public.ai_validate_routes(), public.ai_cfg_commit(text, text, text, jsonb, jsonb, jsonb),
  public.ai_require_admin(), public.ai_release_internal(text),
  public.admin_set_ai_provider(text, text, boolean, text),
  public.admin_set_ai_model(uuid, text, text, bigint, bigint, bigint, integer, boolean, boolean),
  public.admin_set_ai_route(public.ai_task, public.sub_plan, uuid, uuid[], integer),
  public.admin_delete_ai_route(public.ai_task, public.sub_plan),
  public.admin_set_ai_budget(text, text, text, bigint), public.admin_delete_ai_budget(text, text, text),
  public.admin_revert_config(bigint, text),
  public.reserve_ai_budget(text, uuid, text, bigint, text, uuid),
  public.settle_ai_budget(text, uuid, integer, integer, integer, text, boolean), public.release_ai_budget(text),
  public.ai_sweep_orphan_reservations(integer), public.ai_rate_limit_check(uuid, public.ai_task),
  public.admin_ai_cost_breakdown(integer, text), public.admin_ai_top_spenders(integer, integer),
  public.admin_ai_budget_utilisation(), public.admin_ai_failure_rates(integer), public.admin_ai_stuck_reservations(integer)
  from public, anon, authenticated, service_role;

-- Pipeline (service_role only).
grant execute on function
  public.ai_load_config(), public.reserve_ai_budget(text, uuid, text, bigint, text, uuid),
  public.settle_ai_budget(text, uuid, integer, integer, integer, text, boolean), public.release_ai_budget(text),
  public.ai_sweep_orphan_reservations(integer), public.ai_rate_limit_check(uuid, public.ai_task)
  to service_role;
-- Admin RPCs and views: authenticated callers, each guarded by is_admin() inside.
grant execute on function
  public.admin_set_ai_provider(text, text, boolean, text),
  public.admin_set_ai_model(uuid, text, text, bigint, bigint, bigint, integer, boolean, boolean),
  public.admin_set_ai_route(public.ai_task, public.sub_plan, uuid, uuid[], integer),
  public.admin_delete_ai_route(public.ai_task, public.sub_plan),
  public.admin_set_ai_budget(text, text, text, bigint), public.admin_delete_ai_budget(text, text, text),
  public.admin_revert_config(bigint, text),
  public.admin_ai_cost_breakdown(integer, text), public.admin_ai_top_spenders(integer, integer),
  public.admin_ai_budget_utilisation(), public.admin_ai_failure_rates(integer), public.admin_ai_stuck_reservations(integer)
  to authenticated;
