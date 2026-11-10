-- Gamification, step 2: award_xp_internal now runs the achievement/challenge evaluation after every award or streak
-- update (the only place XP and streaks change). Body is identical to 20260101003500 except the added `perform` line
-- before the final return. Grants are unchanged (create or replace keeps them).
create or replace function public.award_xp_internal(p_uid uuid, p_kind text, p_ref_id uuid, p_when timestamptz default null) returns jsonb
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

  perform public.evaluate_achievements(p_uid);
  return jsonb_build_object('awarded', v_award, 'earned_today', v_earned + v_award, 'streak', v_new_streak);
end $$;
