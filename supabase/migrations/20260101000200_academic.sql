create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 2 and 200),
  short_name text check (short_name is null or length(btrim(short_name)) between 1 and 30),
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.faculties (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, name)
);
create index faculties_university_idx on public.faculties(university_id);

create table public.majors (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references public.faculties(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 200),
  degree_level text not null default 'bachelor' check (degree_level in ('bachelor', 'master', 'phd')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (faculty_id, name, degree_level)
);
create index majors_faculty_idx on public.majors(faculty_id);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  major_id uuid references public.majors(id) on delete set null,
  code text not null check (length(btrim(code)) between 1 and 30),
  title text not null check (length(btrim(title)) between 2 and 200),
  credits numeric(3,1) check (credits is null or credits between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (university_id, code)
);
create index courses_major_idx on public.courses(major_id);
