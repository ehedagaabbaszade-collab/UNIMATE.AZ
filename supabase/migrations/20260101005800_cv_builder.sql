-- CV builder foundation. Forward-only, no data rewritten or removed; existing rows keep working (design defaults to '{}'
-- = template defaults, is_default false). Mirrors packages/core/src/career (career.ts CvDataSchema, cv-design.ts CvDesignSchema).
-- Since 005600 nothing is auto-granted: every new object below is granted explicitly.

-- ---------------------------------------------------------------- content: four more sections, 100 KB budget
-- Skills may now hold objects ({name, level, kind}) as well as legacy strings; element shapes are validated by the clients
-- (zod); here only the top-level shape, array lengths and the byte budget.
create or replace function public.career_cv_data_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if octet_length(p::text) > 100000 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('personal', 'summary', 'education', 'experience', 'skills', 'languages', 'projects', 'certificates', 'hobbies',
                 'honours', 'activities', 'volunteer', 'publications', 'courses', 'references') then
      return false;
    end if;
  end loop;
  if p ? 'personal' and jsonb_typeof(p -> 'personal') <> 'object' then return false; end if;
  if p ? 'summary' and jsonb_typeof(p -> 'summary') <> 'string' then return false; end if;
  foreach k in array array['education', 'experience', 'skills', 'languages', 'projects', 'certificates', 'hobbies', 'honours',
                           'activities', 'volunteer', 'publications', 'courses', 'references'] loop
    if p ? k and (jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 30) then return false; end if;
  end loop;
  return true;
end $$;
-- create or replace keeps the existing ACL (execute for anon, authenticated, service_role from 004900/005400).

-- ---------------------------------------------------------------- presentation: cv_documents.design
create function public.career_cv_design_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare
  k text;
  v jsonb;
  sections constant text[] := array['summary', 'education', 'experience', 'skills', 'languages', 'projects', 'certificates',
    'hobbies', 'honours', 'activities', 'volunteer', 'publications', 'courses', 'references'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if octet_length(p::text) > 4000 then return false; end if;
  for k, v in select * from jsonb_each(p) loop
    case k
      when 'sectionOrder', 'hidden' then
        if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 14 then return false; end if;
        if exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string' or not (x #>> '{}') = any (sections)) then
          return false;
        end if;
      when 'font' then if v not in ('"inter"', '"noto-sans"', '"noto-serif"') then return false; end if;
      when 'fontSize' then if v not in ('"sm"', '"md"', '"lg"') then return false; end if;
      when 'headingScale' then
        if jsonb_typeof(v) <> 'number' or (v::text)::numeric < 0.8 or (v::text)::numeric > 1.5 then return false; end if;
      when 'primary', 'accent', 'background' then
        if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^#[0-9A-Fa-f]{6}$' then return false; end if;
      when 'spacing' then if v not in ('"compact"', '"normal"', '"relaxed"') then return false; end if;
      when 'margins' then if v not in ('"narrow"', '"normal"', '"wide"') then return false; end if;
      when 'columns' then if v not in ('"one"', '"two"') then return false; end if;
      when 'showPhoto' then if jsonb_typeof(v) <> 'boolean' then return false; end if;
      when 'photoShape' then if v not in ('"circle"', '"rounded"', '"square"') then return false; end if;
      when 'mode' then if v not in ('"designed"', '"ats"') then return false; end if;
      else return false;
    end case;
  end loop;
  return true;
end $$;
revoke all on function public.career_cv_design_valid(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.career_cv_design_valid(jsonb) to anon, authenticated, service_role;

alter table public.cv_documents
  add column design jsonb not null default '{}'::jsonb check (public.career_cv_design_valid(design)),
  add column is_default boolean not null default false;
create unique index cv_documents_one_default on public.cv_documents(user_id) where is_default;
-- is_default changes only through set_default_cv (no column UPDATE grant).
grant update (design) on public.cv_documents to authenticated;

-- ---------------------------------------------------------------- 10 CVs per account; updated_at only on content changes
create or replace function public.cv_documents_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := now();
    if (select count(*) from public.cv_documents where user_id = new.user_id) >= 10 then
      raise exception 'at most 10 CVs per account' using errcode = '54000';
    end if;
  elsif (new.title, new.language, new.template, new.data, new.design) is distinct from (old.title, old.language, old.template, old.data, old.design) then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- default CV
create function public.set_default_cv(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- Lock every CV of the caller first: concurrent calls serialise instead of racing on the unique index.
  perform 1 from public.cv_documents where user_id = v_uid for update;
  if not exists (select 1 from public.cv_documents where id = p_id and user_id = v_uid) then
    raise exception 'cv not found' using errcode = 'P0002';
  end if;
  update public.cv_documents set is_default = false where user_id = v_uid and is_default and id <> p_id;
  update public.cv_documents set is_default = true where id = p_id and not is_default;
end $$;
revoke all on function public.set_default_cv(uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_default_cv(uuid) to authenticated;

-- ---------------------------------------------------------------- ROLLBACK (manual, in this order)
-- drop function public.set_default_cv(uuid);
-- (re-run the cv_documents_guard body from 20260101004310_career.sql: cap 5)
-- revoke update (design) on public.cv_documents from authenticated;
-- drop index public.cv_documents_one_default;
-- alter table public.cv_documents drop column is_default, drop column design;   -- loses saved designs
-- drop function public.career_cv_design_valid(jsonb);
-- (re-run career_cv_data_valid from 20260101005400_cv_europass_sections.sql; first move any rows using the new keys or
--  over 60000 bytes out of the way, or the old check rejects later updates of those rows)
