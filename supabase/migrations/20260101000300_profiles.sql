create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text check (username is null or username ~ '^[a-z0-9_]{3,30}$'),
  display_name text check (display_name is null or length(btrim(display_name)) between 1 and 80),
  avatar_url text,
  bio text check (bio is null or length(bio) <= 500),
  role public.app_role not null default 'student',
  university_id uuid references public.universities(id) on delete set null,
  major_id uuid references public.majors(id) on delete set null,
  study_year smallint check (study_year is null or study_year between 1 and 8),
  locale text not null default 'az' check (locale in ('az', 'en', 'ru')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));
create index profiles_university_idx on public.profiles(university_id);
create index profiles_role_idx on public.profiles(role) where role <> 'student';

-- Role helpers. SECURITY DEFINER so policies on profiles cannot recurse.
create function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid()
$$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('admin', 'super_admin'), false)
$$;
create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role from public.profiles where id = auth.uid()) = 'super_admin', false)
$$;
create function public.is_moderator() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role from public.profiles where id = auth.uid()) in ('moderator', 'admin', 'super_admin'), false)
$$;
revoke all on function public.current_app_role(), public.is_admin(), public.is_super_admin(), public.is_moderator() from public;
grant execute on function public.current_app_role(), public.is_admin(), public.is_super_admin(), public.is_moderator()
  to anon, authenticated, service_role;

-- API roles (anon/authenticated) may not escalate roles. Trusted roles (postgres, service_role) are unrestricted.
create function public.guard_profile_role() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.role <> 'student' then
        raise exception 'new profiles must have role student' using errcode = '42501';
      end if;
    else
      if new.id is distinct from old.id then
        raise exception 'profile id is immutable' using errcode = '42501';
      end if;
      if new.role is distinct from old.role then
        if new.role in ('admin', 'super_admin') or old.role in ('admin', 'super_admin') then
          if not public.is_super_admin() then
            raise exception 'only super_admin may grant or revoke admin roles' using errcode = '42501';
          end if;
        elsif not public.is_admin() then
          raise exception 'only admins may change roles' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger profiles_guard_role before insert or update on public.profiles
  for each row execute function public.guard_profile_role();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  term text not null check (length(btrim(term)) between 1 and 30),
  status public.enrollment_status not null default 'enrolled',
  grade numeric(5,2) check (grade is null or grade between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, course_id, term)
);
create index enrollments_course_idx on public.enrollments(course_id);
