create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan public.sub_plan not null default 'free',
  status public.sub_status not null default 'active',
  provider text check (provider is null or length(provider) <= 50),
  provider_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null or current_period_end > current_period_start)
);
create unique index subscriptions_one_live on public.subscriptions(user_id) where status in ('active', 'trialing', 'past_due');
create unique index subscriptions_provider_ref_key on public.subscriptions(provider, provider_ref) where provider_ref is not null;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null check (length(btrim(feature)) between 1 and 50),
  model text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  created_at timestamptz not null default now()
);
create index ai_usage_user_idx on public.ai_usage(user_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (length(btrim(kind)) between 1 and 50),
  title text not null check (length(title) <= 200),
  body text check (body is null or length(body) <= 2000),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
create index notifications_unread_idx on public.notifications(user_id) where read_at is null;

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('extract_text', 'chunk', 'embed', 'summarize', 'generate_quiz', 'generate_flashcards')),
  state public.job_state not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_after timestamptz not null default now(),
  last_error text,
  locked_at timestamptz,
  locked_by text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  idempotency_key text not null unique check (length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attempts <= max_attempts),
  check (state <> 'running' or locked_at is not null)
);
create index processing_jobs_queue_idx on public.processing_jobs(run_after) where state = 'queued';
create index processing_jobs_document_idx on public.processing_jobs(document_id);
create index processing_jobs_user_idx on public.processing_jobs(user_id);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null check (length(btrim(action)) between 1 and 100),
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

-- Append-only, for everyone including service_role.
create function public.audit_logs_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (length(btrim(kind)) between 1 and 50),
  points integer not null check (points between -10000 and 10000 and points <> 0),
  source_key text,
  created_at timestamptz not null default now()
);
create unique index xp_events_source_key on public.xp_events(user_id, kind, source_key) where source_key is not null;
create index xp_events_user_idx on public.xp_events(user_id, created_at desc);

create table public.streaks (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  current_streak integer not null default 0 check (current_streak >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  last_active_date date,
  updated_at timestamptz not null default now(),
  check (longest_streak >= current_streak)
);
