create table public.resources (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  university_id uuid references public.universities(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  kind public.resource_kind not null default 'note',
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  storage_path text,
  visibility public.resource_visibility not null default 'private',
  status public.content_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resources_course_idx on public.resources(course_id);
create index resources_uploader_idx on public.resources(uploader_id);
create index resources_university_idx on public.resources(university_id) where status = 'published';

create table public.resource_ratings (
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (resource_id, user_id)
);

create table public.resource_saves (
  resource_id uuid not null references public.resources(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (resource_id, user_id)
);
create index resource_saves_user_idx on public.resource_saves(user_id);

create table public.takedown_requests (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.resources(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 10 and 4000),
  status public.takedown_status not null default 'open',
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null))
);
create index takedown_resource_idx on public.takedown_requests(resource_id);
create index takedown_open_idx on public.takedown_requests(created_at) where status = 'open';

-- Shared by resources and events: only moderators may change moderation status.
create function public.guard_moderated_status() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_moderator() then
    if tg_op = 'INSERT' and new.status <> 'pending' then
      raise exception 'new content must start as pending' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      raise exception 'only moderators may change status' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger resources_guard_status before insert or update on public.resources
  for each row execute function public.guard_moderated_status();
