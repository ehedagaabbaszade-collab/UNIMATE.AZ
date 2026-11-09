-- Injectable clock. Postgres 15 syntax only.
--
-- now_utc() is the single time source for plan expiry, XP days and SRS due checks. In production there is NO row in
-- app_private.clock_override, so now_utc() = now(). Tests insert a row as the migration owner to time travel.
-- It is a deny-all table in a schema the API roles cannot use (NOT a GUC: any signed-in user can SET a custom GUC, which
-- would let them revive an expired plan). Never insert a row on a real project.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated, service_role;

create table app_private.clock_override (
  singleton boolean primary key default true check (singleton),
  at timestamptz not null
);
alter table app_private.clock_override enable row level security;
revoke all on app_private.clock_override from public, anon, authenticated, service_role;

create function public.now_utc() returns timestamptz
language sql stable security definer set search_path = pg_temp as $$
  select coalesce((select c.at from app_private.clock_override c), now())
$$;
revoke all on function public.now_utc() from public;
grant execute on function public.now_utc() to anon, authenticated, service_role;
