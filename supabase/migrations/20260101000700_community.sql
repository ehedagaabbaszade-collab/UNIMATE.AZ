create table public.communities (
  id uuid primary key default gen_random_uuid(),
  university_id uuid references public.universities(id) on delete set null,
  name text not null check (length(btrim(name)) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  description text check (description is null or length(description) <= 1000),
  visibility public.community_visibility not null default 'public',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communities_university_idx on public.communities(university_id);

create table public.memberships (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.community_role not null default 'member',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  -- NULL for anonymous questions; the real author lives in post_private_authors.
  author_id uuid references public.profiles(id) on delete cascade,
  is_anonymous boolean not null default false,
  kind public.post_kind not null default 'post',
  title text not null check (length(btrim(title)) between 1 and 300),
  body text not null check (length(body) <= 20000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_anonymous = (author_id is null)),
  check (not is_anonymous or kind = 'question')
);
create index posts_community_idx on public.posts(community_id, created_at desc) where deleted_at is null;
create index posts_author_idx on public.posts(author_id);

create table public.post_private_authors (
  post_id uuid primary key references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index post_private_authors_author_idx on public.post_private_authors(author_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 10000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comments_post_idx on public.comments(post_id, created_at);
create index comments_author_idx on public.comments(author_id);

create table public.reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  kind text not null default 'like' check (kind in ('like', 'helpful', 'insightful', 'funny')),
  created_at timestamptz not null default now(),
  check ((post_id is null) <> (comment_id is null))
);
create unique index reactions_post_unique on public.reactions(user_id, post_id, kind) where post_id is not null;
create unique index reactions_comment_unique on public.reactions(user_id, comment_id, kind) where comment_id is not null;
create index reactions_post_idx on public.reactions(post_id);
create index reactions_comment_idx on public.reactions(comment_id);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows(followee_id);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks(blocked_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.comments(id) on delete cascade,
  resource_id uuid references public.resources(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete cascade,
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  status public.report_status not null default 'open',
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id, resource_id, reported_user_id) = 1)
);
create index reports_open_idx on public.reports(created_at) where status = 'open';
create index reports_reporter_idx on public.reports(reporter_id);

-- Creator automatically becomes the community owner (bypasses the membership insert policy).
create function public.handle_new_community() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.memberships (community_id, user_id, role, status)
  values (new.id, new.created_by, 'owner', 'active')
  on conflict do nothing;
  return new;
end $$;
create trigger communities_add_owner after insert on public.communities
  for each row execute function public.handle_new_community();

-- Authorship/anonymity of posts is immutable for API roles.
create function public.guard_post_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user in ('anon', 'authenticated') and (
       new.author_id is distinct from old.author_id
    or new.is_anonymous is distinct from old.is_anonymous
    or new.community_id is distinct from old.community_id) then
    raise exception 'post authorship and community are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger posts_guard_update before update on public.posts
  for each row execute function public.guard_post_update();
