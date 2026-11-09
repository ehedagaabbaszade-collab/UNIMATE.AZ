create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  due_at timestamptz,
  status public.task_status not null default 'todo',
  priority smallint not null default 2 check (priority between 1 and 3),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'done') = (completed_at is not null))
);
create index tasks_user_due_idx on public.tasks(user_id, due_at);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  starts_at timestamptz not null,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 720),
  location text,
  weight numeric(5,2) check (weight is null or weight between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exams_user_idx on public.exams(user_id, starts_at);

create table public.timetable_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  end_time time not null,
  location text,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (valid_from is null or valid_until is null or valid_until >= valid_from)
);
create index timetable_user_idx on public.timetable_entries(user_id, weekday, start_time);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  university_id uuid references public.universities(id) on delete set null,
  community_id uuid references public.communities(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 4000),
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status public.content_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index events_start_idx on public.events(starts_at) where status = 'published';
create index events_community_idx on public.events(community_id);
create trigger events_guard_status before insert or update on public.events
  for each row execute function public.guard_moderated_status();

-- Opportunities. No seed data: rows are curated by admins only.
create table public.job_listings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 200),
  company text not null check (length(btrim(company)) between 1 and 200),
  kind public.listing_kind not null default 'internship',
  location text,
  url text check (url is null or url ~ '^https?://'),
  description text check (description is null or length(description) <= 10000),
  deadline date,
  is_active boolean not null default true,
  posted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_listings_active_idx on public.job_listings(created_at desc) where is_active;
