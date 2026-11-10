-- UNIMATE NOTES: student resource library. Postgres 15 syntax only.
--  * private `resources` bucket (no public read, no client read policy: reads go through signed URLs minted by an edge
--    function after an authz check); owner-folder write policies
--  * resources: pending -> published (moderator), copyright reports auto-hide pending review, ratings/saves aggregates,
--    az/tr/ru-aware normalised search (ILIKE + optional pg_trgm index), contributor profile
--  * shared quizzes / flashcard decks: snapshot WITHOUT answer key; import makes an owner copy graded by submit_quiz_attempt

-- ---------------------------------------------------------------- normalisation (az/tr/en/ru)
-- Folds Azerbaijani/Turkish letters to ASCII (ə->e, ı/İ->i, ö->o, ü->u, ç->c, ş->s, ğ->g) and ё->е, lowercases, and
-- collapses whitespace, so "Riyaziyyat", "ANALİZ" and "analiz" match. translate() runs BEFORE lower() because
-- lower('İ') is locale dependent.
create function public.notes_normalize(p text) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select btrim(regexp_replace(
    lower(translate(
      regexp_replace(coalesce(p, ''), '̇', '', 'g'),
      'İIıƏəÖöÜüÇçŞşĞğЁё',
      'iiieeoouuccssggее'
    )), '\s+', ' ', 'g'))
$$;
grant execute on function public.notes_normalize(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- private storage bucket
-- Limits mirror packages/core validateUpload: pdf 50 MB, docx 25 MB, pptx 50 MB, png/jpg 10 MB (bucket cap = the max;
-- per-type caps are enforced by create_resource + the client/edge validateUpload). Layout: resources/<uid>/<flat file>.
-- No SELECT policy for anon/authenticated at all: downloads only via signed URLs from the `resource-url` edge function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resources', 'resources', false, 52428800,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
              'image/png', 'image/jpeg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy resources_bucket_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy resources_bucket_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy resources_bucket_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'resources' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- resources: new columns
create function public.notes_valid_tags(p_tags text[]) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select cardinality(p_tags) <= 8 and not exists (
    select 1 from unnest(p_tags) t where t is null or length(btrim(t)) not between 1 and 30)
$$;

alter table public.resources
  add column tags text[] not null default '{}' check (public.notes_valid_tags(tags)),
  add column faculty_id uuid references public.faculties(id) on delete set null,
  add column major_id uuid references public.majors(id) on delete set null,
  add column mime_type text check (mime_type is null or mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png', 'image/jpeg')),
  add column size_bytes bigint check (size_bytes is null or size_bytes between 1 and 52428800),
  add column original_filename text check (original_filename is null or length(original_filename) <= 255),
  add column avg_rating numeric(3,2) not null default 0,
  add column rating_count integer not null default 0,
  add column save_count integer not null default 0,
  add column takedown_hold boolean not null default false,
  add column search_norm text not null default '';

create index resources_listing_idx on public.resources (created_at desc) where status = 'published';
create index resources_faculty_idx on public.resources (faculty_id) where status = 'published';

-- pg_trgm is optional: present on Supabase, absent from the PGlite harness (which only loads pgvector). Search is correct
-- either way (ILIKE on search_norm); the index only makes it fast.
do $$
begin
  create extension if not exists pg_trgm with schema extensions;
  execute 'create index resources_search_trgm on public.resources using gin (search_norm extensions.gin_trgm_ops)';
exception when others then
  raise notice 'pg_trgm unavailable (%), search falls back to sequential ILIKE', sqlerrm;
end $$;

-- Fires BEFORE the other resources triggers (alphabetical): API roles cannot forge aggregates / the hold flag; search
-- text is always derived server-side.
create function public.resources_a_prepare() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_course text := '';
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.avg_rating := 0; new.rating_count := 0; new.save_count := 0; new.takedown_hold := false;
    else
      new.avg_rating := old.avg_rating; new.rating_count := old.rating_count;
      new.save_count := old.save_count; new.takedown_hold := old.takedown_hold;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'pending' then
    new.takedown_hold := false;
  end if;
  if new.course_id is not null then
    select c.code || ' ' || c.title into v_course from public.courses c where c.id = new.course_id;
  end if;
  new.search_norm := public.notes_normalize(concat_ws(' ', new.title, new.description, array_to_string(new.tags, ' '), v_course));
  return new;
end $$;
create trigger resources_a_prepare before insert or update on public.resources
  for each row execute function public.resources_a_prepare();

-- ---------------------------------------------------------------- upload flow
-- create_resource: validates everything the client says, derives university/faculty/major from the (real) course, and
-- inserts as 'pending'. The object must already exist in the bucket under the caller's folder.
create function public.create_resource(
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
  if not exists (select 1 from storage.objects o where o.bucket_id = 'resources' and o.name = p_storage_path) then
    raise exception 'file has not been uploaded' using errcode = '22023';
  end if;
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
                                storage_path, visibility, mime_type, size_bytes, original_filename)
  values (v_uid, v_uni, v_faculty, v_major, p_course_id, p_kind, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          v_tags, p_storage_path, p_visibility, p_mime_type, p_size_bytes, left(p_filename, 255))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.create_resource(text, text, public.resource_kind, uuid, public.resource_visibility, text[], text, text, bigint, text) from public, anon;
grant execute on function public.create_resource(text, text, public.resource_kind, uuid, public.resource_visibility, text[], text, text, bigint, text) to authenticated;

-- Direct client INSERT stays (existing RLS contract: forced 'pending', aggregates/hold reset by trigger); the UI uses
-- create_resource for validation and rate limiting. Everything is moderated before anyone else can see it.

-- ---------------------------------------------------------------- moderation (approve / reject pending content)
-- admin_moderate_content only restores 'removed' rows; this is the pending -> published decision.
create function public.admin_review_content(p_kind text, p_id uuid, p_action text, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_status public.content_status;
  v_hold boolean := false;
  v_new public.content_status;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('resource', 'shared_quiz', 'shared_deck') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  if p_action is null or p_action not in ('approve', 'reject') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  v_new := case p_action when 'approve' then 'published' else 'removed' end;
  if p_kind = 'resource' then
    select status, takedown_hold into v_status, v_hold from public.resources where id = p_id for update;
  elsif p_kind = 'shared_quiz' then
    select status into v_status from public.shared_quizzes where id = p_id for update;
  else
    select status into v_status from public.shared_decks where id = p_id for update;
  end if;
  if not found then
    raise exception 'content not found' using errcode = 'P0002';
  end if;
  if v_status <> 'pending' then
    return false;
  end if;
  if v_hold then
    raise exception 'resource is under a copyright review: resolve the takedown request' using errcode = '55000';
  end if;
  if p_kind = 'resource' then
    update public.resources set status = v_new where id = p_id;
  elsif p_kind = 'shared_quiz' then
    update public.shared_quizzes set status = v_new where id = p_id;
  else
    update public.shared_decks set status = v_new where id = p_id;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'content.' || p_action, p_kind, p_id::text, jsonb_build_object('reason', btrim(p_reason)));
  return true;
end $$;
revoke all on function public.admin_review_content(text, uuid, text, text) from public, anon;
grant execute on function public.admin_review_content(text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- copyright reports
-- A report on a published resource hides it (back to 'pending', takedown_hold = true) until a moderator resolves the
-- takedown: accepted -> removed, rejected -> republished (below). The uploader's own reports never hide anything.
create function public.takedown_auto_hide() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'open' then
    update public.resources set status = 'pending', takedown_hold = true
      where id = new.resource_id and status = 'published' and uploader_id <> new.requester_id;
  end if;
  return new;
end $$;
revoke all on function public.takedown_auto_hide() from public, anon, authenticated;
create trigger takedown_requests_auto_hide after insert on public.takedown_requests
  for each row execute function public.takedown_auto_hide();

create function public.report_copyright(p_resource_id uuid, p_details text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_up uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_details is null or length(btrim(p_details)) not between 10 and 4000 then
    raise exception 'details must be 10-4000 characters' using errcode = '22023';
  end if;
  select id into v_id from public.takedown_requests where requester_id = v_uid and resource_id = p_resource_id and status = 'open';
  if found then
    return v_id; -- idempotent (checked first: the reported resource is hidden for the reporter by now)
  end if;
  select uploader_id into v_up from public.resources where id = p_resource_id;
  if not found or not public.can_view_resource(p_resource_id) then
    raise exception 'resource not found' using errcode = 'P0002';
  end if;
  if v_up = v_uid then
    raise exception 'you cannot report your own resource' using errcode = '42501';
  end if;
  if (select count(*) from public.takedown_requests t where t.requester_id = v_uid and t.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many reports today' using errcode = '54000';
  end if;
  insert into public.takedown_requests (resource_id, requester_id, reason) values (p_resource_id, v_uid, btrim(p_details))
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.report_copyright(uuid, text) from public, anon;
grant execute on function public.report_copyright(uuid, text) to authenticated;

-- Same as 20260101001700 plus: a rejected takedown republishes a resource that only the takedown had hidden.
create or replace function public.admin_resolve_takedown(p_id uuid, p_decision public.takedown_status, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old public.takedown_status;
  v_resource uuid;
begin
  if not public.is_moderator() then
    raise exception 'moderator privileges required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision = 'open' then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason (3-500 chars) is required' using errcode = '22023';
  end if;
  select status, resource_id into v_old, v_resource from public.takedown_requests where id = p_id for update;
  if not found then
    raise exception 'takedown not found' using errcode = 'P0002';
  end if;
  if v_old <> 'open' then
    raise exception 'takedown already resolved' using errcode = '55000';
  end if;
  update public.takedown_requests set status = p_decision, resolved_by = auth.uid(), resolved_at = now() where id = p_id;
  if p_decision = 'accepted' then
    update public.resources set status = 'removed' where id = v_resource and status <> 'removed';
  elsif not exists (select 1 from public.takedown_requests where resource_id = v_resource and status = 'open') then
    update public.resources set status = 'published' where id = v_resource and takedown_hold and status = 'pending';
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'takedown.' || p_decision, 'takedown', p_id::text,
          jsonb_build_object('resource_id', v_resource, 'reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------- ratings + saves
create function public.resource_meta(p_id uuid, out uploader uuid, out status public.content_status)
language sql stable security definer set search_path = public, pg_temp as $$
  select uploader_id, status from public.resources where id = p_id
$$;
revoke all on function public.resource_meta(uuid) from public, anon;
grant execute on function public.resource_meta(uuid) to authenticated, service_role;

-- Invoker trigger: applies to API roles only (trusted/service code is exempt, like the other guard triggers).
create function public.resource_ratings_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  m record;
begin
  if current_user in ('anon', 'authenticated') then
    select * into m from public.resource_meta(new.resource_id);
    if m.uploader = new.user_id then
      raise exception 'you cannot rate your own resource' using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and m.status is distinct from 'published' then
      raise exception 'only published resources can be rated' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger resource_ratings_guard before insert or update on public.resource_ratings
  for each row execute function public.resource_ratings_guard();

create function public.resource_ratings_aggregate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := coalesce(new.resource_id, old.resource_id);
begin
  update public.resources r set
    avg_rating = coalesce((select round(avg(x.rating)::numeric, 2) from public.resource_ratings x where x.resource_id = v_id), 0),
    rating_count = (select count(*) from public.resource_ratings x where x.resource_id = v_id)
  where r.id = v_id;
  return null;
end $$;
revoke all on function public.resource_ratings_aggregate() from public, anon, authenticated;
create trigger resource_ratings_aggregate after insert or update or delete on public.resource_ratings
  for each row execute function public.resource_ratings_aggregate();

create function public.resource_saves_aggregate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := coalesce(new.resource_id, old.resource_id);
begin
  update public.resources r set save_count = (select count(*) from public.resource_saves x where x.resource_id = v_id) where r.id = v_id;
  return null;
end $$;
revoke all on function public.resource_saves_aggregate() from public, anon, authenticated;
create trigger resource_saves_aggregate after insert or delete on public.resource_saves
  for each row execute function public.resource_saves_aggregate();

create function public.rate_resource(p_resource_id uuid, p_rating integer, p_comment text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be 1-5' using errcode = '22023';
  end if;
  if p_comment is not null and length(p_comment) > 1000 then
    raise exception 'comment too long' using errcode = '22023';
  end if;
  if not public.can_view_resource(p_resource_id) then
    raise exception 'resource not found' using errcode = 'P0002';
  end if;
  if (select m.uploader from public.resource_meta(p_resource_id) m) = v_uid then
    raise exception 'you cannot rate your own resource' using errcode = '42501';
  end if;
  if (select m.status from public.resource_meta(p_resource_id) m) <> 'published' then
    raise exception 'only published resources can be rated' using errcode = '42501';
  end if;
  insert into public.resource_ratings (resource_id, user_id, rating, comment)
  values (p_resource_id, v_uid, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (resource_id, user_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
end $$;
revoke all on function public.rate_resource(uuid, integer, text) from public, anon;
grant execute on function public.rate_resource(uuid, integer, text) to authenticated;

create function public.list_resource_reviews(p_resource_id uuid, p_limit integer default 20, p_offset integer default 0)
returns table (user_id uuid, display_name text, rating smallint, comment text, created_at timestamptz, is_mine boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.user_id, p.display_name, r.rating, r.comment, r.updated_at, r.user_id = auth.uid()
  from public.resource_ratings r join public.profiles p on p.id = r.user_id
  where r.resource_id = p_resource_id and auth.uid() is not null and public.can_view_resource(p_resource_id)
    and (r.user_id = auth.uid() or not public.has_block_between(r.user_id))
  order by (r.user_id = auth.uid()) desc, r.updated_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0)
$$;
revoke all on function public.list_resource_reviews(uuid, integer, integer) from public, anon;
grant execute on function public.list_resource_reviews(uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------- search
-- Security definer so it can join public names; visibility is enforced per row with can_view_resource (blocks, university
-- scope) AND status = 'published'. Own pending uploads are read from the table directly (RLS) by the "my uploads" screen.
create function public.search_resources(
  p_q text default null, p_university uuid default null, p_course uuid default null, p_type public.resource_kind default null,
  p_sort text default 'newest', p_limit integer default 20, p_offset integer default 0, p_uploader uuid default null)
returns table (
  id uuid, title text, description text, kind public.resource_kind, tags text[], course_id uuid, course_code text,
  course_title text, university_id uuid, university_name text, uploader_id uuid, uploader_name text, avg_rating numeric,
  rating_count integer, save_count integer, mime_type text, size_bytes bigint, created_at timestamptz, saved boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_tokens text[];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_sort is null or p_sort not in ('newest', 'rating', 'saves') then
    raise exception 'invalid sort' using errcode = '22023';
  end if;
  if p_q is not null and length(p_q) > 200 then
    raise exception 'query too long' using errcode = '22023';
  end if;
  select coalesce(array_agg(t), '{}') into v_tokens
    from regexp_split_to_table(public.notes_normalize(p_q), ' ') t where t <> '';
  if cardinality(v_tokens) > 8 then
    v_tokens := v_tokens[1:8];
  end if;
  return query
    select r.id, r.title, r.description, r.kind, r.tags, r.course_id, c.code, c.title, r.university_id, u.name,
           r.uploader_id, pr.display_name, r.avg_rating, r.rating_count, r.save_count, r.mime_type, r.size_bytes, r.created_at,
           exists (select 1 from public.resource_saves s where s.resource_id = r.id and s.user_id = v_uid)
    from public.resources r
    left join public.courses c on c.id = r.course_id
    left join public.universities u on u.id = r.university_id
    left join public.profiles pr on pr.id = r.uploader_id
    where r.status = 'published' and public.can_view_resource(r.id)
      and (p_university is null or r.university_id = p_university)
      and (p_course is null or r.course_id = p_course)
      and (p_type is null or r.kind = p_type)
      and (p_uploader is null or r.uploader_id = p_uploader)
      and not exists (select 1 from unnest(v_tokens) t
                      where r.search_norm not like '%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    order by case p_sort when 'rating' then r.avg_rating end desc nulls last,
             case p_sort when 'rating' then r.rating_count when 'saves' then r.save_count end desc nulls last,
             r.created_at desc, r.id
    limit least(greatest(coalesce(p_limit, 20), 1), 50) offset greatest(coalesce(p_offset, 0), 0);
end $$;
revoke all on function public.search_resources(text, uuid, uuid, public.resource_kind, text, integer, integer, uuid) from public, anon;
grant execute on function public.search_resources(text, uuid, uuid, public.resource_kind, text, integer, integer, uuid) to authenticated;

-- ---------------------------------------------------------------- contributor profile (public data only)
create function public.get_contributor_profile(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  v_uni text;
  v_res jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_user_id is distinct from auth.uid() and public.has_block_between(p_user_id) then
    return null;
  end if;
  select p.display_name, u.name into v_name, v_uni
    from public.profiles p left join public.universities u on u.id = p.university_id where p.id = p_user_id;
  if not found then
    return null;
  end if;
  select jsonb_build_object(
      'resource_count', count(*),
      'total_saves', coalesce(sum(r.save_count), 0),
      'rating_count', coalesce(sum(r.rating_count), 0),
      'avg_rating', coalesce(round(sum(r.avg_rating * r.rating_count) / nullif(sum(r.rating_count), 0), 2), 0))
    into v_res
    from public.resources r
    where r.uploader_id = p_user_id and r.status = 'published' and public.can_view_resource(r.id);
  return v_res || jsonb_build_object('user_id', p_user_id, 'display_name', v_name, 'university_name', v_uni);
end $$;
revoke all on function public.get_contributor_profile(uuid) from public, anon;
grant execute on function public.get_contributor_profile(uuid) to authenticated;

-- ---------------------------------------------------------------- shared quizzes / flashcard decks
alter table public.quizzes add column source_shared_quiz_id uuid;
create unique index quizzes_import_unique on public.quizzes (user_id, source_shared_quiz_id) where source_shared_quiz_id is not null;
alter table public.flashcards add column source_shared_deck_id uuid;
create index flashcards_import_idx on public.flashcards (user_id, source_shared_deck_id) where source_shared_deck_id is not null;

-- Provenance can only be set by the import functions (an imported copy cannot be re-shared).
create or replace function public.quizzes_guard_server_fields() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.server_generated := false;
      new.generation_hash := null;
      new.source_shared_quiz_id := null;
    else
      new.server_generated := old.server_generated;
      new.generation_hash := old.generation_hash;
      new.source_shared_quiz_id := old.source_shared_quiz_id;
    end if;
  end if;
  return new;
end $$;
create function public.flashcards_guard_source() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    new.source_shared_deck_id := null;
  end if;
  return new;
end $$;
create trigger flashcards_guard_source before insert on public.flashcards
  for each row execute function public.flashcards_guard_source();

create table public.shared_quizzes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  source_quiz_id uuid references public.quizzes(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  course_id uuid references public.courses(id) on delete set null,
  university_id uuid references public.universities(id) on delete set null,
  visibility public.resource_visibility not null default 'university' check (visibility <> 'private'),
  status public.content_status not null default 'pending',
  question_count integer not null check (question_count between 1 and 200),
  import_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index shared_quizzes_source_unique on public.shared_quizzes (owner_id, source_quiz_id)
  where source_quiz_id is not null and status <> 'removed';
create index shared_quizzes_listing_idx on public.shared_quizzes (created_at desc) where status = 'published';
create table public.shared_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  shared_quiz_id uuid not null references public.shared_quizzes(id) on delete cascade,
  position integer not null check (position >= 0),
  kind public.question_kind not null,
  prompt text not null,
  options jsonb check (options is null or jsonb_typeof(options) = 'array'),
  unique (shared_quiz_id, position)
);
-- Answer key of a snapshot: service role / security definer functions only.
create table public.shared_quiz_keys (
  question_id uuid primary key references public.shared_quiz_questions(id) on delete cascade,
  answer text not null,
  explanation text
);

create table public.shared_decks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  course_id uuid references public.courses(id) on delete set null,
  university_id uuid references public.universities(id) on delete set null,
  visibility public.resource_visibility not null default 'university' check (visibility <> 'private'),
  status public.content_status not null default 'pending',
  card_count integer not null check (card_count between 1 and 200),
  import_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shared_decks_listing_idx on public.shared_decks (created_at desc) where status = 'published';
create table public.shared_deck_cards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.shared_decks(id) on delete cascade,
  position integer not null check (position >= 0),
  front text not null,
  back text not null,
  unique (deck_id, position)
);

create trigger shared_quizzes_updated before update on public.shared_quizzes for each row execute function public.set_updated_at();
create trigger shared_decks_updated before update on public.shared_decks for each row execute function public.set_updated_at();

create function public.shared_visible(p_owner uuid, p_status public.content_status, p_vis public.resource_visibility, p_uni uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    p_owner = auth.uid() or public.is_moderator()
    or (p_status = 'published' and not public.has_block_between(p_owner)
        and (p_vis = 'public' or (p_vis = 'university' and p_uni is not null and p_uni = public.my_university_id()))))
$$;
revoke all on function public.shared_visible(uuid, public.content_status, public.resource_visibility, uuid) from public, anon;
grant execute on function public.shared_visible(uuid, public.content_status, public.resource_visibility, uuid) to authenticated, service_role;

alter table public.shared_quizzes enable row level security;
alter table public.shared_quiz_questions enable row level security;
alter table public.shared_quiz_keys enable row level security;
alter table public.shared_decks enable row level security;
alter table public.shared_deck_cards enable row level security;

create policy shared_quizzes_select on public.shared_quizzes for select to authenticated
  using (public.shared_visible(owner_id, status, visibility, university_id));
create policy shared_quizzes_delete on public.shared_quizzes for delete to authenticated
  using (owner_id = (select auth.uid()) or public.is_moderator());
create policy shared_quiz_questions_select on public.shared_quiz_questions for select to authenticated
  using (exists (select 1 from public.shared_quizzes s where s.id = shared_quiz_id));
create policy shared_decks_select on public.shared_decks for select to authenticated
  using (public.shared_visible(owner_id, status, visibility, university_id));
create policy shared_decks_delete on public.shared_decks for delete to authenticated
  using (owner_id = (select auth.uid()) or public.is_moderator());
create policy shared_deck_cards_select on public.shared_deck_cards for select to authenticated
  using (exists (select 1 from public.shared_decks s where s.id = deck_id));
create policy shared_quiz_keys_service on public.shared_quiz_keys for all to service_role using (true) with check (true);

revoke all on public.shared_quizzes, public.shared_quiz_questions, public.shared_decks, public.shared_deck_cards from anon;
revoke insert, update on public.shared_quizzes, public.shared_quiz_questions, public.shared_decks, public.shared_deck_cards from authenticated;
revoke all on public.shared_quiz_keys from public, anon, authenticated;
grant select, insert, update, delete on public.shared_quiz_keys to service_role;

create function public.share_quiz(p_quiz_id uuid, p_visibility public.resource_visibility default 'university') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_quiz public.quizzes;
  v_uni uuid;
  v_n integer;
  v_id uuid;
  v_q record;
  v_qid uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_visibility is null or p_visibility = 'private' then
    raise exception 'visibility must be university or public' using errcode = '22023';
  end if;
  select * into v_quiz from public.quizzes where id = p_quiz_id and user_id = v_uid;
  if not found then
    raise exception 'quiz not found' using errcode = '42501';
  end if;
  if v_quiz.source_shared_quiz_id is not null then
    raise exception 'an imported quiz cannot be shared again' using errcode = '42501';
  end if;
  select id into v_id from public.shared_quizzes where owner_id = v_uid and source_quiz_id = p_quiz_id and status <> 'removed';
  if found then
    return v_id; -- idempotent
  end if;
  select count(*) into v_n from public.questions where quiz_id = p_quiz_id;
  if v_n = 0 or v_n > 200 then
    raise exception 'quiz must have 1-200 questions' using errcode = '22023';
  end if;
  if (select count(*) from public.shared_quizzes s where s.owner_id = v_uid and s.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many shares today' using errcode = '54000';
  end if;
  select university_id into v_uni from public.profiles where id = v_uid;
  if p_visibility = 'university' and v_uni is null then
    raise exception 'university visibility needs a university on your profile' using errcode = '22023';
  end if;
  insert into public.shared_quizzes (owner_id, source_quiz_id, title, course_id, university_id, visibility, question_count)
  values (v_uid, p_quiz_id, v_quiz.title, v_quiz.course_id, v_uni, p_visibility, v_n) returning id into v_id;
  for v_q in select q.position, q.kind, q.prompt, q.options, k.answer, k.explanation
             from public.questions q join public.question_keys k on k.question_id = q.id
             where q.quiz_id = p_quiz_id order by q.position loop
    insert into public.shared_quiz_questions (shared_quiz_id, position, kind, prompt, options)
    values (v_id, v_q.position, v_q.kind, v_q.prompt, v_q.options) returning id into v_qid;
    insert into public.shared_quiz_keys (question_id, answer, explanation) values (v_qid, v_q.answer, v_q.explanation);
  end loop;
  if (select count(*) from public.shared_quiz_keys k join public.shared_quiz_questions q on q.id = k.question_id where q.shared_quiz_id = v_id) <> v_n then
    raise exception 'quiz has questions without an answer key' using errcode = '22023';
  end if;
  return v_id;
end $$;
revoke all on function public.share_quiz(uuid, public.resource_visibility) from public, anon;
grant execute on function public.share_quiz(uuid, public.resource_visibility) to authenticated;

-- Imports a published shared quiz as the caller's OWN quiz (server_generated = false, so it never pays XP). The key is
-- copied server-side into question_keys; the caller still only learns it through submit_quiz_attempt's result.
create function public.import_shared_quiz(p_shared_id uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_s public.shared_quizzes;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_s from public.shared_quizzes where id = p_shared_id;
  if not found or not public.shared_visible(v_s.owner_id, v_s.status, v_s.visibility, v_s.university_id) or v_s.status <> 'published' then
    raise exception 'shared quiz not found' using errcode = 'P0002';
  end if;
  if v_s.owner_id = v_uid then
    raise exception 'this is your own quiz' using errcode = '42501';
  end if;
  select id into v_id from public.quizzes where user_id = v_uid and source_shared_quiz_id = p_shared_id;
  if found then
    return v_id;
  end if;
  insert into public.quizzes (user_id, course_id, title, source_shared_quiz_id)
  values (v_uid, v_s.course_id, v_s.title, p_shared_id) returning id into v_id;
  insert into public.questions (quiz_id, position, kind, prompt, options, answer, explanation)
  select v_id, q.position, q.kind, q.prompt, q.options, k.answer, k.explanation
  from public.shared_quiz_questions q join public.shared_quiz_keys k on k.question_id = q.id
  where q.shared_quiz_id = p_shared_id;
  update public.shared_quizzes set import_count = import_count + 1 where id = p_shared_id;
  return v_id;
end $$;
revoke all on function public.import_shared_quiz(uuid) from public, anon;
grant execute on function public.import_shared_quiz(uuid) to authenticated;

create function public.share_flashcards(p_title text, p_card_ids uuid[], p_visibility public.resource_visibility default 'university',
                                        p_course_id uuid default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_uni uuid;
  v_ids uuid[];
  v_n integer;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'title must be 1-200 characters' using errcode = '22023';
  end if;
  if p_visibility is null or p_visibility = 'private' then
    raise exception 'visibility must be university or public' using errcode = '22023';
  end if;
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_card_ids, '{}')) x;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n not between 1 and 200 then
    raise exception 'share 1-200 cards' using errcode = '22023';
  end if;
  if (select count(*) from public.flashcards f where f.id = any(v_ids) and f.user_id = v_uid and f.source_shared_deck_id is null) <> v_n then
    raise exception 'cards not found (imported cards cannot be shared again)' using errcode = '42501';
  end if;
  if p_course_id is not null and not exists (select 1 from public.courses where id = p_course_id) then
    raise exception 'course not found' using errcode = '22023';
  end if;
  if (select count(*) from public.shared_decks s where s.owner_id = v_uid and s.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too many shares today' using errcode = '54000';
  end if;
  select university_id into v_uni from public.profiles where id = v_uid;
  if p_visibility = 'university' and v_uni is null then
    raise exception 'university visibility needs a university on your profile' using errcode = '22023';
  end if;
  insert into public.shared_decks (owner_id, title, course_id, university_id, visibility, card_count)
  values (v_uid, btrim(p_title), p_course_id, v_uni, p_visibility, v_n) returning id into v_id;
  insert into public.shared_deck_cards (deck_id, position, front, back)
  select v_id, (row_number() over (order by f.created_at, f.id) - 1)::integer, f.front, f.back
  from public.flashcards f where f.id = any(v_ids) and f.user_id = v_uid;
  return v_id;
end $$;
revoke all on function public.share_flashcards(text, uuid[], public.resource_visibility, uuid) from public, anon;
grant execute on function public.share_flashcards(text, uuid[], public.resource_visibility, uuid) to authenticated;

-- Copies the deck into the caller's flashcards (due now). Returns the number of cards created (0 = already imported).
create function public.import_shared_deck(p_deck_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_d public.shared_decks;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_d from public.shared_decks where id = p_deck_id;
  if not found or not public.shared_visible(v_d.owner_id, v_d.status, v_d.visibility, v_d.university_id) or v_d.status <> 'published' then
    raise exception 'shared deck not found' using errcode = 'P0002';
  end if;
  if v_d.owner_id = v_uid then
    raise exception 'this is your own deck' using errcode = '42501';
  end if;
  if exists (select 1 from public.flashcards where user_id = v_uid and source_shared_deck_id = p_deck_id) then
    return 0;
  end if;
  insert into public.flashcards (user_id, front, back, source_shared_deck_id)
  select v_uid, c.front, c.back, p_deck_id from public.shared_deck_cards c where c.deck_id = p_deck_id order by c.position;
  get diagnostics v_n = row_count;
  update public.shared_decks set import_count = import_count + 1 where id = p_deck_id;
  return v_n;
end $$;
revoke all on function public.import_shared_deck(uuid) from public, anon;
grant execute on function public.import_shared_deck(uuid) to authenticated;
