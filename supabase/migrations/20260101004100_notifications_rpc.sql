-- Notification reads for clients: rendered in the caller's profile locale (notifications_rendered, security_invoker so
-- RLS still limits rows to the owner; the explicit user_id filter is defence in depth). Marking read only ever touches
-- the caller's own unread rows. Postgres 15 syntax.

create function public.list_my_notifications(p_limit integer default 30, p_before timestamptz default null)
returns table (id uuid, kind text, title text, body text, params jsonb, read_at timestamptz, created_at timestamptz)
language sql stable security invoker set search_path = public, pg_temp as $$
  select r.id, r.kind, r.title, r.body, r.params, r.read_at, r.created_at
  from public.notifications_rendered r
  where r.user_id = auth.uid() and (p_before is null or r.created_at < p_before)
  order by r.created_at desc, r.id
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

create function public.unread_notification_count() returns integer
language sql stable security invoker set search_path = public, pg_temp as $$
  select count(*)::integer from public.notifications n where n.user_id = auth.uid() and n.read_at is null
$$;

-- p_ids null = mark everything read. Returns the number of rows changed (idempotent: already-read rows are untouched).
create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_ids is not null and cardinality(p_ids) > 200 then
    raise exception 'too many ids' using errcode = '54000';
  end if;
  update public.notifications set read_at = public.now_utc()
    where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.list_my_notifications(integer, timestamptz), public.unread_notification_count(),
  public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.list_my_notifications(integer, timestamptz), public.unread_notification_count(),
  public.mark_notifications_read(uuid[]) to authenticated;
