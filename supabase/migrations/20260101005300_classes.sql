-- Teacher classes on top of campus study groups (no global teacher role): a class IS a private campus community
-- (kind 'group', invite code, memberships). Its owner/moderators act as the teacher(s); active members are students.
--
--  * Online exams: questions are published WITHOUT the answer key (class_exam_keys has no client access at all).
--    Starting, the time limit, one attempt per student and grading are enforced in SECURITY DEFINER functions, like
--    submit_quiz_attempt. Multiple choice is graded on submit; open answers are scored by the teacher afterwards.
--    Teachers cannot attempt their own class's exams.
--  * Assignments: the teacher posts a task; students hand in text and/or one file (private 'submissions' bucket,
--    path <uid>/<assignment_id>/<file>); the teacher grades with feedback. Students see only their own submission.
--
-- Every table is RPC-only (RLS on, no client grants). Explicit grants follow 20260101004900 so default-grant and
-- bare projects end identical. Postgres 15 syntax only.

-- ---------------------------------------------------------------- tables
create table public.class_exams (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  subject text not null default '' check (length(subject) <= 120),
  minutes integer not null check (minutes between 1 and 600),
  -- public part only: [{id, kind, text, options, points}]
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 100),
  max_score numeric not null check (max_score >= 0),
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  check (closes_at is null or closes_at > opens_at)
);
create index class_exams_community_idx on public.class_exams(community_id, created_at desc);

-- {question_id: correct option index} for multiple-choice questions. Never readable by clients.
create table public.class_exam_keys (
  exam_id uuid primary key references public.class_exams(id) on delete cascade,
  keys jsonb not null
);

create table public.class_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.class_exams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  answers jsonb not null default '{}'::jsonb, -- {question_id: option index | text}
  auto_score numeric not null default 0,
  open_scores jsonb not null default '{}'::jsonb, -- {question_id: points} set by the teacher
  unique (exam_id, user_id)
);
create index class_exam_attempts_user_idx on public.class_exam_attempts(user_id);

create table public.class_assignments (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 4000),
  due_at timestamptz,
  created_at timestamptz not null default now()
);
create index class_assignments_community_idx on public.class_assignments(community_id, created_at desc);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.class_assignments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (length(body) <= 8000),
  file_path text check (file_path is null or length(file_path) <= 400),
  file_name text check (file_name is null or length(file_name) <= 200),
  submitted_at timestamptz not null default now(),
  grade numeric check (grade is null or grade between 0 and 100),
  feedback text check (feedback is null or length(feedback) <= 2000),
  graded_at timestamptz,
  unique (assignment_id, user_id)
);
create index assignment_submissions_user_idx on public.assignment_submissions(user_id);

alter table public.class_exams enable row level security;
alter table public.class_exam_keys enable row level security;
alter table public.class_exam_attempts enable row level security;
alter table public.class_assignments enable row level security;
alter table public.assignment_submissions enable row level security;
-- Explicit deny-all policies: every read and write goes through the functions below.
create policy class_exams_none on public.class_exams for select to authenticated using (false);
create policy class_exam_keys_none on public.class_exam_keys for select to authenticated using (false);
create policy class_exam_attempts_none on public.class_exam_attempts for select to authenticated using (false);
create policy class_assignments_none on public.class_assignments for select to authenticated using (false);
create policy assignment_submissions_none on public.assignment_submissions for select to authenticated using (false);

-- ---------------------------------------------------------------- helpers
create function public.class_assert_teacher(p_community uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not exists (select 1 from public.communities c where c.id = p_community and c.kind = 'group') then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not public.is_community_mod(p_community) then
    raise exception 'only the class teacher can do this' using errcode = '42501';
  end if;
end $$;

-- Active member who is not a teacher of the class (teachers never sit or hand in their own class work).
create function public.class_assert_student(p_community uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.campus_uid();
  if not public.is_member(p_community) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if public.is_community_mod(p_community) then
    raise exception 'teachers cannot take their own class work' using errcode = '42501';
  end if;
end $$;

-- Points earned on the multiple-choice questions of one exam for a set of answers.
create function public.class_choice_score(p_exam uuid, p_answers jsonb) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum((q->>'points')::numeric), 0)
  from public.class_exams e
  join public.class_exam_keys k on k.exam_id = e.id
  cross join lateral jsonb_array_elements(e.questions) q
  where e.id = p_exam and q->>'kind' = 'choice'
    and jsonb_typeof(p_answers->(q->>'id')) = 'number'
    and (p_answers->>(q->>'id'))::numeric = (k.keys->>(q->>'id'))::numeric
$$;

-- Notifies every active student of a class (members that are not owner/moderator).
create function public.class_notify_students(p_community uuid, p_key text, p_params jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  for r in select m.user_id from public.memberships m
           where m.community_id = p_community and m.status = 'active' and m.role = 'member' loop
    perform public.campus_notify(r.user_id, p_key, p_params);
  end loop;
end $$;

-- Total of one attempt: multiple choice (graded on submit, or from the saved answers when time ran out without a
-- submit) plus the teacher's points for open answers.
create function public.class_attempt_total(p_attempt uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select case when a.submitted_at is null then public.class_choice_score(a.exam_id, a.answers) else a.auto_score end
       + coalesce((select sum(s.v::numeric) from jsonb_each_text(a.open_scores) s(k, v)), 0)
  from public.class_exam_attempts a where a.id = p_attempt
$$;

-- ---------------------------------------------------------------- exams (teacher)
-- p_questions: [{id, kind: 'choice'|'open', text, options[], correct, points}] as written in the app's exam editor.
create function public.publish_class_exam(p_community uuid, p_title text, p_subject text, p_minutes integer,
  p_questions jsonb, p_opens_at timestamptz default null, p_closes_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_id uuid;
  q jsonb;
  v_public jsonb := '[]'::jsonb;
  v_keys jsonb := '{}'::jsonb;
  v_max numeric := 0;
  v_ids text[] := '{}';
  v_kind text;
  v_opts jsonb;
  v_correct integer;
  v_points numeric;
begin
  perform public.class_assert_teacher(p_community);
  perform public.campus_rate_check('class_exam', interval '1 hour', 20);
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_subject, '')) > 120
     or p_minutes is null or p_minutes not between 1 and 600 then
    raise exception 'invalid exam' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_title, 'title');
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) not between 1 and 100 then
    raise exception 'an exam needs 1-100 questions' using errcode = '22023';
  end if;
  for q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q) is distinct from 'object' or jsonb_typeof(q->'points') is distinct from 'number' then
      raise exception 'invalid question' using errcode = '22023';
    end if;
    v_kind := q->>'kind';
    v_opts := coalesce(q->'options', '[]'::jsonb);
    v_points := (q->>'points')::numeric;
    if q->>'id' is null or length(q->>'id') not between 1 and 40 or q->>'id' = any(v_ids)
       or v_kind is null or v_kind not in ('choice', 'open') or length(coalesce(q->>'text', '')) not between 1 and 1000
       or jsonb_typeof(v_opts) <> 'array' or v_points < 0 or v_points > 100 then
      raise exception 'invalid question' using errcode = '22023';
    end if;
    v_ids := v_ids || (q->>'id');
    if v_kind = 'choice' then
      if jsonb_typeof(q->'correct') is distinct from 'number' or (q->>'correct')::numeric % 1 <> 0 then
        raise exception 'invalid multiple-choice question' using errcode = '22023';
      end if;
      v_correct := (q->>'correct')::integer;
      if jsonb_array_length(v_opts) not between 2 and 6 or v_correct < 0 or v_correct >= jsonb_array_length(v_opts)
         or exists (select 1 from jsonb_array_elements(v_opts) o where jsonb_typeof(o) <> 'string' or length(o #>> '{}') not between 1 and 300) then
        raise exception 'invalid multiple-choice question' using errcode = '22023';
      end if;
      v_keys := v_keys || jsonb_build_object(q->>'id', v_correct);
    else
      v_opts := '[]'::jsonb;
    end if;
    v_public := v_public || jsonb_build_array(jsonb_build_object('id', q->>'id', 'kind', v_kind, 'text', q->>'text', 'options', v_opts, 'points', v_points));
    v_max := v_max + v_points;
  end loop;
  if p_closes_at is not null and p_closes_at <= coalesce(p_opens_at, now()) then
    raise exception 'the exam must close after it opens' using errcode = '22023';
  end if;
  insert into public.class_exams (community_id, created_by, title, subject, minutes, questions, max_score, opens_at, closes_at)
  values (p_community, v_uid, btrim(p_title), btrim(coalesce(p_subject, '')), p_minutes, v_public, v_max,
          coalesce(p_opens_at, now()), p_closes_at)
  returning id into v_id;
  insert into public.class_exam_keys (exam_id, keys) values (v_id, v_keys);
  perform public.class_notify_students(p_community, 'class_exam_published', jsonb_build_object('title', btrim(p_title)));
  return v_id;
end $$;

create function public.delete_class_exam(p_exam uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c uuid;
begin
  select community_id into v_c from public.class_exams where id = p_exam;
  if v_c is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(v_c);
  delete from public.class_exams where id = p_exam;
  return true;
end $$;

-- Teacher: every attempt with the student's answers and both scores (for grading open answers).
create function public.class_exam_results(p_exam uuid) returns table (
  attempt_id uuid, user_id uuid, display_name text, started_at timestamptz, submitted_at timestamptz,
  answers jsonb, auto_score numeric, open_scores jsonb, total numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_c uuid;
begin
  select community_id into v_c from public.class_exams where id = p_exam;
  if v_c is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(v_c);
  return query
    select a.id, a.user_id, public.campus_display_name(a.user_id), a.started_at, a.submitted_at, a.answers,
           case when a.submitted_at is null then public.class_choice_score(a.exam_id, a.answers) else a.auto_score end,
           a.open_scores, public.class_attempt_total(a.id)
    from public.class_exam_attempts a where a.exam_id = p_exam
    order by a.submitted_at nulls last, a.started_at;
end $$;

-- Teacher: the published questions and the answer key ({question_id: option index}), to review and grade answers.
create function public.class_exam_key(p_exam uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_c uuid;
begin
  select community_id into v_c from public.class_exams where id = p_exam;
  if v_c is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(v_c);
  return (select jsonb_build_object('questions', e.questions, 'keys', k.keys)
          from public.class_exams e join public.class_exam_keys k on k.exam_id = e.id where e.id = p_exam);
end $$;

create function public.grade_class_exam_open(p_attempt uuid, p_question text, p_points numeric) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a record;
  v_max numeric;
begin
  select at.id, at.submitted_at, at.deadline_at, e.community_id, e.questions into a
  from public.class_exam_attempts at join public.class_exams e on e.id = at.exam_id where at.id = p_attempt;
  if a.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(a.community_id);
  if a.submitted_at is null and a.deadline_at > now() then
    raise exception 'the attempt is still in progress' using errcode = '22023';
  end if;
  select (q->>'points')::numeric into v_max from jsonb_array_elements(a.questions) q where q->>'id' = p_question and q->>'kind' = 'open';
  if v_max is null or p_points is null or p_points < 0 or p_points > v_max then
    raise exception 'points must be between 0 and the question''s points' using errcode = '22023';
  end if;
  update public.class_exam_attempts set open_scores = open_scores || jsonb_build_object(p_question, p_points) where id = p_attempt;
  return true;
end $$;

-- ---------------------------------------------------------------- exams (everyone in the class)
-- Students see their own status and score; teachers additionally get the number of submitted attempts.
create function public.list_class_exams(p_community uuid) returns table (
  id uuid, title text, subject text, minutes integer, question_count integer, max_score numeric,
  opens_at timestamptz, closes_at timestamptz, created_at timestamptz,
  my_status text, my_score numeric, my_pending_open boolean, attempt_count integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_teacher boolean := public.is_community_mod(p_community);
begin
  if not public.is_member(p_community) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
    select e.id, e.title, e.subject, e.minutes, jsonb_array_length(e.questions), e.max_score, e.opens_at, e.closes_at, e.created_at,
           case when a.id is null then 'not_started' when a.submitted_at is null and a.deadline_at > now() then 'in_progress' else 'submitted' end,
           case when a.submitted_at is not null or a.deadline_at <= now() then public.class_attempt_total(a.id) end,
           (a.id is not null and exists (select 1 from jsonb_array_elements(e.questions) q where q->>'kind' = 'open' and not a.open_scores ? (q->>'id'))),
           case when v_teacher then (select count(*)::integer from public.class_exam_attempts x where x.exam_id = e.id and x.submitted_at is not null) end
    from public.class_exams e
    left join public.class_exam_attempts a on a.exam_id = e.id and a.user_id = v_uid
    where e.community_id = p_community
    order by e.created_at desc;
end $$;

-- Starts (or resumes) the caller's single attempt. Returns the questions WITHOUT the key, the deadline and saved answers.
create function public.start_class_exam(p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  e record;
  a record;
begin
  select * into e from public.class_exams where id = p_exam;
  if e.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_student(e.community_id);
  if e.created_by = v_uid then
    raise exception 'teachers cannot take their own class work' using errcode = '42501';
  end if;
  select * into a from public.class_exam_attempts where exam_id = p_exam and user_id = v_uid;
  if a.id is not null and (a.submitted_at is not null or a.deadline_at <= now()) then
    raise exception 'you already took this exam' using errcode = '23505';
  end if;
  if a.id is null then
    if now() < e.opens_at or (e.closes_at is not null and now() >= e.closes_at) then
      raise exception 'the exam is not open' using errcode = '22023';
    end if;
    insert into public.class_exam_attempts (exam_id, user_id, deadline_at)
    values (p_exam, v_uid, least(now() + make_interval(mins => e.minutes), coalesce(e.closes_at, 'infinity'::timestamptz)))
    returning * into a;
  end if;
  return jsonb_build_object('attempt_id', a.id, 'deadline_at', a.deadline_at, 'title', e.title, 'minutes', e.minutes,
    'questions', e.questions, 'answers', a.answers);
end $$;

-- Saves the caller's answers; with p_final it submits and grades multiple choice. A 30 s grace covers network delay;
-- after it, only the answers saved before the deadline count.
create function public.submit_class_exam(p_attempt uuid, p_answers jsonb, p_final boolean default true) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  a record;
  v_answers jsonb;
  v_score numeric := 0;
  v_late boolean;
begin
  select at.id, at.exam_id, at.submitted_at, at.deadline_at, at.answers, e.questions, e.max_score, e.community_id into a
  from public.class_exam_attempts at join public.class_exams e on e.id = at.exam_id
  where at.id = p_attempt and at.user_id = v_uid
  for update of at;
  if a.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if a.submitted_at is not null then
    raise exception 'already submitted' using errcode = '23505';
  end if;
  perform public.class_assert_student(a.community_id);
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 200000 then
    raise exception 'invalid answers' using errcode = '22023';
  end if;
  v_late := now() > a.deadline_at + interval '30 seconds';
  v_answers := a.answers;
  if not v_late then
    -- keep only answers to this exam's questions: choice as an option index, open as text of at most 4000 chars
    v_answers := coalesce((select jsonb_object_agg(x.k, x.v) from jsonb_each(p_answers) x(k, v)
      where exists (select 1 from jsonb_array_elements(a.questions) qq where qq->>'id' = x.k
        and ((qq->>'kind' = 'choice' and jsonb_typeof(x.v) = 'number')
          or (qq->>'kind' = 'open' and jsonb_typeof(x.v) = 'string' and length(x.v #>> '{}') <= 4000)))), '{}'::jsonb);
  end if;
  if not p_final and not v_late then
    update public.class_exam_attempts set answers = v_answers where id = p_attempt;
    return jsonb_build_object('saved', true);
  end if;
  v_score := public.class_choice_score(a.exam_id, v_answers);
  update public.class_exam_attempts set answers = v_answers, auto_score = v_score, submitted_at = now() where id = p_attempt;
  return jsonb_build_object('score', v_score, 'max_score', a.max_score, 'late', v_late,
    'pending_open', exists (select 1 from jsonb_array_elements(a.questions) qq where qq->>'kind' = 'open'));
end $$;

-- ---------------------------------------------------------------- assignments
create function public.create_class_assignment(p_community uuid, p_title text, p_body text default '', p_due_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  perform public.class_assert_teacher(p_community);
  perform public.campus_rate_check('class_assignment', interval '1 hour', 30);
  if p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_body, '')) > 4000 then
    raise exception 'invalid assignment' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_title, 'title');
  perform public.campus_assert_text(p_body, 'body');
  insert into public.class_assignments (community_id, created_by, title, body, due_at)
  values (p_community, public.campus_uid(), btrim(p_title), btrim(coalesce(p_body, '')), p_due_at)
  returning id into v_id;
  perform public.class_notify_students(p_community, 'class_assignment_posted', jsonb_build_object('title', btrim(p_title)));
  return v_id;
end $$;

create function public.delete_class_assignment(p_assignment uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_c uuid;
begin
  select community_id into v_c from public.class_assignments where id = p_assignment;
  if v_c is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(v_c);
  delete from public.class_assignments where id = p_assignment;
  return true;
end $$;

create function public.list_class_assignments(p_community uuid) returns table (
  id uuid, title text, body text, due_at timestamptz, created_at timestamptz,
  my_body text, my_file_name text, my_submitted_at timestamptz, my_grade numeric, my_feedback text, submission_count integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_teacher boolean := public.is_community_mod(p_community);
begin
  if not public.is_member(p_community) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  return query
    select x.id, x.title, x.body, x.due_at, x.created_at, s.body, s.file_name, s.submitted_at, s.grade, s.feedback,
           case when v_teacher then (select count(*)::integer from public.assignment_submissions y where y.assignment_id = x.id) end
    from public.class_assignments x
    left join public.assignment_submissions s on s.assignment_id = x.id and s.user_id = v_uid
    where x.community_id = p_community
    order by x.created_at desc;
end $$;

-- Student: hand in (or replace, until graded) text and/or one file uploaded to submissions/<uid>/<assignment>/...
create function public.submit_assignment(p_assignment uuid, p_body text, p_file_path text default null, p_file_name text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := public.campus_uid();
  v_c uuid;
  v_id uuid;
begin
  select community_id into v_c from public.class_assignments where id = p_assignment;
  if v_c is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_student(v_c);
  perform public.campus_rate_check('assignment_submit', interval '1 hour', 30);
  if length(coalesce(p_body, '')) > 8000 or (btrim(coalesce(p_body, '')) = '' and p_file_path is null)
     or length(coalesce(p_file_name, '')) > 200 then
    raise exception 'write an answer or attach a file' using errcode = '22023';
  end if;
  if p_file_path is not null and (left(p_file_path, length(v_uid::text || '/' || p_assignment::text || '/')) <> v_uid::text || '/' || p_assignment::text || '/'
     or length(p_file_path) > 400 or position('..' in p_file_path) > 0) then
    raise exception 'invalid file path' using errcode = '22023';
  end if;
  if exists (select 1 from public.assignment_submissions where assignment_id = p_assignment and user_id = v_uid and graded_at is not null) then
    raise exception 'already graded' using errcode = '23505';
  end if;
  insert into public.assignment_submissions (assignment_id, user_id, body, file_path, file_name)
  values (p_assignment, v_uid, btrim(coalesce(p_body, '')), p_file_path, nullif(btrim(coalesce(p_file_name, '')), ''))
  -- a re-submission without a new file keeps the file handed in before
  on conflict (assignment_id, user_id) do update set body = excluded.body,
    file_path = coalesce(excluded.file_path, assignment_submissions.file_path),
    file_name = case when excluded.file_path is null then assignment_submissions.file_name else excluded.file_name end,
    submitted_at = now()
  where assignment_submissions.graded_at is null
  returning id into v_id;
  if v_id is null then
    raise exception 'already graded' using errcode = '23505';
  end if;
  return v_id;
end $$;

-- Teacher: all submissions of one assignment.
create function public.assignment_submissions_list(p_assignment uuid) returns table (
  id uuid, user_id uuid, display_name text, body text, file_path text, file_name text, submitted_at timestamptz,
  late boolean, grade numeric, feedback text, graded_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  x record;
begin
  select ca.id, ca.community_id, ca.due_at into x from public.class_assignments ca where ca.id = p_assignment;
  if x.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(x.community_id);
  return query
    select s.id, s.user_id, public.campus_display_name(s.user_id), s.body, s.file_path, s.file_name, s.submitted_at,
           (x.due_at is not null and s.submitted_at > x.due_at), s.grade, s.feedback, s.graded_at
    from public.assignment_submissions s where s.assignment_id = p_assignment order by s.submitted_at;
end $$;

create function public.grade_assignment(p_submission uuid, p_grade numeric, p_feedback text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s record;
begin
  select sb.id, sb.user_id, a.community_id, a.title into s
  from public.assignment_submissions sb join public.class_assignments a on a.id = sb.assignment_id where sb.id = p_submission;
  if s.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  perform public.class_assert_teacher(s.community_id);
  if p_grade is null or p_grade < 0 or p_grade > 100 or length(coalesce(p_feedback, '')) > 2000 then
    raise exception 'grade must be 0-100' using errcode = '22023';
  end if;
  perform public.campus_assert_text(p_feedback, 'feedback');
  update public.assignment_submissions set grade = p_grade, feedback = nullif(btrim(coalesce(p_feedback, '')), ''), graded_at = now()
  where id = p_submission;
  perform public.campus_notify(s.user_id, 'class_assignment_graded', jsonb_build_object('title', s.title, 'grade', p_grade::text));
  return true;
end $$;

-- ---------------------------------------------------------------- storage: assignment files
-- Private bucket, 20 MB, documents and images. Students write only under their own folder; the class teacher can read
-- the files handed in for their class (to create a signed URL); nobody else can list or read them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create function public.can_read_submission_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (storage.foldername(p_name))[1] = (select auth.uid())::text
      or exists (
        select 1 from public.class_assignments a
        where a.id::text = (storage.foldername(p_name))[2] and public.is_community_mod(a.community_id))
$$;

-- Writes: own folder, and the second folder must be an assignment of a class the caller belongs to (no free storage).
create function public.can_write_submission_object(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (storage.foldername(p_name))[1] = (select auth.uid())::text
     and exists (select 1 from public.class_assignments a
                 where a.id::text = (storage.foldername(p_name))[2] and public.is_member(a.community_id))
$$;
-- A file referenced by a submission is evidence: it cannot be overwritten or deleted (re-submit with a new file instead).
create function public.submission_file_locked(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.assignment_submissions s where s.file_path = p_name)
$$;

create policy submissions_bucket_select on storage.objects for select to authenticated
  using (bucket_id = 'submissions' and public.can_read_submission_object(name));
create policy submissions_bucket_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'submissions' and public.can_write_submission_object(name));
create policy submissions_bucket_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'submissions' and public.can_write_submission_object(name) and not public.submission_file_locked(name))
  with check (bucket_id = 'submissions' and public.can_write_submission_object(name) and not public.submission_file_locked(name));
create policy submissions_bucket_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'submissions' and (storage.foldername(name))[1] = (select auth.uid())::text and not public.submission_file_locked(name));

-- ---------------------------------------------------------------- notifications
insert into public.notification_templates (key, locale, title, body) values
  ('class_exam_published', 'az', 'Yeni imtahan', 'Müəlliminiz “{title}” imtahanını paylaşdı.'),
  ('class_exam_published', 'tr', 'Yeni sınav', 'Öğretmeniniz “{title}” sınavını paylaştı.'),
  ('class_exam_published', 'en', 'New exam', 'Your teacher published the exam “{title}”.'),
  ('class_exam_published', 'ru', 'Новый экзамен', 'Преподаватель опубликовал экзамен «{title}».'),
  ('class_assignment_posted', 'az', 'Yeni tapşırıq', 'Müəlliminiz “{title}” tapşırığını verdi.'),
  ('class_assignment_posted', 'tr', 'Yeni ödev', 'Öğretmeniniz “{title}” ödevini verdi.'),
  ('class_assignment_posted', 'en', 'New assignment', 'Your teacher posted the assignment “{title}”.'),
  ('class_assignment_posted', 'ru', 'Новое задание', 'Преподаватель выдал задание «{title}».'),
  ('class_assignment_graded', 'az', 'Tapşırıq qiymətləndirildi', '“{title}” tapşırığına {grade} bal verildi.'),
  ('class_assignment_graded', 'tr', 'Ödev notlandı', '“{title}” ödevine {grade} puan verildi.'),
  ('class_assignment_graded', 'en', 'Assignment graded', '“{title}” was graded: {grade} points.'),
  ('class_assignment_graded', 'ru', 'Задание оценено', 'За задание «{title}» выставлено {grade} баллов.')
on conflict do nothing;

-- ---------------------------------------------------------------- account export
-- These tables have no client grants, so the caller's own rows are read by a definer helper with explicit owner
-- filters; the public export stays SECURITY INVOKER like before.
create function public.export_my_data_classes() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'class_exam_attempts', coalesce((select jsonb_agg(jsonb_build_object('exam_id', a.exam_id, 'started_at', a.started_at,
        'submitted_at', a.submitted_at, 'answers', a.answers, 'auto_score', a.auto_score, 'open_scores', a.open_scores) order by a.started_at)
      from public.class_exam_attempts a where a.user_id = auth.uid()), '[]'),
    'assignment_submissions', coalesce((select jsonb_agg(jsonb_build_object('assignment_id', s.assignment_id, 'body', s.body,
        'file_name', s.file_name, 'submitted_at', s.submitted_at, 'grade', s.grade, 'feedback', s.feedback) order by s.submitted_at)
      from public.assignment_submissions s where s.user_id = auth.uid()), '[]'),
    'class_exams_created', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'questions', e.questions,
        'created_at', e.created_at) order by e.created_at) from public.class_exams e where e.created_by = auth.uid()), '[]'),
    'class_assignments_created', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body,
        'due_at', x.due_at, 'created_at', x.created_at) order by x.created_at) from public.class_assignments x where x.created_by = auth.uid()), '[]'))
  where auth.uid() is not null
$$;

alter function public.export_my_data() rename to export_my_data_pre_classes;
create function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select public.export_my_data_pre_classes() || coalesce(public.export_my_data_classes(), '{}'::jsonb)
$$;

-- ---------------------------------------------------------------- explicit grants (see 20260101004900)
revoke all on table public.class_exams, public.class_exam_keys, public.class_exam_attempts, public.class_assignments,
  public.assignment_submissions from public, anon, authenticated;
grant all on table public.class_exams, public.class_exam_keys, public.class_exam_attempts, public.class_assignments,
  public.assignment_submissions to service_role;

do $$
declare
  f text;
begin
  -- internal helpers: never callable from the API
  foreach f in array array['class_assert_teacher(uuid)', 'class_assert_student(uuid)', 'class_notify_students(uuid, text, jsonb)',
    'class_choice_score(uuid, jsonb)', 'class_attempt_total(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- signed-in API (each function checks membership / teacher itself); the storage policy helper and the export
  -- helpers run as the caller, so they need EXECUTE for authenticated too
  foreach f in array array[
    'publish_class_exam(uuid, text, text, integer, jsonb, timestamptz, timestamptz)', 'delete_class_exam(uuid)',
    'class_exam_results(uuid)', 'class_exam_key(uuid)', 'grade_class_exam_open(uuid, text, numeric)',
    'list_class_exams(uuid)', 'start_class_exam(uuid)', 'submit_class_exam(uuid, jsonb, boolean)',
    'create_class_assignment(uuid, text, text, timestamptz)', 'delete_class_assignment(uuid)',
    'list_class_assignments(uuid)', 'submit_assignment(uuid, text, text, text)',
    'assignment_submissions_list(uuid)', 'grade_assignment(uuid, numeric, text)',
    'can_read_submission_object(text)', 'can_write_submission_object(text)', 'submission_file_locked(text)', 'export_my_data()', 'export_my_data_pre_classes()', 'export_my_data_classes()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
