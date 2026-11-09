-- Server-side quiz verification, atomic XP, server-validated flashcard review XP. Postgres 15 syntax only.
--
-- Threat closed: until now quiz correctness was client-attested (award_xp(kind) trusted the caller) and students could
-- insert their own questions/attempts. Now:
--   * the answer key lives in public.question_keys (no API-role access at all); questions.answer/explanation are
--     blanked by a trigger, so even a raw INSERT ... answer = '...' from trusted code ends up in the key table;
--   * students cannot insert/update questions or attempts; attempts are written only by submit_quiz_attempt;
--   * XP is awarded only inside submit_quiz_attempt (quizzes the pipeline created: quizzes.server_generated) and
--     review_flashcard; award_xp is no longer callable by API roles;
--   * generation_cache (which holds the raw quiz output incl. answer_index) is no longer readable by owners.
-- Open-ended (short_answer) questions are stored but never auto-graded and never earn XP. XP is paid only for the first
-- attempt of a quiz (retakes are graded but earn nothing).
-- Known limits: flashcards are student-authored, so card creation is bounded only by the per-day review cap (100) and the
-- 300 XP daily cap; quizzes created by students themselves (server_generated = false) are not XP-eligible.

-- ---------------------------------------------------------------- answer key table
create table public.question_keys (
  question_id uuid primary key references public.questions(id) on delete cascade deferrable initially deferred,
  answer text not null,
  explanation text,
  created_at timestamptz not null default now()
);
alter table public.question_keys enable row level security;
revoke all on public.question_keys from public, anon, authenticated;
grant select, insert, update, delete on public.question_keys to service_role;
-- No policy for anon/authenticated = deny all. Service role only (bypasses RLS; the policy documents intent).
create policy question_keys_service_all on public.question_keys for all to service_role using (true) with check (true);

-- Backfill from existing rows BEFORE the trigger exists.
insert into public.question_keys (question_id, answer, explanation) select id, answer, explanation from public.questions
  on conflict (question_id) do nothing;
update public.questions set answer = '', explanation = null where answer <> '' or explanation is not null;

create function public.questions_move_key() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    insert into public.question_keys (question_id, answer, explanation) values (new.id, new.answer, new.explanation);
  elsif new.answer <> '' or new.explanation is not null then
    insert into public.question_keys (question_id, answer, explanation)
    values (new.id, case when new.answer <> '' then new.answer else '' end, new.explanation)
    on conflict (question_id) do update set
      answer = case when excluded.answer <> '' then excluded.answer else public.question_keys.answer end,
      explanation = coalesce(excluded.explanation, public.question_keys.explanation);
  end if;
  new.answer := '';
  new.explanation := null;
  return new;
end $$;
revoke all on function public.questions_move_key() from public, anon, authenticated;
create trigger questions_move_key before insert or update on public.questions
  for each row execute function public.questions_move_key();

-- Students never write questions or attempts. (Delete stays: owners may remove their own quizzes' rows.)
revoke insert, update on public.questions from authenticated;
revoke insert, update on public.attempts from authenticated;

-- Raw quiz output (with answer_index) sits in generation_cache; owners have no need to read it.
drop policy generation_cache_owner_select on public.generation_cache;
revoke select on public.generation_cache from authenticated;
create policy generation_cache_service_select on public.generation_cache for select to service_role using (true);

-- ---------------------------------------------------------------- quizzes: server-generated flag
alter table public.quizzes add column server_generated boolean not null default false;
alter table public.quizzes add column generation_hash text check (generation_hash is null or length(generation_hash) between 8 and 128);
create unique index quizzes_generation_key on public.quizzes (user_id, document_id, generation_hash)
  where generation_hash is not null;

create function public.quizzes_guard_server_fields() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.server_generated := false;
      new.generation_hash := null;
    else
      new.server_generated := old.server_generated;
      new.generation_hash := old.generation_hash;
    end if;
  end if;
  return new;
end $$;
create trigger quizzes_guard_server_fields before insert or update on public.quizzes
  for each row execute function public.quizzes_guard_server_fields();

alter table public.attempts add column result jsonb;
alter table public.attempts add column xp_awarded integer not null default 0 check (xp_awarded >= 0);

-- ---------------------------------------------------------------- flashcards: SRS state is server-owned
-- Owners may still edit text; schedule fields (due_at, ease, interval_days, repetitions) change only through
-- review_flashcard, so a client cannot make a card "due" again to farm XP.
revoke update on public.flashcards from authenticated;
grant update (front, back, document_id) on public.flashcards to authenticated;

-- ---------------------------------------------------------------- XP core (internal, never exposed)
-- Same rules as before (mirrors packages/core gamification/xp.ts): quizCorrect 10, quizIncorrect 1, reviewCompleted 25,
-- streak bonus 2/day capped at 10 days (correct + review only), soft cap 150 (x0.5 at/after), daily cap 300, per
-- Asia/Baku day. Serialisation: an advisory xact lock per (user, Baku day) is taken FIRST, so concurrent awards for the
-- same user and day queue up and each sees the previous one's xp_events/streak rows; the unique source_key index plus
-- ON CONFLICT DO NOTHING is the second line of defence. amount is never client-supplied.
create function public.award_xp_internal(p_uid uuid, p_kind text, p_ref_id uuid, p_when timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_now timestamptz := coalesce(p_when, public.now_utc());
  v_today date := (v_now at time zone 'Asia/Baku')::date;
  v_day_start timestamptz := (v_today::timestamp at time zone 'Asia/Baku');
  v_day_end timestamptz := ((v_today + 1)::timestamp at time zone 'Asia/Baku');
  v_key text;
  v_earned integer;
  v_streak integer := 0;
  v_last date;
  v_cur integer;
  v_base integer;
  v_bonus boolean;
  v_raw numeric;
  v_award integer;
  v_new_streak integer;
  v_ins integer;
begin
  if p_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_kind is null or p_kind not in ('quiz_correct', 'quiz_incorrect', 'review_completed', 'idle') then
    raise exception 'unknown xp kind' using errcode = '22023';
  end if;
  if p_kind = 'idle' then
    return jsonb_build_object('awarded', 0, 'reason', 'idle');
  end if;
  if p_ref_id is null then
    raise exception 'ref_id required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('xp:' || p_uid::text || ':' || v_today::text, 0));

  if p_kind = 'review_completed' then
    if not exists (select 1 from public.flashcards f where f.id = p_ref_id and f.user_id = p_uid) then
      raise exception 'reference not found' using errcode = '42501';
    end if;
  elsif not exists (select 1 from public.questions q join public.quizzes z on z.id = q.quiz_id
                    where q.id = p_ref_id and z.user_id = p_uid) then
    raise exception 'reference not found' using errcode = '42501';
  end if;

  insert into public.streaks (user_id) values (p_uid) on conflict (user_id) do nothing;
  select s.current_streak, s.last_active_date into v_cur, v_last from public.streaks s where s.user_id = p_uid for update;
  if v_last is not null and v_last >= v_today - 1 then
    v_streak := v_cur;
  end if;

  v_key := p_ref_id::text || '@' || v_today::text;
  if exists (select 1 from public.xp_events e where e.user_id = p_uid and e.kind = p_kind and e.source_key = v_key) then
    return jsonb_build_object('awarded', 0, 'reason', 'duplicate');
  end if;

  select coalesce(sum(e.points), 0)::integer into v_earned from public.xp_events e
    where e.user_id = p_uid and e.created_at >= v_day_start and e.created_at < v_day_end;

  v_base := case p_kind when 'quiz_correct' then 10 when 'quiz_incorrect' then 1 else 25 end;
  v_bonus := p_kind in ('quiz_correct', 'review_completed');
  v_raw := v_base + (case when v_bonus then least(greatest(v_streak, 0), 10) * 2 else 0 end);
  if v_earned >= 150 then
    v_raw := v_raw * 0.5;
  end if;
  v_award := least(floor(v_raw)::integer, greatest(0, 300 - v_earned));

  if v_award > 0 then
    insert into public.xp_events (user_id, kind, points, source_key, created_at)
    values (p_uid, p_kind, v_award, v_key, v_now)
    on conflict (user_id, kind, source_key) where source_key is not null do nothing;
    get diagnostics v_ins = row_count;
    if v_ins = 0 then
      return jsonb_build_object('awarded', 0, 'reason', 'duplicate');
    end if;
  end if;

  v_new_streak := case when v_last = v_today then v_cur when v_last = v_today - 1 then v_cur + 1 else 1 end;
  update public.streaks set current_streak = v_new_streak,
      longest_streak = greatest(longest_streak, v_new_streak), last_active_date = v_today, updated_at = now()
    where user_id = p_uid;

  return jsonb_build_object('awarded', v_award, 'earned_today', v_earned + v_award, 'streak', v_new_streak);
end $$;
revoke all on function public.award_xp_internal(uuid, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.award_xp_internal(uuid, text, uuid, timestamptz) to service_role;

-- Client-callable XP is gone: a caller could claim any correctness. Kept as a stub so old clients get a clear error.
create or replace function public.award_xp(p_kind text, p_ref_id uuid, p_amount_hint integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'award_xp is server-only: use submit_quiz_attempt or review_flashcard' using errcode = '42501';
end $$;
revoke all on function public.award_xp(text, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- submit_quiz_attempt
-- answers: { "<question_id>": <mcq option index 0..n-1 | true/false | text> }. Unknown ids are ignored.
-- p_attempt_id (client generated) makes retries idempotent: the same id returns the stored result, never re-grades
-- and never re-awards. An id owned by another user or another quiz is refused.
create function public.submit_quiz_attempt(p_quiz_id uuid, p_answers jsonb, p_attempt_id uuid default null) returns jsonb
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
  -- XP only on the FIRST attempt of a quiz: the result of an attempt reveals the key, so any retake (even on a later
  -- day, when source_key resets) could be answered perfectly and would turn one quiz into a daily XP faucet.
  v_first := not exists (select 1 from public.attempts a where a.quiz_id = p_quiz_id and a.user_id = v_uid);
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
      v_ungraded := v_ungraded + 1; -- short_answer / open-ended: never auto-graded, never XP
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
  return v_res;
end $$;
revoke all on function public.submit_quiz_attempt(uuid, jsonb, uuid) from public, anon;
grant execute on function public.submit_quiz_attempt(uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------- review_flashcard
-- The ONLY way to advance a card's schedule. Mirrors packages/core study/srs.ts scheduleReview. A card that is not due
-- (due_at > now) changes nothing and earns nothing. XP: at most 100 rewarded reviews per Baku day (plus the shared
-- 300 XP daily cap and one award per card per day).
create function public.review_flashcard(p_card_id uuid, p_grade text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := public.now_utc();
  v_today date := (public.now_utc() at time zone 'Asia/Baku')::date;
  f public.flashcards;
  v_ease numeric;
  v_int integer;
  v_reps integer;
  v_award jsonb;
  v_xp integer := 0;
  v_reason text := null;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_grade is null or p_grade not in ('again', 'hard', 'good', 'easy') then
    raise exception 'grade must be again, hard, good or easy' using errcode = '22023';
  end if;
  select * into f from public.flashcards where id = p_card_id and user_id = v_uid for update;
  if not found then
    raise exception 'reference not found' using errcode = '42501';
  end if;
  if f.due_at > v_now then
    return jsonb_build_object('reviewed', false, 'awarded', 0, 'reason', 'not_due', 'due_at', f.due_at);
  end if;

  if p_grade = 'again' then
    v_ease := f.ease - 0.2; v_int := 0; v_reps := 0;
  elsif p_grade = 'hard' then
    v_int := case when f.repetitions = 0 then 1 else greatest(1, round(f.interval_days * 1.2)::integer) end;
    v_ease := f.ease - 0.15; v_reps := f.repetitions + 1;
  elsif p_grade = 'good' then
    v_int := case when f.repetitions = 0 then 1 when f.repetitions = 1 then 3
                  else greatest(f.interval_days + 1, round(f.interval_days * f.ease)::integer) end;
    v_ease := f.ease; v_reps := f.repetitions + 1;
  else
    v_int := case when f.repetitions = 0 then 3 when f.repetitions = 1 then 6
                  else greatest(f.interval_days + 1, round(f.interval_days * f.ease * 1.3)::integer) end;
    v_ease := f.ease + 0.15; v_reps := f.repetitions + 1;
  end if;
  v_ease := least(5, greatest(1.3, round(v_ease, 2)));

  update public.flashcards set ease = v_ease, interval_days = v_int, repetitions = v_reps, updated_at = now(),
    due_at = case when p_grade = 'again' then v_now + interval '10 minutes' else v_now + v_int * interval '1 day' end
    where id = f.id returning due_at into f.due_at;

  perform pg_advisory_xact_lock(hashtextextended('xp:' || v_uid::text || ':' || v_today::text, 0));
  if (select count(*) from public.xp_events e where e.user_id = v_uid and e.kind = 'review_completed'
        and e.created_at >= (v_today::timestamp at time zone 'Asia/Baku')
        and e.created_at < ((v_today + 1)::timestamp at time zone 'Asia/Baku')) >= 100 then
    v_reason := 'daily_review_cap';
  else
    v_award := public.award_xp_internal(v_uid, 'review_completed', f.id, v_now);
    v_xp := coalesce((v_award ->> 'awarded')::integer, 0);
    v_reason := v_award ->> 'reason';
  end if;
  return jsonb_build_object('reviewed', true, 'awarded', v_xp, 'reason', v_reason, 'due_at', f.due_at,
                            'interval_days', v_int, 'ease', v_ease, 'repetitions', v_reps);
end $$;
revoke all on function public.review_flashcard(uuid, text) from public, anon;
grant execute on function public.review_flashcard(uuid, text) to authenticated;
