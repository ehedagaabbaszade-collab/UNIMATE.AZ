create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  title text check (title is null or length(title) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_user_idx on public.conversations(user_id, updated_at desc);
create index conversations_document_idx on public.conversations(document_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role public.message_role not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  model text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  feedback smallint check (feedback is null or feedback in (-1, 1)),
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages(conversation_id, created_at);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quizzes_user_idx on public.quizzes(user_id);
create index quizzes_document_idx on public.quizzes(document_id);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null check (position >= 0),
  kind public.question_kind not null default 'mcq',
  prompt text not null,
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  answer text not null,
  explanation text,
  created_at timestamptz not null default now(),
  unique (quiz_id, position),
  check (kind <> 'mcq' or options is not null)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null default 0 check (score >= 0),
  max_score integer not null check (max_score >= 0),
  answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  check (score <= max_score),
  check (completed_at is null or completed_at >= started_at)
);
create index attempts_quiz_idx on public.attempts(quiz_id);
create index attempts_user_idx on public.attempts(user_id, started_at desc);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  front text not null check (length(btrim(front)) > 0),
  back text not null check (length(btrim(back)) > 0),
  due_at timestamptz not null default now(),
  ease numeric(4,2) not null default 2.5 check (ease between 1.3 and 5),
  interval_days integer not null default 0 check (interval_days >= 0),
  repetitions integer not null default 0 check (repetitions >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index flashcards_due_idx on public.flashcards(user_id, due_at);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index study_sessions_user_idx on public.study_sessions(user_id, started_at desc);
