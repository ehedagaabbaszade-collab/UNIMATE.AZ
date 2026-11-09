-- Subscription expiry. Postgres 15 syntax only.
--
-- The expiry of a subscription is current_period_end (exposed as the generated column expires_at). null = no expiry
-- (provider-managed paid subscriptions; none exist yet). Manual admin grants MUST carry an expiry.
-- effective_plan() is the ONE place plans are derived; every reader (ai_plan_of -> budgets / rate limits / routes,
-- the pipeline getPlan -> entitlements / quota, admin stats) goes through it. expire_subscriptions() flips status to
-- 'expired' so the stored state converges on the effective one.
--
-- Scheduling: pg_cron is scheduled below ONLY if the extension is installed. Otherwise call expire_subscriptions() from
-- a scheduled edge function (service role: sb.rpc('expire_subscriptions')) every 5-15 minutes. Correctness does not
-- depend on the sweeper: effective_plan() already ignores expired rows; the sweeper only tidies state, audits and notifies.

alter table public.subscriptions add column expires_at timestamptz generated always as (current_period_end) stored;

-- Existing manual grants without an expiry get 30 days from this migration (they were unlimited before; documented).
update public.subscriptions set current_period_end = public.now_utc() + interval '30 days'
  where source = 'manual' and current_period_end is null;
alter table public.subscriptions add constraint subscriptions_manual_has_expiry
  check (source <> 'manual' or current_period_end is not null) not valid;
alter table public.subscriptions validate constraint subscriptions_manual_has_expiry;

-- p_at: evaluation instant (default now_utc()). The pipeline passes its injectable clock.
create function public.effective_plan(p_user_id uuid, p_at timestamptz default null) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select s.plan::text from public.subscriptions s
    where s.user_id = p_user_id and s.status in ('active', 'trialing')
      and (s.source <> 'manual' or s.current_period_end is not null)
      and (s.current_period_end is null or s.current_period_end > coalesce(p_at, public.now_utc()))
    order by case s.plan::text when 'pro' then 3 when 'plus' then 2 else 1 end desc limit 1), 'free')
$$;
-- Not callable by API roles: it would let a user read another user's plan. Users read their own through my_plan().
revoke all on function public.effective_plan(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.effective_plan(uuid, timestamptz) to service_role;

create function public.my_plan() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select public.effective_plan(auth.uid())
$$;
revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated, service_role;

-- Every AI path (budgets, rate limits, routes) reads the plan here. create or replace keeps the existing grants.
create or replace function public.ai_plan_of(p_user_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select public.effective_plan(p_user_id)
$$;

create or replace function public.admin_subscriptions_by_plan() returns table (plan public.sub_plan, source text, n integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  return query select s.plan, s.source, count(*)::integer from public.subscriptions s
    where s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > public.now_utc())
    group by s.plan, s.source order by s.plan, s.source;
end $$;

-- Admin grants: is_admin() stays the first check. A future expiry is mandatory (max 1 year unless super_admin).
create or replace function public.admin_grant_plan(p_user_id uuid, p_plan public.sub_plan, p_until timestamptz, p_reason text)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_now timestamptz := public.now_utc();
  r record;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_plan is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'plan and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  if p_plan <> 'free' then
    if p_until is null then
      raise exception 'until is required: manual grants must expire' using errcode = '22023';
    end if;
    if p_until <= v_now then
      raise exception 'until must be in the future' using errcode = '22023';
    end if;
    if p_until > v_now + interval '1 year' and not public.is_super_admin() then
      raise exception 'until may be at most 1 year ahead (super_admin may grant longer)' using errcode = '22023';
    end if;
  end if;
  if p_user_id is null or not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sub:' || p_user_id::text, 0));
  if exists (select 1 from public.subscriptions
             where user_id = p_user_id and source = 'paid' and status in ('active', 'trialing', 'past_due')
               and (current_period_end is null or current_period_end > v_now)) then
    raise exception 'user has a live paid subscription' using errcode = '55000';
  end if;
  -- A lapsed row that the sweeper has not reached yet still occupies subscriptions_one_live: settle it first (same
  -- audit trail as expire_subscriptions), otherwise the insert below would fail with a duplicate key.
  for r in select s.id, s.plan, s.source, s.status, s.current_period_end from public.subscriptions s
           where s.user_id = p_user_id and s.status in ('active', 'trialing', 'past_due')
             and s.current_period_end is not null and s.current_period_end <= v_now for update
  loop
    update public.subscriptions set status = 'expired', cancel_at_period_end = false, updated_at = now() where id = r.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_actor, 'subscription.expired', 'subscription', r.id::text,
            jsonb_build_object('user_id', p_user_id, 'plan', r.plan, 'source', r.source, 'previous_status', r.status,
                               'expired_at', r.current_period_end, 'via', 'admin_grant_plan'));
  end loop;
  update public.subscriptions set status = 'canceled', cancel_at_period_end = false
    where user_id = p_user_id and source = 'manual' and status in ('active', 'trialing', 'past_due');
  if p_plan <> 'free' then
    insert into public.subscriptions (user_id, plan, status, provider, current_period_start, current_period_end,
                                      source, granted_by, grant_reason)
    values (p_user_id, p_plan, 'active', 'manual', v_now, p_until, 'manual', v_actor, btrim(p_reason))
    returning id into v_id;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'plan.grant', 'user', p_user_id::text,
          jsonb_build_object('plan', p_plan, 'until', p_until, 'reason', btrim(p_reason), 'source', 'manual'));
  return v_id;
end $$;

-- Idempotent sweeper: only live-status rows whose expiry has passed are touched; a second run finds nothing.
-- Service role / pg_cron only (audit actor is null = system).
create function public.expire_subscriptions(p_limit integer default 1000) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_now timestamptz := public.now_utc();
  v_n integer := 0;
begin
  for r in select s.id, s.user_id, s.plan, s.source, s.status, s.current_period_end from public.subscriptions s
           where s.status in ('active', 'trialing', 'past_due') and s.current_period_end is not null and s.current_period_end <= v_now
           order by s.current_period_end
           limit greatest(1, least(coalesce(p_limit, 1000), 10000))
           for update skip locked
  loop
    update public.subscriptions set status = 'expired', cancel_at_period_end = false, updated_at = now() where id = r.id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'subscription.expired', 'subscription', r.id::text,
            jsonb_build_object('user_id', r.user_id, 'plan', r.plan, 'source', r.source, 'previous_status', r.status,
                               'expired_at', r.current_period_end));
    if r.plan <> 'free' then
      perform public.notify_user(r.user_id, 'plan_expired', jsonb_build_object('plan', upper(r.plan::text)), 'billing');
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.expire_subscriptions(integer) from public, anon, authenticated;
grant execute on function public.expire_subscriptions(integer) to service_role;

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.schedule('expire-subscriptions', '*/10 * * * *', 'select public.expire_subscriptions()')$cron$;
  else
    raise notice 'pg_cron is not installed: schedule public.expire_subscriptions() from a scheduled edge function instead';
  end if;
end $do$;
