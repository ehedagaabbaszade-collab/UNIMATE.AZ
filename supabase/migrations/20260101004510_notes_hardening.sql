-- NOTES hardening (review round 1). Postgres 15 syntax only. Does not edit applied migrations.
--  1. The stored object is bound to the resource (storage object id + etag + size) and cannot be replaced or deleted by
--     the owner while a pending/published resource points at it; signing verifies the binding (resource-url edge
--     function + packages/pipeline authorizeResourceDownload / importResource)
--  2. create_resource and direct resource INSERTs compare client mime/size with storage.objects metadata
--  3. takedown_requests: the 10/day cap also applies to direct inserts
--  4. resource_meta respects can_view_resource

-- ---------------------------------------------------------------- 1. object binding
alter table public.resources
  add column storage_object_id uuid,
  add column storage_etag text,
  add column storage_size bigint;

-- True while a pending/published resource points at the object: the owner may no longer overwrite or delete it.
create function public.resources_object_locked(p_name text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.resources r where r.storage_path = p_name and r.status in ('pending', 'published'))
$$;
revoke all on function public.resources_object_locked(text) from public, anon;
grant execute on function public.resources_object_locked(text) to authenticated, service_role;

drop policy resources_bucket_owner_update on storage.objects;
drop policy resources_bucket_owner_delete on storage.objects;
create policy resources_bucket_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text
         and not public.resources_object_locked(name))
  with check (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text
              and not public.resources_object_locked(name));
create policy resources_bucket_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text
         and not public.resources_object_locked(name));

-- Reads the caller's OWN uploaded object (folder must be the caller's uid), checks client-declared mime/size against the
-- storage metadata and returns what to bind. Callable by clients (needed by the invoker trigger); only exposes the
-- caller's own objects.
create function public.resources_bind_object(p_path text, p_mime text, p_size bigint,
  out object_id uuid, out etag text, out size bigint, out mime text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o record;
begin
  if auth.uid() is null or p_path is null or (storage.foldername(p_path))[1] is distinct from auth.uid()::text then
    raise exception 'invalid storage path' using errcode = '22023';
  end if;
  select x.id, x.metadata into o from storage.objects x where x.bucket_id = 'resources' and x.name = p_path;
  if not found or o.metadata is null or coalesce(o.metadata ->> 'size', '') !~ '^[0-9]{1,15}$' then
    raise exception 'file has not been uploaded' using errcode = '22023';
  end if;
  object_id := o.id;
  size := (o.metadata ->> 'size')::bigint;
  mime := lower(btrim(split_part(coalesce(o.metadata ->> 'mimetype', ''), ';', 1)));
  etag := nullif(btrim(o.metadata ->> 'eTag', '"'), '');
  if p_mime is not null and p_mime is distinct from mime then
    raise exception 'file type does not match the uploaded file' using errcode = '22023';
  end if;
  if p_size is not null and p_size is distinct from size then
    raise exception 'file size does not match the uploaded file' using errcode = '22023';
  end if;
end $$;
revoke all on function public.resources_bind_object(text, text, bigint) from public, anon;
grant execute on function public.resources_bind_object(text, text, bigint) to authenticated, service_role;

-- Direct API writes: bind on INSERT, pin on UPDATE. Named to fire right after resources_a_prepare.
create function public.resources_b_bind() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  b record;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.storage_object_id := null; new.storage_etag := null; new.storage_size := null;
    if new.storage_path is not null then
      if (storage.foldername(new.storage_path))[1] is distinct from new.uploader_id::text then
        raise exception 'invalid storage path' using errcode = '22023';
      end if;
      select * into b from public.resources_bind_object(new.storage_path, new.mime_type, new.size_bytes);
      new.storage_object_id := b.object_id; new.storage_etag := b.etag; new.storage_size := b.size;
      new.mime_type := coalesce(new.mime_type, b.mime);
      new.size_bytes := coalesce(new.size_bytes, b.size);
    end if;
  else
    new.storage_path := old.storage_path; new.mime_type := old.mime_type; new.size_bytes := old.size_bytes;
    new.storage_object_id := old.storage_object_id; new.storage_etag := old.storage_etag; new.storage_size := old.storage_size;
  end if;
  return new;
end $$;
create trigger resources_b_bind before insert or update on public.resources
  for each row execute function public.resources_b_bind();

create or replace function public.create_resource(
  p_title text, p_description text, p_kind public.resource_kind, p_course_id uuid, p_visibility public.resource_visibility,
  p_tags text[], p_storage_path text, p_mime_type text, p_size_bytes bigint, p_filename text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_uni uuid;
  v_major uuid;
  v_faculty uuid;
  v_tags text[];
  v_max bigint;
  v_id uuid;
  b record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'title must be 1-200 characters' using errcode = '22023';
  end if;
  if p_description is not null and length(p_description) > 2000 then
    raise exception 'description too long' using errcode = '22023';
  end if;
  if p_kind is null or p_visibility is null then
    raise exception 'kind and visibility are required' using errcode = '22023';
  end if;
  v_max := case p_mime_type
    when 'application/pdf' then 52428800
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 26214400
    when 'application/vnd.openxmlformats-officedocument.presentationml.presentation' then 52428800
    when 'image/png' then 10485760
    when 'image/jpeg' then 10485760 end;
  if v_max is null then
    raise exception 'unsupported file type' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > v_max then
    raise exception 'file size out of range' using errcode = '22023';
  end if;
  if p_storage_path is null or p_storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9._ -]+$'
     or p_storage_path not like v_uid::text || '/%' or p_storage_path ~ '\.\.' or length(p_storage_path) > 200 then
    raise exception 'invalid storage path' using errcode = '22023';
  end if;
  -- object must exist and its stored mime/size must equal what the client declared; id/etag/size are bound below
  select * into b from public.resources_bind_object(p_storage_path, p_mime_type, p_size_bytes);
  if (select count(*) from public.resources r where r.uploader_id = v_uid and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many uploads today' using errcode = '54000';
  end if;

  select coalesce(array_agg(distinct t order by t), '{}') into v_tags
    from (select left(lower(btrim(x)), 30) as t from unnest(coalesce(p_tags, '{}')) x where length(btrim(x)) > 0) s;
  if cardinality(v_tags) > 8 then
    raise exception 'at most 8 tags' using errcode = '22023';
  end if;

  if p_course_id is not null then
    select c.university_id, c.major_id into v_uni, v_major from public.courses c where c.id = p_course_id;
    if not found then
      raise exception 'course not found' using errcode = '22023';
    end if;
  else
    select p.university_id into v_uni from public.profiles p where p.id = v_uid;
  end if;
  if v_major is not null then
    select m.faculty_id into v_faculty from public.majors m where m.id = v_major;
  end if;
  if p_visibility = 'university' and v_uni is null then
    raise exception 'university visibility needs a university (pick a course or set your university)' using errcode = '22023';
  end if;

  insert into public.resources (uploader_id, university_id, faculty_id, major_id, course_id, kind, title, description, tags,
                                storage_path, visibility, mime_type, size_bytes, original_filename,
                                storage_object_id, storage_etag, storage_size)
  values (v_uid, v_uni, v_faculty, v_major, p_course_id, p_kind, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          v_tags, p_storage_path, p_visibility, p_mime_type, p_size_bytes, left(p_filename, 255),
          b.object_id, b.etag, b.size)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_resource(text, text, public.resource_kind, uuid, public.resource_visibility, text[], text, text, bigint, text) from public, anon;
grant execute on function public.create_resource(text, text, public.resource_kind, uuid, public.resource_visibility, text[], text, text, bigint, text) to authenticated;

-- Bind rows that already exist and whose object is present (others stay unbound and are refused by the signer).
update public.resources r
set storage_object_id = o.id, storage_etag = nullif(btrim(o.metadata ->> 'eTag', '"'), ''),
    storage_size = case when coalesce(o.metadata ->> 'size', '') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint end
from storage.objects o
where o.bucket_id = 'resources' and o.name = r.storage_path and r.storage_object_id is null;

-- ---------------------------------------------------------------- 3. takedown cap on direct inserts
-- Invoker trigger: only API roles (report_copyright runs as the function owner and keeps its own identical cap).
create function public.takedown_requests_cap() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated')
     and (select count(*) from public.takedown_requests t where t.requester_id = new.requester_id
          and t.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many reports today' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger takedown_requests_a_cap before insert on public.takedown_requests
  for each row execute function public.takedown_requests_cap();

-- ---------------------------------------------------------------- 4. resource_meta
create or replace function public.resource_meta(p_id uuid, out uploader uuid, out status public.content_status)
language sql stable security definer set search_path = public, pg_temp as $$
  select uploader_id, status from public.resources where id = p_id and public.can_view_resource(p_id)
$$;
revoke all on function public.resource_meta(uuid) from public, anon;
grant execute on function public.resource_meta(uuid) to authenticated, service_role;
revoke all on function public.resources_b_bind(), public.takedown_requests_cap() from public, anon, authenticated;
