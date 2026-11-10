-- UNIMATE CAREER (opportunities, tracker, CV builder). Postgres 15 syntax only.
--  * organizations + opportunities are written ONLY through audited SECURITY DEFINER admin RPCs (moderator/admin); students
--    read published listings only. NO seed rows: every listing is created by an admin.
--  * Applications are EXTERNAL. opportunity_tracking is the student's own bookmark / self-tracking board; nothing is ever
--    submitted from here.
--  * cv_documents: owner-only RLS, structure validated again in SQL (career_cv_data_valid) and by zod in packages/core.
--  * career_ai_cache: service_role-only cache for the guarded AI features (cv-feedback, interview-prep).
-- Default privileges in this project grant ALL on new objects to API roles: everything is revoked and re-granted explicitly.

-- ---------------------------------------------------------------- validators
-- https only, ASCII host (use punycode for IDN), no credentials, no localhost / bare IP hosts, <= 2000 chars.
create function public.career_https_url(p text) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select p is not null and length(p) <= 2000
    and p ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
    and p !~* '^https://(localhost|[0-9.]+)(:|/|\?|#|$)'
$$;
grant execute on function public.career_https_url(text) to anon, authenticated, service_role;

create function public.career_valid_skills(p text[]) returns boolean
language sql immutable parallel safe set search_path = pg_catalog as $$
  select p is not null and cardinality(p) <= 30 and not exists (
    select 1 from unnest(p) t where t is null or length(btrim(t)) not between 1 and 50)
$$;
grant execute on function public.career_valid_skills(text[]) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- organizations
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  name_norm text not null default '',
  description text check (description is null or length(description) <= 4000),
  website text check (website is null or public.career_https_url(website)),
  -- Optional relative path of a logo in a future storage bucket; never a URL. Flat, safe characters only.
  logo_path text check (logo_path is null or (logo_path ~ '^[A-Za-z0-9/_.-]{1,300}$' and logo_path !~ '\.\.')),
  verified boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index organizations_name_norm_key on public.organizations(name_norm);

create function public.organizations_prepare() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.name := btrim(new.name);
  new.name_norm := public.notes_normalize(new.name);
  new.updated_at := now();
  return new;
end $$;
create trigger organizations_prepare before insert or update on public.organizations
  for each row execute function public.organizations_prepare();

-- ---------------------------------------------------------------- opportunities
create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  kind text not null check (kind in ('internship', 'junior_job', 'scholarship', 'exchange', 'competition', 'hackathon', 'career_event')),
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 10000),
  requirements text check (requirements is null or length(requirements) <= 4000),
  location text check (location is null or length(location) <= 200),
  remote boolean not null default false,
  deadline date,
  apply_url text not null check (public.career_https_url(apply_url)),
  skills text[] not null default '{}' check (public.career_valid_skills(skills)),
  languages text[] not null default '{}' check (languages <@ array['az', 'tr', 'en', 'ru']::text[] and cardinality(languages) <= 4),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  source_note text check (source_note is null or length(source_note) <= 500),
  skills_norm text[] not null default '{}',
  location_norm text not null default '',
  search_norm text not null default '',
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'archived' or ((status = 'published') = (published_at is not null)))
);
create index opportunities_feed_idx on public.opportunities(deadline nulls last, published_at desc) where status = 'published';
create index opportunities_org_idx on public.opportunities(organization_id);
create index opportunities_kind_idx on public.opportunities(kind) where status = 'published';

create function public.opportunities_prepare() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.skills_norm := coalesce((select array_agg(distinct public.notes_normalize(s)) from unnest(new.skills) s), '{}');
  new.location_norm := public.notes_normalize(new.location);
  new.search_norm := public.notes_normalize(concat_ws(' ', new.title, array_to_string(new.skills, ' '), new.description, new.requirements));
  new.updated_at := now();
  return new;
end $$;
create trigger opportunities_prepare before insert or update on public.opportunities
  for each row execute function public.opportunities_prepare();

-- ---------------------------------------------------------------- opportunity_tracking (the student's own board)
create table public.opportunity_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- set null on admin delete: the student keeps their row (and notes) through the snapshot columns below.
  opportunity_id uuid references public.opportunities(id) on delete set null,
  status text not null default 'saved' check (status in ('saved', 'applied', 'interview', 'offer', 'rejected')),
  notes text check (notes is null or length(notes) <= 2000),
  applied_at timestamptz,
  snapshot_title text not null check (length(snapshot_title) between 1 and 200),
  snapshot_organization text not null check (length(snapshot_organization) between 1 and 200),
  snapshot_kind text not null,
  snapshot_deadline date,
  snapshot_apply_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index opportunity_tracking_user_opp_key on public.opportunity_tracking(user_id, opportunity_id);
create index opportunity_tracking_user_idx on public.opportunity_tracking(user_id, status);

create function public.opportunity_tracking_stamp() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status <> 'saved' then new.applied_at := coalesce(new.applied_at, now()); end if;
  elsif new.status is distinct from old.status and new.status <> 'saved' and new.applied_at is null then
    new.applied_at := now();
  end if;
  return new;
end $$;
create trigger opportunity_tracking_stamp before insert or update on public.opportunity_tracking
  for each row execute function public.opportunity_tracking_stamp();

-- ---------------------------------------------------------------- CV documents
create function public.career_cv_data_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if octet_length(p::text) > 60000 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('personal', 'summary', 'education', 'experience', 'skills', 'languages', 'projects', 'certificates') then
      return false;
    end if;
  end loop;
  if p ? 'personal' and jsonb_typeof(p -> 'personal') <> 'object' then return false; end if;
  if p ? 'summary' and jsonb_typeof(p -> 'summary') <> 'string' then return false; end if;
  foreach k in array array['education', 'experience', 'skills', 'languages', 'projects', 'certificates'] loop
    if p ? k and (jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 30) then return false; end if;
  end loop;
  return true;
end $$;
grant execute on function public.career_cv_data_valid(jsonb) to anon, authenticated, service_role;

create table public.cv_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'CV' check (length(btrim(title)) between 1 and 120),
  language text not null default 'az' check (language in ('az', 'tr', 'en', 'ru')),
  template text not null default 'classic' check (template ~ '^[a-z0-9_-]{1,30}$'),
  data jsonb not null default '{}'::jsonb check (public.career_cv_data_valid(data)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cv_documents_user_idx on public.cv_documents(user_id, updated_at desc);

create function public.cv_documents_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and (select count(*) from public.cv_documents where user_id = new.user_id) >= 5 then
    raise exception 'at most 5 CVs per account' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger cv_documents_guard before insert or update on public.cv_documents
  for each row execute function public.cv_documents_guard();

-- ---------------------------------------------------------------- AI output cache (service_role only)
create table public.career_ai_cache (
  user_id uuid not null references public.profiles(id) on delete cascade,
  task text not null check (task in ('cv_feedback', 'interview_prep')),
  params_hash text not null check (length(params_hash) between 8 and 128),
  output jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  primary key (user_id, task, params_hash)
);

-- ---------------------------------------------------------------- privileges + RLS
alter table public.organizations enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_tracking enable row level security;
alter table public.cv_documents enable row level security;
alter table public.career_ai_cache enable row level security;
revoke all on public.organizations, public.opportunities, public.opportunity_tracking, public.cv_documents, public.career_ai_cache
  from anon, authenticated;
revoke all on public.career_ai_cache from service_role;
grant select on public.organizations, public.opportunities to authenticated;
grant select, delete on public.opportunity_tracking to authenticated;
grant update (status, notes) on public.opportunity_tracking to authenticated;
grant select, insert, delete on public.cv_documents to authenticated;
grant update (title, language, template, data) on public.cv_documents to authenticated;
grant select, insert, update on public.career_ai_cache to service_role;
-- The edge functions read the caller's own CV / published listings as `authenticated` (RLS), never as service_role.

create policy opportunities_select on public.opportunities for select to authenticated
  using (status = 'published' or public.is_moderator());
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_moderator() or exists (select 1 from public.opportunities o where o.organization_id = organizations.id and o.status = 'published'));
create policy opportunity_tracking_owner_select on public.opportunity_tracking for select to authenticated using (user_id = (select auth.uid()));
create policy opportunity_tracking_owner_update on public.opportunity_tracking for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy opportunity_tracking_owner_delete on public.opportunity_tracking for delete to authenticated using (user_id = (select auth.uid()));
create policy cv_documents_owner_select on public.cv_documents for select to authenticated using (user_id = (select auth.uid()));
create policy cv_documents_owner_insert on public.cv_documents for insert to authenticated with check (user_id = (select auth.uid()));
create policy cv_documents_owner_update on public.cv_documents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy cv_documents_owner_delete on public.cv_documents for delete to authenticated using (user_id = (select auth.uid()));
create policy career_ai_cache_service_all on public.career_ai_cache for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------- admin RPCs (audited)
-- "Today" for deadlines: the calendar date in Azerbaijan (UTC+4), through the injectable clock.
create function public.career_today() returns date
language sql stable set search_path = public, pg_temp as $$
  select (public.now_utc() at time zone 'Asia/Baku')::date
$$;
grant execute on function public.career_today() to anon, authenticated, service_role;

create function public.admin_upsert_organization(
  p_id uuid, p_name text, p_description text default null, p_website text default null, p_logo_path text default null,
  p_verified boolean default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old public.organizations;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 200 then
    raise exception 'name must be 1-200 characters' using errcode = '22023';
  end if;
  if p_website is not null and not public.career_https_url(p_website) then
    raise exception 'website must be an https URL' using errcode = '22023';
  end if;
  if p_verified is not null and not public.is_admin() then
    raise exception 'only an admin can set the verified flag' using errcode = '42501';
  end if;
  if p_id is null then
    insert into public.organizations (name, description, website, logo_path, verified, created_by)
    values (p_name, nullif(btrim(p_description), ''), p_website, p_logo_path, coalesce(p_verified, false), auth.uid())
    returning id into v_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'career.organization.create', 'organization', v_id::text,
            jsonb_build_object('name', btrim(p_name), 'verified', coalesce(p_verified, false)));
  else
    select * into v_old from public.organizations where id = p_id for update;
    if not found then
      raise exception 'organization not found' using errcode = 'P0002';
    end if;
    update public.organizations set name = p_name, description = nullif(btrim(p_description), ''), website = p_website,
      logo_path = p_logo_path, verified = coalesce(p_verified, v_old.verified)
      where id = p_id;
    v_id := p_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'career.organization.update', 'organization', v_id::text,
            jsonb_build_object('name', btrim(p_name), 'verified_from', v_old.verified, 'verified_to', coalesce(p_verified, v_old.verified)));
  end if;
  return v_id;
end $$;
revoke all on function public.admin_upsert_organization(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.admin_upsert_organization(uuid, text, text, text, text, boolean) to authenticated;

-- Creates a DRAFT, or edits an existing listing in place (status unchanged; use admin_set_opportunity_status).
create function public.admin_upsert_opportunity(
  p_id uuid, p_organization_id uuid, p_kind text, p_title text, p_description text default null,
  p_requirements text default null, p_location text default null, p_remote boolean default false, p_deadline date default null,
  p_apply_url text default null, p_skills text[] default '{}', p_languages text[] default '{}', p_source_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_status text;
  v_today date := public.career_today();
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('internship', 'junior_job', 'scholarship', 'exchange', 'competition', 'hackathon', 'career_event') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'title must be 1-200 characters' using errcode = '22023';
  end if;
  if p_apply_url is null or not public.career_https_url(p_apply_url) then
    raise exception 'apply_url must be an https URL' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;
  if p_deadline is not null and p_deadline > v_today + 1100 then
    raise exception 'deadline is more than three years away' using errcode = '22023';
  end if;
  if p_skills is null or not public.career_valid_skills(p_skills) then
    raise exception 'skills: at most 30 entries of 1-50 characters' using errcode = '22023';
  end if;
  if p_languages is null or not (p_languages <@ array['az', 'tr', 'en', 'ru']::text[]) then
    raise exception 'languages must be among az, tr, en, ru' using errcode = '22023';
  end if;
  if p_id is null then
    if p_deadline is not null and p_deadline < v_today then
      raise exception 'deadline is in the past' using errcode = '22023';
    end if;
    insert into public.opportunities (organization_id, kind, title, description, requirements, location, remote, deadline,
                                      apply_url, skills, languages, source_note, status, created_by)
    values (p_organization_id, p_kind, btrim(p_title), nullif(btrim(p_description), ''), nullif(btrim(p_requirements), ''),
            nullif(btrim(p_location), ''), coalesce(p_remote, false), p_deadline, p_apply_url, p_skills,
            (select coalesce(array_agg(distinct l), '{}') from unnest(p_languages) l), nullif(btrim(p_source_note), ''), 'draft', auth.uid())
    returning id into v_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'career.opportunity.create', 'opportunity', v_id::text, jsonb_build_object('title', btrim(p_title), 'kind', p_kind));
  else
    select status into v_status from public.opportunities where id = p_id for update;
    if not found then
      raise exception 'opportunity not found' using errcode = 'P0002';
    end if;
    -- A live listing may not be given a past deadline by an edit (archive it instead).
    if v_status = 'published' and p_deadline is not null and p_deadline < v_today then
      raise exception 'deadline is in the past: archive the listing instead' using errcode = '22023';
    end if;
    update public.opportunities set organization_id = p_organization_id, kind = p_kind, title = btrim(p_title),
      description = nullif(btrim(p_description), ''), requirements = nullif(btrim(p_requirements), ''),
      location = nullif(btrim(p_location), ''), remote = coalesce(p_remote, false), deadline = p_deadline, apply_url = p_apply_url,
      skills = p_skills, languages = (select coalesce(array_agg(distinct l), '{}') from unnest(p_languages) l),
      source_note = nullif(btrim(p_source_note), '')
      where id = p_id;
    v_id := p_id;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (auth.uid(), 'career.opportunity.update', 'opportunity', v_id::text, jsonb_build_object('title', btrim(p_title), 'kind', p_kind));
  end if;
  return v_id;
end $$;
revoke all on function public.admin_upsert_opportunity(uuid, uuid, text, text, text, text, text, boolean, date, text, text[], text[], text) from public, anon;
grant execute on function public.admin_upsert_opportunity(uuid, uuid, text, text, text, text, text, boolean, date, text, text[], text[], text) to authenticated;

create function public.admin_set_opportunity_status(p_id uuid, p_status text, p_reason text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old text;
  v_deadline date;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('draft', 'published', 'archived') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_reason is not null and length(p_reason) > 500 then
    raise exception 'reason is too long' using errcode = '22023';
  end if;
  select status, deadline into v_old, v_deadline from public.opportunities where id = p_id for update;
  if not found then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return false;
  end if;
  if p_status = 'published' and v_deadline is not null and v_deadline < public.career_today() then
    raise exception 'cannot publish a listing whose deadline has passed' using errcode = '22023';
  end if;
  update public.opportunities set status = p_status,
    published_at = case when p_status = 'published' then coalesce(published_at, now()) when p_status = 'draft' then null else published_at end
    where id = p_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'career.opportunity.status', 'opportunity', p_id::text,
          jsonb_build_object('from', v_old, 'to', p_status, 'reason', nullif(btrim(p_reason), '')));
  return true;
end $$;
revoke all on function public.admin_set_opportunity_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_opportunity_status(uuid, text, text) to authenticated;

create function public.admin_delete_opportunity(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_title text;
  v_org uuid;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  delete from public.opportunities where id = p_id returning title, organization_id into v_title, v_org;
  if not found then
    return false;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'career.opportunity.delete', 'opportunity', p_id::text,
          jsonb_build_object('title', v_title, 'organization_id', v_org, 'reason', btrim(p_reason)));
  return true;
end $$;
revoke all on function public.admin_delete_opportunity(uuid, text) from public, anon;
grant execute on function public.admin_delete_opportunity(uuid, text) to authenticated;

-- ---------------------------------------------------------------- student RPCs
-- Create (or update) the caller's tracking row for a PUBLISHED listing. Never submits anything anywhere.
create function public.track_opportunity(p_opportunity_id uuid, p_status text default 'saved', p_notes text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_o record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_status is null or p_status not in ('saved', 'applied', 'interview', 'offer', 'rejected') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_notes is not null and length(p_notes) > 2000 then
    raise exception 'notes are too long' using errcode = '22023';
  end if;
  select t.id into v_id from public.opportunity_tracking t where t.user_id = v_uid and t.opportunity_id = p_opportunity_id;
  if v_id is not null then
    update public.opportunity_tracking set status = p_status, notes = coalesce(p_notes, notes) where id = v_id;
    return v_id;
  end if;
  select o.id, o.title, o.kind, o.deadline, o.apply_url, g.name as org_name into v_o
    from public.opportunities o join public.organizations g on g.id = o.organization_id
    where o.id = p_opportunity_id and o.status = 'published';
  if not found then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  insert into public.opportunity_tracking (user_id, opportunity_id, status, notes, snapshot_title, snapshot_organization, snapshot_kind,
                                           snapshot_deadline, snapshot_apply_url)
  values (v_uid, v_o.id, p_status, p_notes, v_o.title, v_o.org_name, v_o.kind, v_o.deadline, v_o.apply_url)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.track_opportunity(uuid, text, text) from public, anon;
grant execute on function public.track_opportunity(uuid, text, text) to authenticated;

-- The caller's board: live listing data while the listing is published, the saved snapshot otherwise.
create function public.my_opportunity_tracking() returns table (
  id uuid, opportunity_id uuid, status text, notes text, applied_at timestamptz, updated_at timestamptz, title text,
  organization text, kind text, deadline date, apply_url text, skills text[], listing_state text)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.opportunity_id, t.status, t.notes, t.applied_at, t.updated_at,
         case when o.status = 'published' then o.title else t.snapshot_title end,
         case when o.status = 'published' then g.name else t.snapshot_organization end,
         case when o.status = 'published' then o.kind else t.snapshot_kind end,
         case when o.status = 'published' then o.deadline else t.snapshot_deadline end,
         case when o.status = 'published' then o.apply_url else t.snapshot_apply_url end,
         case when o.status = 'published' then o.skills else '{}'::text[] end,
         case when o.id is null then 'removed' when o.status = 'published' then 'published' else 'unavailable' end
  from public.opportunity_tracking t
  left join public.opportunities o on o.id = t.opportunity_id
  left join public.organizations g on g.id = o.organization_id
  where t.user_id = auth.uid()
  order by t.updated_at desc, t.id
$$;
revoke all on function public.my_opportunity_tracking() from public, anon;
grant execute on function public.my_opportunity_tracking() to authenticated;

-- ---------------------------------------------------------------- search
-- SECURITY INVOKER: RLS limits students to published listings (and organizations of published listings); the explicit
-- status filter keeps staff on the student view. Expired (deadline before today in Asia/Baku) are hidden by default.
create function public.search_opportunities(
  p_q text default null, p_kind text default null, p_location text default null, p_remote boolean default null,
  p_deadline_before date default null, p_skills text[] default null, p_sort text default 'deadline',
  p_limit integer default 20, p_offset integer default 0, p_include_expired boolean default false)
returns table (
  id uuid, organization_id uuid, organization_name text, organization_verified boolean, kind text, title text,
  location text, remote boolean, deadline date, apply_url text, skills text[], languages text[], published_at timestamptz,
  tracked_status text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tokens text[];
  v_skills text[];
  v_loc text := public.notes_normalize(p_location);
  v_today date := public.career_today();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_sort is null or p_sort not in ('deadline', 'newest') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('internship', 'junior_job', 'scholarship', 'exchange', 'competition', 'hackathon', 'career_event') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if length(coalesce(p_q, '')) > 200 or length(coalesce(p_location, '')) > 200 then
    raise exception 'query too long' using errcode = '22023';
  end if;
  select coalesce(array_agg(x), '{}') into v_tokens from regexp_split_to_table(public.notes_normalize(p_q), ' ') x where x <> '';
  if cardinality(v_tokens) > 8 then v_tokens := v_tokens[1:8]; end if;
  select array_agg(distinct public.notes_normalize(s)) into v_skills from unnest(p_skills) s where length(btrim(s)) > 0;
  if v_skills is not null and cardinality(v_skills) > 30 then v_skills := v_skills[1:30]; end if;
  return query
    select o.id, o.organization_id, g.name, g.verified, o.kind, o.title, o.location, o.remote, o.deadline, o.apply_url,
           o.skills, o.languages, o.published_at,
           (select tr.status from public.opportunity_tracking tr where tr.user_id = v_uid and tr.opportunity_id = o.id)
    from public.opportunities o
    join public.organizations g on g.id = o.organization_id
    where o.status = 'published'
      and (p_include_expired or o.deadline is null or o.deadline >= v_today)
      and (p_kind is null or o.kind = p_kind)
      and (v_loc = '' or o.location_norm like '%' || replace(replace(replace(v_loc, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_remote is not true or o.remote)
      and (p_deadline_before is null or (o.deadline is not null and o.deadline <= p_deadline_before))
      and (v_skills is null or o.skills_norm && v_skills)
      and not exists (select 1 from unnest(v_tokens) tk
                      where (g.name_norm || ' ' || o.search_norm) not like '%' || replace(replace(replace(tk, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    order by case p_sort when 'deadline' then o.deadline end asc nulls last, o.published_at desc, o.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.search_opportunities(text, text, text, boolean, date, text[], text, integer, integer, boolean) from public, anon;
grant execute on function public.search_opportunities(text, text, text, boolean, date, text[], text, integer, integer, boolean) to authenticated;

-- One published listing with its organization profile (null when it does not exist or is not published).
create function public.get_opportunity(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'title', o.title, 'description', o.description, 'requirements', o.requirements,
      'location', o.location, 'remote', o.remote, 'deadline', o.deadline, 'apply_url', o.apply_url, 'skills', o.skills,
      'languages', o.languages, 'source_note', o.source_note, 'published_at', o.published_at,
      'organization', jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'website', g.website,
                                         'logo_path', g.logo_path, 'verified', g.verified),
      'tracked_status', (select tr.status from public.opportunity_tracking tr where tr.user_id = auth.uid() and tr.opportunity_id = o.id))
    into v
    from public.opportunities o join public.organizations g on g.id = o.organization_id
    where o.id = p_id and o.status = 'published';
  return v;
end $$;
revoke all on function public.get_opportunity(uuid) from public, anon;
grant execute on function public.get_opportunity(uuid) to authenticated;

-- ---------------------------------------------------------------- data export: career data joins the account export
alter function public.export_my_data() rename to export_my_data_base;
create function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select public.export_my_data_base() || jsonb_build_object(
    'cv_documents', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from public.cv_documents c where c.user_id = auth.uid()), '[]'),
    'opportunity_tracking', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.opportunity_tracking t where t.user_id = auth.uid()), '[]'))
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
