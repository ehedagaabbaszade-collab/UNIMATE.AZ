-- Legal documents, append-only consent ledger, private birth date, 16+ check, signup enforcement.

create table public.legal_documents (
  slug text not null,
  version text not null,
  content_hash text not null,
  effective_at timestamptz not null default now(),
  requires_reconsent boolean not null default true,
  archived_at timestamptz,
  primary key (slug, version)
);
alter table public.legal_documents enable row level security;
create policy legal_documents_read on public.legal_documents for select to anon, authenticated using (true);
revoke all on public.legal_documents from public, anon, authenticated;
grant select on public.legal_documents to anon, authenticated;
grant all on public.legal_documents to service_role;

-- content_hash is a placeholder until the final texts exist.
insert into public.legal_documents (slug, version, content_hash) values
  ('terms', '0.1', 'draft-0.1'),
  ('privacy', '0.1', 'draft-0.1'),
  ('ai-disclaimer', '0.1', 'draft-0.1');

create function public.current_legal_version(p_slug text) returns public.legal_documents
language sql stable set search_path = '' as $$
  select d from public.legal_documents d
  where d.slug = p_slug and d.archived_at is null and d.effective_at <= now()
  order by d.effective_at desc, d.version desc limit 1
$$;
revoke all on function public.current_legal_version(text) from public, anon, authenticated, service_role;
grant execute on function public.current_legal_version(text) to anon, authenticated, service_role;

create table public.user_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'privacy_notice', 'ai_disclaimer', 'marketing')),
  action text not null check (action in ('granted', 'withdrawn')),
  document_slug text,
  document_version text,
  document_hash text,
  platform text not null check (platform in ('web', 'ios', 'android', 'unknown')),
  context text not null check (context in ('signup', 'reconsent', 'settings', 'checkout')),
  created_at timestamptz not null default now()
);
create index user_consents_user_idx on public.user_consents (user_id, consent_type, id desc);
alter table public.user_consents enable row level security;
create policy user_consents_select_own on public.user_consents for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.user_consents from public, anon, authenticated;
grant select on public.user_consents to authenticated;
revoke all on public.user_consents from service_role;
grant select, insert, delete on public.user_consents to service_role;
revoke all on sequence public.user_consents_id_seq from public, anon, authenticated, service_role;
grant usage on sequence public.user_consents_id_seq to service_role;

-- Rows are never edited. DELETE stays possible (auth.users cascade / service role) so account purge works.
create function public.user_consents_no_update() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'user_consents is append-only' using errcode = 'P0001';
end $$;
revoke all on function public.user_consents_no_update() from public, anon, authenticated, service_role;
create trigger user_consents_no_update before update on public.user_consents
  for each row execute function public.user_consents_no_update();

create table public.user_private (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date not null,
  updated_at timestamptz default now()
);
alter table public.user_private enable row level security;
create policy user_private_select_own on public.user_private for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.user_private from public, anon, authenticated;
grant select on public.user_private to authenticated;
grant all on public.user_private to service_role;

create function public.is_min_age(p_birth date) returns boolean
language sql stable set search_path = '' as $$
  select p_birth is not null
    and p_birth >= date '1900-01-01'
    and p_birth <= ((now() at time zone 'Asia/Baku')::date - interval '16 years')::date
$$;
revoke all on function public.is_min_age(date) from public, anon, authenticated, service_role;
grant execute on function public.is_min_age(date) to anon, authenticated, service_role;

create function public.consent_slug(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type when 'terms' then 'terms' when 'privacy_notice' then 'privacy'
    when 'ai_disclaimer' then 'ai-disclaimer' end
$$;
revoke all on function public.consent_slug(text) from public, anon, authenticated, service_role;
grant execute on function public.consent_slug(text) to service_role;

-- Shared by signup and record_consents: one 'granted' row with the server-side current version.
create function public.insert_consent(p_user uuid, p_type text, p_action text, p_platform text, p_context text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.legal_documents;
begin
  if p_type <> 'marketing' then
    v := public.current_legal_version(public.consent_slug(p_type));
    if v.slug is null then raise exception 'NO_CURRENT_DOCUMENT' using errcode = 'P0001'; end if;
  end if;
  insert into public.user_consents
    (user_id, consent_type, action, document_slug, document_version, document_hash, platform, context)
  values (p_user, p_type, p_action, v.slug, v.version, v.content_hash, p_platform, p_context);
end $$;
revoke all on function public.insert_consent(uuid, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.insert_consent(uuid, text, text, text, text) to service_role;

-- Same behaviour as before (profile + trimmed display_name); consent/age enforcement only for Supabase Auth signups.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_raw text := new.raw_user_meta_data ->> 'birth_date';
  v_birth date;
  v_consents text[];
  v_platform text := new.raw_user_meta_data ->> 'platform';
  v_type text;
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), ''))
  on conflict (id) do nothing;

  -- Only email/password signups carry birth date + consents in metadata. Dashboard "Add user", invites and any
  -- future OAuth path cannot, so those users are gated in-app (legal_profile_status / legal_consent_status).
  if new.raw_app_meta_data ->> 'provider' = 'email'
     and coalesce(new.raw_app_meta_data ->> 'consent_exempt', '') <> 'true' then
    if v_raw ~ '^\d{4}-\d{2}-\d{2}$' then
      begin v_birth := v_raw::date; exception when others then v_birth := null; end;
    end if;
    if v_birth is null then
      raise exception 'BIRTH_DATE_REQUIRED' using errcode = 'P0001';
    end if;
    if not public.is_min_age(v_birth) then
      raise exception 'UNDERAGE' using errcode = 'P0001';
    end if;

    if jsonb_typeof(new.raw_user_meta_data -> 'consents') = 'array' then
      select array_agg(value) into v_consents from jsonb_array_elements_text(new.raw_user_meta_data -> 'consents');
    end if;
    if not (coalesce(v_consents, '{}') @> array['terms', 'privacy_notice', 'ai_disclaimer']) then
      raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
    end if;
    if v_platform is null or v_platform not in ('web', 'ios', 'android') then v_platform := 'unknown'; end if;

    insert into public.user_private (user_id, birth_date) values (new.id, v_birth);
    foreach v_type in array array['terms', 'privacy_notice', 'ai_disclaimer'] loop
      perform public.insert_consent(new.id, v_type, 'granted', v_platform, 'signup');
    end loop;
    if 'marketing' = any (v_consents) then
      perform public.insert_consent(new.id, 'marketing', 'granted', v_platform, 'signup');
    end if;
  end if;
  return new;
end $$;

create function public.legal_consent_status()
returns table (consent_type text, required boolean, current_version text, accepted_version text,
               granted boolean, needs_action boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  return query
  select t.ct, t.req, d.version, l.document_version, coalesce(l.action = 'granted', false),
    t.req and (l.action is distinct from 'granted'
      or (l.document_version is distinct from d.version and coalesce(d.requires_reconsent, false)))
  from (values ('terms', true, 'terms'), ('privacy_notice', true, 'privacy'),
               ('ai_disclaimer', true, 'ai-disclaimer'), ('marketing', false, null)) as t(ct, req, slug)
  left join lateral (select x.version, x.requires_reconsent from public.current_legal_version(t.slug) x) d on true
  left join lateral (
    select c.action, c.document_version from public.user_consents c
    where c.user_id = auth.uid() and c.consent_type = t.ct order by c.id desc limit 1
  ) l on true;
end $$;

create function public.legal_profile_status() returns table (has_birth_date boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  return query select exists (select 1 from public.user_private where user_id = auth.uid());
end $$;

create function public.record_consents(p_types text[], p_platform text, p_context text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_type text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if p_types is null or cardinality(p_types) = 0
     or not (p_types <@ array['terms', 'privacy_notice', 'ai_disclaimer', 'marketing']) then
    raise exception 'INVALID_CONSENT_TYPE' using errcode = 'P0001';
  end if;
  if p_platform is null or p_platform not in ('web', 'ios', 'android', 'unknown') then
    raise exception 'INVALID_PLATFORM' using errcode = 'P0001';
  end if;
  if p_context is null or p_context not in ('reconsent', 'settings') then
    raise exception 'INVALID_CONTEXT' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.user_private where user_id = auth.uid()) then
    raise exception 'BIRTH_DATE_REQUIRED' using errcode = 'P0001';
  end if;
  foreach v_type in array (select array_agg(distinct x) from unnest(p_types) x) loop
    perform public.insert_consent(auth.uid(), v_type, 'granted', p_platform, p_context);
  end loop;
end $$;

create function public.withdraw_consent(p_type text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  -- TODO: withdrawing a required consent means deleting the account; wire that flow here later.
  if p_type in ('terms', 'privacy_notice', 'ai_disclaimer') then
    raise exception 'REQUIRED_CONSENT' using errcode = 'P0001';
  elsif p_type is distinct from 'marketing' then
    raise exception 'INVALID_CONSENT_TYPE' using errcode = 'P0001';
  end if;
  perform public.insert_consent(auth.uid(), 'marketing', 'withdrawn', 'unknown', 'settings');
end $$;

create function public.set_birth_date(p_birth date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '28000'; end if;
  if exists (select 1 from public.user_private where user_id = auth.uid()) then
    raise exception 'BIRTH_DATE_LOCKED' using errcode = 'P0001';
  end if;
  if p_birth is null or p_birth < date '1900-01-01' or p_birth > (now() at time zone 'Asia/Baku')::date then
    raise exception 'INVALID_BIRTH_DATE' using errcode = 'P0001';
  end if;
  if not public.is_min_age(p_birth) then raise exception 'UNDERAGE' using errcode = 'P0001'; end if;
  insert into public.user_private (user_id, birth_date) values (auth.uid(), p_birth);
end $$;

revoke all on function public.legal_consent_status() from public, anon, authenticated, service_role;
revoke all on function public.legal_profile_status() from public, anon, authenticated, service_role;
revoke all on function public.record_consents(text[], text, text) from public, anon, authenticated, service_role;
revoke all on function public.withdraw_consent(text) from public, anon, authenticated, service_role;
revoke all on function public.set_birth_date(date) from public, anon, authenticated, service_role;
grant execute on function public.legal_consent_status() to authenticated;
grant execute on function public.legal_profile_status() to authenticated;
grant execute on function public.record_consents(text[], text, text) to authenticated;
grant execute on function public.withdraw_consent(text) to authenticated;
grant execute on function public.set_birth_date(date) to authenticated;
