-- Security hardening round. Postgres 15 syntax only. Every function below is CREATE OR REPLACE with the signature of
-- the migration that first defined it (grants are preserved); no applied migration is edited.
--   1. account purge: claim / failure / completion RPCs, attempt-aware due list, cancel respects an active claim
--   2. AI ledger: uncapped settle, orphan sweeper bills at the estimate, request_id owner check on every status
--   3. quiz XP: durable first-attempt record students cannot delete, per (quiz, user) advisory lock
--   4. NITs: single-pass template rendering, mandatory revert reason, system_content.updated_by not public

-- ---------------------------------------------------------------- 1. account purge
alter table public.account_deletion_requests
  add column purge_attempts integer not null default 0 check (purge_attempts >= 0),
  add column last_purge_attempt_at timestamptz,
  add column last_purge_error text check (last_purge_error is null or length(last_purge_error) <= 200),
  add column purge_claimed_at timestamptz;

-- Stuck users (storage cap hit, deleteUser failing) sort AFTER fresh ones, so they never starve later purges.
-- A claim older than 30 minutes is treated as a crashed worker and may be taken again.
create or replace function public.due_account_deletions(p_limit integer default 50) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select user_id from public.account_deletion_requests
  where status = 'pending' and scheduled_for <= now()
    and (purge_claimed_at is null or purge_claimed_at < now() - interval '30 minutes')
  order by purge_attempts, coalesce(last_purge_attempt_at, '-infinity'::timestamptz), scheduled_for
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;

-- Atomic re-check + mark: true only if the request is still pending AND due AND not claimed by a live worker. While
-- claimed, cancel_account_deletion refuses, so the user can no longer be cancelled between this call and deleteUser.
create function public.claim_account_purge(p_user_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  update public.account_deletion_requests set purge_claimed_at = now()
    where user_id = p_user_id and status = 'pending' and scheduled_for <= now()
      and (purge_claimed_at is null or purge_claimed_at < now() - interval '30 minutes')
    returning id into v_id;
  return v_id is not null;
end $$;

create function public.record_account_purge_failure(p_user_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n integer;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'unknown'), 200);
begin
  update public.account_deletion_requests set purge_attempts = purge_attempts + 1, last_purge_attempt_at = now(),
      last_purge_error = v_reason, purge_claimed_at = null
    where user_id = p_user_id and status = 'pending'
    returning purge_attempts into v_n;
  if found then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'account.purge_failed', 'user', p_user_id::text,
            jsonb_build_object('via', 'purge-accounts', 'reason', v_reason, 'attempts', v_n));
  end if;
end $$;

-- Called by purge-accounts AFTER deleteUser succeeded (the request row has cascaded away with the profile).
create function public.record_account_purged(p_user_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'account still exists' using errcode = '55000';
  end if;
  if not exists (select 1 from public.audit_logs where action = 'account.purged' and entity_type = 'user' and entity_id = p_user_id::text) then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'account.purged', 'user', p_user_id::text, jsonb_build_object('via', 'purge-accounts'));
  end if;
end $$;

revoke all on function public.claim_account_purge(uuid), public.record_account_purge_failure(uuid, text),
  public.record_account_purged(uuid) from public, anon, authenticated;
grant execute on function public.claim_account_purge(uuid), public.record_account_purge_failure(uuid, text),
  public.record_account_purged(uuid) to service_role;

create or replace function public.cancel_account_deletion() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.account_deletion_requests set status = 'cancelled', cancelled_at = now()
    where user_id = v_uid and status = 'pending'
      and (purge_claimed_at is null or purge_claimed_at < now() - interval '30 minutes');
  if found then
    perform public.notify_user(v_uid, 'deletion_cancelled', '{}'::jsonb, 'account');
    return true;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------- 2. AI ledger
-- Same-id retries by ANOTHER user are refused whatever the old status (a released row used to be re-upserted and would
-- have charged the new caller's budgets under the old owner's id).
create or replace function public.reserve_ai_budget(p_request_id text, p_user_id uuid, p_plan text, p_estimate_micro_usd bigint,
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
  if found then
    if v_existing.user_id <> p_user_id then
      return jsonb_build_object('ok', false, 'error', 'request_id_conflict');
    end if;
    if v_existing.status <> 'released' then
      return jsonb_build_object('ok', true, 'existing', true, 'status', v_existing.status,
                                'estimate_micro_usd', v_existing.estimate_micro_usd);
    end if;
  end if;

  v_plan := public.ai_plan_of(p_user_id);
  if p_plan is not null and lower(p_plan) <> v_plan then
    return jsonb_build_object('ok', false, 'error', 'plan_mismatch');
  end if;
  if not exists (select 1 from public.ai_budgets where scope = 'global' and key = '*') then
    return jsonb_build_object('ok', false, 'error', 'ai_not_configured', 'reason', 'no_global_budget');
  end if;

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
    actual_micro_usd = null, clamped = false, created_at = now(), settled_at = null
    where public.ai_reservations.user_id = excluded.user_id;
  return jsonb_build_object('ok', true, 'existing', false, 'status', 'reserved', 'estimate_micro_usd', p_estimate_micro_usd);
end $$;

-- The ACTUAL cost is recorded uncapped: the excess over the reservation is real spend. `clamped` stays as the alert flag
-- ("actual exceeded the estimate"); the next reserve then sees spent + reserved and fails at the ceiling.
create or replace function public.settle_ai_budget(p_request_id text, p_model_id uuid, p_input_tokens integer, p_output_tokens integer,
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
  v_clamped := v_actual > v_res.estimate_micro_usd;

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

-- A reservation that never settled may belong to a worker that already called (and was billed by) the provider, so the
-- sweeper charges the ESTIMATE as failed_billable instead of refunding it. Returns how many were settled.
create or replace function public.ai_sweep_orphan_reservations(p_minutes integer default 30) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v jsonb;
  n integer := 0;
begin
  if p_minutes is null or p_minutes < 5 then
    raise exception 'minutes must be at least 5' using errcode = '22023';
  end if;
  for r in select request_id from public.ai_reservations
           where status = 'reserved' and created_at < now() - make_interval(mins => p_minutes) order by created_at loop
    v := public.settle_ai_budget(r.request_id, null, null, null, 0, 'failed_billable', false);
    if (v ->> 'ok')::boolean and not coalesce((v ->> 'already')::boolean, false) then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- 3. quiz XP: durable first-attempt record
-- Deliberately NOT a foreign key to quizzes/attempts (no cascade from rows students may delete); only the owner's
-- profile cascades (account purge). No API-role access at all.
create table public.quiz_first_attempts (
  quiz_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (quiz_id, user_id)
);
alter table public.quiz_first_attempts enable row level security;
revoke all on public.quiz_first_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.quiz_first_attempts to service_role;
create policy quiz_first_attempts_service_all on public.quiz_first_attempts for all to service_role using (true) with check (true);

insert into public.quiz_first_attempts (quiz_id, user_id, attempt_id, created_at)
select distinct on (a.quiz_id, a.user_id) a.quiz_id, a.user_id, a.id, a.started_at
from public.attempts a order by a.quiz_id, a.user_id, a.started_at, a.id
on conflict do nothing;

-- Students can no longer delete (or truncate) attempts: deleting them used to reset "first attempt" and the daily cap.
-- (Deleting a whole quiz still cascades; that is a different row set.) The UI never deletes attempts.
revoke delete, truncate on public.attempts from authenticated;

create or replace function public.submit_quiz_attempt(p_quiz_id uuid, p_answers jsonb, p_attempt_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := public.now_utc();
  v_attempt uuid := coalesce(p_attempt_id, gen_random_uuid());
  v_quiz public.quizzes;
  v_old public.attempts;
  q record;
  v_sub jsonb;
  v_idx integer;
  v_correct boolean;
  v_score integer := 0;
  v_max integer := 0;
  v_ungraded integer := 0;
  v_xp integer := 0;
  v_nq integer := 0;
  v_first boolean;
  v_award jsonb;
  v_results jsonb := '[]'::jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_quiz_id is null or p_answers is null or jsonb_typeof(p_answers) <> 'object' or pg_column_size(p_answers) > 100000 then
    raise exception 'quiz id and an answers object (<= 100 KB) are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('attempt:' || v_attempt::text, 0));
  select * into v_old from public.attempts where id = v_attempt;
  if found then
    if v_old.user_id <> v_uid or v_old.quiz_id <> p_quiz_id then
      raise exception 'attempt not found' using errcode = '42501';
    end if;
    return coalesce(v_old.result, jsonb_build_object('attempt_id', v_old.id, 'score', v_old.score, 'max_score', v_old.max_score))
           || jsonb_build_object('duplicate', true);
  end if;
  select * into v_quiz from public.quizzes where id = p_quiz_id and user_id = v_uid;
  if not found then
    raise exception 'quiz not found' using errcode = '42501';
  end if;
  -- Serialise ALL attempts of this (quiz, user) regardless of attempt id: concurrent submissions with different ids
  -- queue here and only the first one sees "no first attempt yet".
  perform pg_advisory_xact_lock(hashtextextended('quizfirst:' || p_quiz_id::text || ':' || v_uid::text, 0));
  -- XP only on the FIRST attempt of a quiz, ever: the durable record (not attempts, which a student could once delete)
  -- decides. Even an empty submission consumes the first attempt, because its result reveals the key.
  v_first := not exists (select 1 from public.quiz_first_attempts f where f.quiz_id = p_quiz_id and f.user_id = v_uid)
             and not exists (select 1 from public.attempts a where a.quiz_id = p_quiz_id and a.user_id = v_uid);
  if (select count(*) from public.attempts a where a.user_id = v_uid and a.started_at >= v_now - interval '1 day') >= 200 then
    raise exception 'too many attempts today' using errcode = '54000';
  end if;

  for q in select qq.id, qq.kind, qq.options, k.answer, k.explanation
           from public.questions qq left join public.question_keys k on k.question_id = qq.id
           where qq.quiz_id = p_quiz_id order by qq.position
  loop
    v_nq := v_nq + 1;
    v_sub := p_answers -> q.id::text;
    if v_sub is not null then
      v_clean := v_clean || jsonb_build_object(q.id::text, v_sub);
    end if;
    v_correct := null;
    if q.answer is null then
      v_ungraded := v_ungraded + 1;
    elsif q.kind = 'mcq' then
      v_max := v_max + 1;
      v_correct := false;
      if v_sub is not null and jsonb_typeof(v_sub) = 'number' and (v_sub #>> '{}') ~ '^[0-9]{1,3}$' then
        v_idx := (v_sub #>> '{}')::integer;
        v_correct := coalesce((q.options ->> v_idx) = q.answer, false);
      end if;
    elsif q.kind = 'true_false' then
      v_max := v_max + 1;
      v_correct := false;
      if v_sub is not null and jsonb_typeof(v_sub) in ('boolean', 'string') then
        v_correct := lower(btrim(v_sub #>> '{}')) = lower(btrim(q.answer));
      end if;
    else
      v_ungraded := v_ungraded + 1;
    end if;
    if v_correct is true then
      v_score := v_score + 1;
    end if;
    if v_correct is not null and v_sub is not null and v_quiz.server_generated and v_first then
      v_award := public.award_xp_internal(v_uid, case when v_correct then 'quiz_correct' else 'quiz_incorrect' end, q.id, v_now);
      v_xp := v_xp + coalesce((v_award ->> 'awarded')::integer, 0);
    end if;
    v_results := v_results || jsonb_build_object(
      'question_id', q.id, 'answered', v_sub is not null, 'correct', v_correct,
      'correct_answer', q.answer, 'explanation', q.explanation,
      'correct_option', case when q.kind = 'mcq' and q.answer is not null then
        (select t.ord - 1 from jsonb_array_elements_text(q.options) with ordinality as t(v, ord) where t.v = q.answer limit 1) end);
  end loop;
  if v_nq = 0 then
    raise exception 'quiz has no questions' using errcode = '22023';
  end if;

  v_res := jsonb_build_object('attempt_id', v_attempt, 'quiz_id', p_quiz_id, 'score', v_score, 'max_score', v_max,
                              'ungraded', v_ungraded, 'xp_awarded', v_xp, 'xp_eligible', (v_quiz.server_generated and v_first),
                              'results', v_results, 'duplicate', false);
  insert into public.attempts (id, quiz_id, user_id, score, max_score, answers, started_at, completed_at, result, xp_awarded)
  values (v_attempt, p_quiz_id, v_uid, v_score, v_max, v_clean, v_now, v_now, v_res, v_xp);
  if v_first then
    insert into public.quiz_first_attempts (quiz_id, user_id, attempt_id) values (p_quiz_id, v_uid, v_attempt)
    on conflict do nothing;
  end if;
  return v_res;
end $$;

-- ---------------------------------------------------------------- 4. NITs
-- Single pass over the TEMPLATE: substituted values are never scanned again, so a value containing "{other}" stays literal.
-- Unknown placeholders are left as written; a JSON null value renders as ''.
create or replace function public.render_template_text(p_text text, p_params jsonb) returns text
language plpgsql immutable set search_path = pg_temp as $$
declare
  v_params jsonb := case when jsonb_typeof(p_params) = 'object' then p_params else '{}'::jsonb end;
  v_rest text := p_text;
  v_out text := '';
  v_m text[];
  v_lit text;
  v_pos integer;
begin
  if p_text is null then
    return null;
  end if;
  loop
    v_m := regexp_match(v_rest, '\{([^{}]+)\}');
    exit when v_m is null;
    v_lit := '{' || v_m[1] || '}';
    v_pos := strpos(v_rest, v_lit);
    v_out := v_out || left(v_rest, v_pos - 1)
             || case when v_params ? v_m[1] then coalesce(v_params ->> v_m[1], '') else v_lit end;
    v_rest := substr(v_rest, v_pos + length(v_lit));
  end loop;
  return v_out || v_rest;
end $$;

-- A reason is mandatory (validated BEFORE it is concatenated into the new version's reason).
create or replace function public.admin_revert_system_content(p_key text, p_locale text, p_version integer, p_reason text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_body jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  select body into v_body from public.system_content_versions where key = p_key and locale = p_locale and version = p_version;
  if not found then
    raise exception 'content version not found' using errcode = 'P0002';
  end if;
  return public.admin_set_system_content(p_key, p_locale, v_body, left('revert to v' || p_version || ': ' || btrim(p_reason), 500));
end $$;

-- Public content is readable, the editor's identity is not: column grant instead of table-wide SELECT.
-- (Admins still see actors in system_content_versions.actor_id.)
revoke select on public.system_content from anon, authenticated;
grant select (key, locale, body, version, updated_at) on public.system_content to anon, authenticated;
