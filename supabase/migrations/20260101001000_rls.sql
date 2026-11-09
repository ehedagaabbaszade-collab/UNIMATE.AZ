-- Helpers, updated_at triggers, RLS and policies.
-- Helpers are SECURITY DEFINER with a fixed search_path so that policies on one table can consult
-- another (memberships, blocks, post_private_authors) without inheriting that table's RLS
-- (which would otherwise hide rows from the very user being checked, or recurse infinitely).

create function public.is_member(p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.community_id = p_community and m.user_id = auth.uid() and m.status = 'active')
$$;

create function public.is_community_mod(p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.memberships m
    where m.community_id = p_community and m.user_id = auth.uid()
      and m.status = 'active' and m.role in ('moderator', 'owner'))
$$;

create function public.community_is_public(p_community uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.communities c where c.id = p_community and c.visibility = 'public')
$$;

-- True when either user has blocked the other (symmetric hiding).
create function public.has_block_between(p_other uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_other is not null and auth.uid() is not null and exists (
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = p_other)
       or (b.blocker_id = p_other and b.blocked_id = auth.uid()))
$$;

create function public.my_university_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select university_id from public.profiles where id = auth.uid()
$$;

create function public.owns_anon_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.post_private_authors a where a.post_id = p_post and a.author_id = auth.uid())
$$;

create function public.can_view_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post
      and (public.is_moderator() or p.author_id = auth.uid() or public.owns_anon_post(p.id)
           or (p.deleted_at is null
               and (public.community_is_public(p.community_id) or public.is_member(p.community_id))
               and not public.has_block_between(p.author_id))))
$$;

create function public.can_view_comment(p_comment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.comments c
    where c.id = p_comment
      and (public.is_moderator() or c.author_id = auth.uid()
           or (c.deleted_at is null and not public.has_block_between(c.author_id)
               and public.can_view_post(c.post_id))))
$$;

create function public.can_comment_on_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.can_view_post(p_post) and exists (
    select 1 from public.posts p where p.id = p_post and p.deleted_at is null and public.is_member(p.community_id))
$$;

create function public.can_view_resource(p_resource uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.resources r
    where r.id = p_resource
      and (r.uploader_id = auth.uid() or public.is_moderator()
           or (r.status = 'published' and not public.has_block_between(r.uploader_id)
               and (r.visibility = 'public'
                    or (r.visibility = 'university' and r.university_id is not null
                        and r.university_id = public.my_university_id())))))
$$;

-- Anonymous question: public row has author_id NULL; real author is stored in post_private_authors.
create function public.create_anonymous_post(p_community uuid, p_title text, p_body text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_member(p_community) then
    raise exception 'must be an active member of the community' using errcode = '42501';
  end if;
  insert into public.posts (community_id, author_id, is_anonymous, kind, title, body)
  values (p_community, null, true, 'question', p_title, p_body)
  returning id into v_id;
  insert into public.post_private_authors (post_id, author_id) values (v_id, v_uid);
  return v_id;
end $$;

revoke all on function
  public.is_member(uuid), public.is_community_mod(uuid), public.community_is_public(uuid),
  public.has_block_between(uuid), public.my_university_id(), public.owns_anon_post(uuid),
  public.can_view_post(uuid), public.can_view_comment(uuid), public.can_comment_on_post(uuid),
  public.can_view_resource(uuid), public.create_anonymous_post(uuid, text, text)
  from public, anon;
grant execute on function
  public.is_member(uuid), public.is_community_mod(uuid), public.community_is_public(uuid),
  public.has_block_between(uuid), public.my_university_id(), public.owns_anon_post(uuid),
  public.can_view_post(uuid), public.can_view_comment(uuid), public.can_comment_on_post(uuid),
  public.can_view_resource(uuid)
  to anon, authenticated, service_role;
grant execute on function public.create_anonymous_post(uuid, text, text) to authenticated, service_role;

-- updated_at triggers on every table that has the column.
do $$
declare r record;
begin
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   r.table_name || '_set_updated_at', r.table_name);
  end loop;
end $$;

-- Enable RLS on every table in public.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- Privileges: defence in depth on top of RLS.
revoke all on all tables in schema public from anon;
grant select on public.universities, public.faculties, public.majors, public.courses to anon;
-- TRUNCATE ignores RLS, so API roles must never hold it.
revoke truncate, references, trigger on all tables in schema public from authenticated;
-- Pipeline-owned tables: API roles can read (via policy) but never write.
revoke insert, update, delete on
  public.processing_jobs, public.audit_logs, public.ai_usage, public.subscriptions, public.xp_events,
  public.streaks, public.post_private_authors, public.document_pages, public.document_chunks, public.summaries
  from authenticated;
grant insert, update, delete on
  public.processing_jobs, public.audit_logs, public.ai_usage, public.subscriptions, public.xp_events,
  public.streaks, public.post_private_authors, public.document_pages, public.document_chunks, public.summaries,
  public.notifications
  to service_role;
-- chunks/pages/summaries: owners may still delete their own derived data.
grant delete on public.document_pages, public.document_chunks, public.summaries to authenticated;
revoke insert on public.notifications from authenticated;

-- ---------------------------------------------------------------- reference data
do $$
declare t text;
begin
  foreach t in array array['universities', 'faculties', 'majors', 'courses'] loop
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_admin_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_admin_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- profiles
create policy profiles_select on public.profiles for select to authenticated
  using ((select auth.uid()) is not null and (id = (select auth.uid()) or public.is_admin() or not public.has_block_between(id)));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------- plain owner-CRUD tables (user_id)
do $$
declare
  r record;
  doc_check constant text := '({t}.document_id is null or exists (select 1 from public.documents d where d.id = {t}.document_id and d.user_id = (select auth.uid())))';
  extra text;
begin
  for r in select * from (values
    ('enrollments', 'true'),
    ('study_sessions', 'true'),
    ('tasks', 'true'),
    ('exams', 'true'),
    ('timetable_entries', 'true'),
    ('flashcards', doc_check),
    ('quizzes', doc_check),
    ('conversations', doc_check),
    ('attempts', 'exists (select 1 from public.quizzes q where q.id = attempts.quiz_id and q.user_id = (select auth.uid()))'),
    ('resource_saves', 'public.can_view_resource(resource_saves.resource_id)')
  ) as v(t, chk)
  loop
    extra := replace(r.chk, '{t}', r.t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', r.t || '_owner_select', r.t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()) and %s)', r.t || '_owner_insert', r.t, extra);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', r.t || '_owner_delete', r.t);
    if r.t <> 'resource_saves' then
      execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and %s)', r.t || '_owner_update', r.t, extra);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- documents (owner only)
create policy documents_owner_select on public.documents for select to authenticated using (user_id = (select auth.uid()));
create policy documents_owner_insert on public.documents for insert to authenticated with check (user_id = (select auth.uid()));
create policy documents_owner_update on public.documents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy documents_owner_delete on public.documents for delete to authenticated using (user_id = (select auth.uid()));

create policy document_pages_owner_select on public.document_pages for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_pages.document_id and d.user_id = (select auth.uid())));
create policy document_pages_owner_delete on public.document_pages for delete to authenticated
  using (exists (select 1 from public.documents d where d.id = document_pages.document_id and d.user_id = (select auth.uid())));

create policy document_chunks_owner_select on public.document_chunks for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_chunks.document_id and d.user_id = (select auth.uid())));
create policy document_chunks_owner_delete on public.document_chunks for delete to authenticated
  using (exists (select 1 from public.documents d where d.id = document_chunks.document_id and d.user_id = (select auth.uid())));

create policy summaries_owner_select on public.summaries for select to authenticated using (user_id = (select auth.uid()));
create policy summaries_owner_delete on public.summaries for delete to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- AI: messages, questions, usage, prompts
do $$
declare
  c constant text := 'exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = (select auth.uid()))';
begin
  execute format('create policy messages_owner_select on public.messages for select to authenticated using (%s)', c);
  execute format('create policy messages_owner_insert on public.messages for insert to authenticated with check (%s)', c);
  execute format('create policy messages_owner_update on public.messages for update to authenticated using (%s) with check (%s)', c, c);
  execute format('create policy messages_owner_delete on public.messages for delete to authenticated using (%s)', c);
end $$;

do $$
declare
  c constant text := 'exists (select 1 from public.quizzes q where q.id = questions.quiz_id and q.user_id = (select auth.uid()))';
begin
  execute format('create policy questions_owner_select on public.questions for select to authenticated using (%s)', c);
  execute format('create policy questions_owner_insert on public.questions for insert to authenticated with check (%s)', c);
  execute format('create policy questions_owner_update on public.questions for update to authenticated using (%s) with check (%s)', c, c);
  execute format('create policy questions_owner_delete on public.questions for delete to authenticated using (%s)', c);
end $$;

create policy ai_usage_owner_select on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

create policy prompt_versions_admin_select on public.prompt_versions for select to authenticated using (public.is_admin());
create policy prompt_versions_admin_insert on public.prompt_versions for insert to authenticated with check (public.is_admin());
create policy prompt_versions_admin_update on public.prompt_versions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy prompt_versions_admin_delete on public.prompt_versions for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- resources
create policy resources_select on public.resources for select to authenticated
  using ((select auth.uid()) is not null and (uploader_id = (select auth.uid()) or public.is_moderator()
         or (status = 'published' and not public.has_block_between(uploader_id)
             and (visibility = 'public'
                  or (visibility = 'university' and university_id is not null and university_id = public.my_university_id())))));
create policy resources_insert on public.resources for insert to authenticated
  with check (uploader_id = (select auth.uid()));
create policy resources_update on public.resources for update to authenticated
  using (uploader_id = (select auth.uid()) or public.is_moderator())
  with check (uploader_id = (select auth.uid()) or public.is_moderator());
create policy resources_delete on public.resources for delete to authenticated
  using (uploader_id = (select auth.uid()) or public.is_moderator());

create policy resource_ratings_select on public.resource_ratings for select to authenticated
  using (user_id = (select auth.uid()) or public.can_view_resource(resource_id));
create policy resource_ratings_insert on public.resource_ratings for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_view_resource(resource_id));
create policy resource_ratings_update on public.resource_ratings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.can_view_resource(resource_id));
create policy resource_ratings_delete on public.resource_ratings for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_moderator());

create policy takedown_select on public.takedown_requests for select to authenticated
  using (requester_id = (select auth.uid()) or public.is_moderator());
create policy takedown_insert on public.takedown_requests for insert to authenticated
  with check (requester_id = (select auth.uid()) and status = 'open');
create policy takedown_update on public.takedown_requests for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- ---------------------------------------------------------------- communities
create policy communities_select on public.communities for select to authenticated
  using ((select auth.uid()) is not null and (visibility = 'public' or created_by = (select auth.uid()) or public.is_member(id) or public.is_admin()));
create policy communities_insert on public.communities for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy communities_update on public.communities for update to authenticated
  using (public.is_community_mod(id) or public.is_admin())
  with check (public.is_community_mod(id) or public.is_admin());
create policy communities_delete on public.communities for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_admin());

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(community_id) or public.is_admin());
create policy memberships_join on public.memberships for insert to authenticated
  with check (user_id = (select auth.uid()) and role = 'member'
              and status = (case when public.community_is_public(community_id) then 'active' else 'pending' end)::public.membership_status);
create policy memberships_mod_update on public.memberships for update to authenticated
  using (public.is_community_mod(community_id) or public.is_admin())
  with check (public.is_community_mod(community_id) or public.is_admin());
create policy memberships_leave on public.memberships for delete to authenticated
  using ((user_id = (select auth.uid()) and status <> 'banned') or public.is_community_mod(community_id) or public.is_admin());

-- posts: membership-based visibility, blocks respected, anonymous author hidden by construction
create policy posts_select on public.posts for select to authenticated
  using (public.is_moderator() or author_id = (select auth.uid()) or public.owns_anon_post(id)
         or (deleted_at is null
             and (public.community_is_public(community_id) or public.is_member(community_id))
             and not public.has_block_between(author_id)));
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = (select auth.uid()) and not is_anonymous and deleted_at is null
              and public.is_member(community_id));
create policy posts_update on public.posts for update to authenticated
  using (author_id = (select auth.uid()) or public.owns_anon_post(id) or public.is_moderator() or public.is_community_mod(community_id))
  with check (author_id = (select auth.uid()) or public.owns_anon_post(id) or public.is_moderator() or public.is_community_mod(community_id));
create policy posts_delete on public.posts for delete to authenticated
  using (author_id = (select auth.uid()) or public.owns_anon_post(id) or public.is_moderator() or public.is_community_mod(community_id));

create policy post_private_authors_select on public.post_private_authors for select to authenticated
  using (author_id = (select auth.uid()) or public.is_admin());

create policy comments_select on public.comments for select to authenticated
  using (public.is_moderator() or author_id = (select auth.uid())
         or (deleted_at is null and not public.has_block_between(author_id) and public.can_view_post(post_id)));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_comment_on_post(post_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid()) or public.is_moderator())
  with check (author_id = (select auth.uid()) or public.is_moderator());
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid()) or public.is_moderator());

create policy reactions_select on public.reactions for select to authenticated
  using (user_id = (select auth.uid())
         or (post_id is not null and public.can_view_post(post_id))
         or (comment_id is not null and public.can_view_comment(comment_id)));
create policy reactions_insert on public.reactions for insert to authenticated
  with check (user_id = (select auth.uid())
              and (post_id is null or public.can_view_post(post_id))
              and (comment_id is null or public.can_view_comment(comment_id)));
create policy reactions_delete on public.reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy follows_select on public.follows for select to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and not public.has_block_between(followee_id));
create policy follows_delete on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));

create policy blocks_select on public.blocks for select to authenticated
  using (blocker_id = (select auth.uid()) or public.is_admin());
create policy blocks_insert on public.blocks for insert to authenticated
  with check (blocker_id = (select auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

create policy reports_select on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_moderator());
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = (select auth.uid()) and status = 'open');
create policy reports_update on public.reports for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
create policy reports_delete on public.reports for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- events, listings
create policy events_select on public.events for select to authenticated
  using ((select auth.uid()) is not null and (created_by = (select auth.uid()) or public.is_moderator()
         or (status = 'published'
             and (community_id is null or public.community_is_public(community_id) or public.is_member(community_id)))));
create policy events_insert on public.events for insert to authenticated
  with check (created_by = (select auth.uid()) and status = 'pending'
              and (community_id is null or public.is_member(community_id)));
create policy events_update on public.events for update to authenticated
  using (created_by = (select auth.uid()) or public.is_moderator())
  with check (created_by = (select auth.uid()) or public.is_moderator());
create policy events_delete on public.events for delete to authenticated
  using (created_by = (select auth.uid()) or public.is_moderator());

create policy job_listings_select on public.job_listings for select to authenticated
  using ((select auth.uid()) is not null and (is_active or public.is_admin()));
create policy job_listings_admin_insert on public.job_listings for insert to authenticated with check (public.is_admin());
create policy job_listings_admin_update on public.job_listings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy job_listings_admin_delete on public.job_listings for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------- platform
create policy subscriptions_owner_select on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_owner_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_owner_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notifications_owner_delete on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
create policy xp_events_owner_select on public.xp_events for select to authenticated using (user_id = (select auth.uid()));
create policy streaks_owner_select on public.streaks for select to authenticated using (user_id = (select auth.uid()));
create policy processing_jobs_owner_select on public.processing_jobs for select to authenticated using (user_id = (select auth.uid()));
create policy audit_logs_admin_select on public.audit_logs for select to authenticated using (public.is_admin());

-- service_role: explicit full-access policies on pipeline-owned tables (service_role also has BYPASSRLS on Supabase).
do $$
declare t text;
begin
  foreach t in array array['document_pages', 'document_chunks', 'summaries', 'subscriptions', 'ai_usage',
                           'notifications', 'processing_jobs', 'audit_logs', 'xp_events', 'streaks', 'post_private_authors']
  loop
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_all', t);
  end loop;
end $$;
