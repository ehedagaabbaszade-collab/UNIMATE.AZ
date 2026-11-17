-- Europass CV template: three more list sections (hobbies, honours, activities). Same validator as career, wider key list.
create or replace function public.career_cv_data_valid(p jsonb) returns boolean
language plpgsql immutable set search_path = pg_catalog as $$
declare k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return false; end if;
  if octet_length(p::text) > 60000 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('personal', 'summary', 'education', 'experience', 'skills', 'languages', 'projects', 'certificates', 'hobbies', 'honours', 'activities') then
      return false;
    end if;
  end loop;
  if p ? 'personal' and jsonb_typeof(p -> 'personal') <> 'object' then return false; end if;
  if p ? 'summary' and jsonb_typeof(p -> 'summary') <> 'string' then return false; end if;
  foreach k in array array['education', 'experience', 'skills', 'languages', 'projects', 'certificates', 'hobbies', 'honours', 'activities'] loop
    if p ? k and (jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > 30) then return false; end if;
  end loop;
  return true;
end $$;
grant execute on function public.career_cv_data_valid(jsonb) to anon, authenticated, service_role;
