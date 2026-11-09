-- Account purge: remove user-scoped rows that have no foreign key to profiles. Postgres 15 syntax only.
--
-- ai_spend and ai_budgets key their per-user rows by text (scope = 'user', key = '<uuid>'), so the ON DELETE CASCADE
-- chain from auth.users -> profiles never reaches them and the deleted user's id (and spend history) would stay behind.
-- This BEFORE DELETE trigger on profiles fires for every deletion path (GoTrue admin deleteUser cascade, the SQL purge).
-- Deliberately kept: audit_logs rows (actor_id becomes null via ON DELETE SET NULL; entity_id keeps the opaque id).
create function public.purge_user_scope_rows() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.ai_spend where scope = 'user' and key = old.id::text;
  delete from public.ai_budgets where scope = 'user' and key = old.id::text;
  return old;
end $$;
revoke all on function public.purge_user_scope_rows() from public, anon, authenticated;
create trigger profiles_purge_user_scope_rows before delete on public.profiles
  for each row execute function public.purge_user_scope_rows();
