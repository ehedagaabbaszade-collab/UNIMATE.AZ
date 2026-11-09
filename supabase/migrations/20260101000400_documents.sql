create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  original_filename text,
  storage_path text not null unique,
  mime_type text not null default 'application/pdf',
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 104857600),
  status public.doc_status not null default 'pending_upload',
  page_count integer check (page_count is null or page_count >= 0),
  idempotency_key text not null check (length(idempotency_key) between 8 and 128),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  -- storage objects live under <user_id>/..., matching the storage owner-folder policy
  check (storage_path like user_id::text || '/%')
);
create index documents_user_idx on public.documents(user_id, created_at desc);
create index documents_course_idx on public.documents(course_id);
create index documents_status_idx on public.documents(status) where status in ('processing', 'failed');

-- API roles may only move a document pending_upload -> uploaded; the pipeline owns the rest.
create function public.guard_document_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.user_id is distinct from old.user_id
       or new.storage_path is distinct from old.storage_path
       or new.page_count is distinct from old.page_count
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'protected document columns are immutable' using errcode = '42501';
    end if;
    if new.status is distinct from old.status
       and not (old.status = 'pending_upload' and new.status = 'uploaded') then
      raise exception 'status is managed by the processing pipeline' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger documents_guard_update before update on public.documents
  for each row execute function public.guard_document_update();

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number >= 1),
  content text not null default '',
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  page_start integer check (page_start is null or page_start >= 1),
  page_end integer check (page_end is null or page_end >= 1),
  content text not null check (length(content) > 0),
  token_count integer check (token_count is null or token_count >= 0),
  embedding extensions.vector(1536),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  check (page_start is null or page_end is null or page_end >= page_start)
);
create index document_chunks_embedding_hnsw on public.document_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  version integer not null check (version >= 1),
  template text not null,
  model text,
  is_active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (name, version)
);
create unique index prompt_versions_one_active on public.prompt_versions(name) where is_active;

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  kind text not null default 'overview' check (kind in ('overview', 'detailed', 'bullets')),
  content text not null,
  model text,
  prompt_version_id uuid references public.prompt_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index summaries_document_idx on public.summaries(document_id);
create index summaries_user_idx on public.summaries(user_id);

-- security invoker: RLS applies; ownership is additionally enforced explicitly.
create function public.match_chunks(query_embedding extensions.vector(1536), doc_id uuid, k integer default 8)
returns table (id uuid, document_id uuid, chunk_index integer, page_start integer, page_end integer, content text, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  select c.id, c.document_id, c.chunk_index, c.page_start, c.page_end, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.document_chunks c
  join public.documents d on d.id = c.document_id
  where c.document_id = doc_id
    and d.user_id = auth.uid()
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(1, least(coalesce(k, 8), 50))
$$;
revoke all on function public.match_chunks(extensions.vector, uuid, integer) from public, anon;
grant execute on function public.match_chunks(extensions.vector, uuid, integer) to authenticated, service_role;
