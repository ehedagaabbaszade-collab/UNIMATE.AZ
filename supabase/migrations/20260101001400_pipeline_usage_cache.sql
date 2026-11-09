-- Pipeline support: atomic quota counters, generation cache, wider summary kinds.

-- Per-user counters for atomic conditional increment (UPDATE ... WHERE n < limit RETURNING).
-- period_start is a UTC date: the day for 'ai_message', the first of the month for 'upload_doc'.
create table public.usage_counters (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('ai_message', 'upload_doc')),
  period_start date not null,
  n integer not null default 0 check (n >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, period_start)
);

-- Cache of structured generations, keyed by (document, prompt version, params hash).
create table public.generation_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  prompt_version_id uuid not null references public.prompt_versions(id) on delete cascade,
  params_hash text not null check (length(params_hash) between 8 and 128),
  output jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  unique (document_id, prompt_version_id, params_hash)
);
create index generation_cache_user_idx on public.generation_cache(user_id);

alter table public.summaries drop constraint summaries_kind_check;
alter table public.summaries add constraint summaries_kind_check
  check (kind in ('overview', 'detailed', 'bullets', 'short', 'exam'));

-- Same pattern as the other pipeline-owned tables: owners read, only service_role writes.
alter table public.usage_counters enable row level security;
alter table public.generation_cache enable row level security;
revoke all on public.usage_counters, public.generation_cache from anon;
revoke insert, update, delete on public.usage_counters, public.generation_cache from authenticated;
revoke truncate, references, trigger on public.usage_counters, public.generation_cache from authenticated;
create policy usage_counters_owner_select on public.usage_counters for select to authenticated
  using (user_id = (select auth.uid()));
create policy generation_cache_owner_select on public.generation_cache for select to authenticated
  using (user_id = (select auth.uid()));
create policy usage_counters_service_all on public.usage_counters for all to service_role using (true) with check (true);
create policy generation_cache_service_all on public.generation_cache for all to service_role using (true) with check (true);
