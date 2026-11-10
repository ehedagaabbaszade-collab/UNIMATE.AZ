-- profiles.locale_set_at: when the user (or an admin on their behalf) explicitly chose a language.
-- NULL = "never chosen": profiles.locale is then only the column default (az), so clients may push their local/device
-- choice into it at first authenticated load (see reconcileLocale in packages/i18n). Postgres 15 syntax only.
--
-- Backfill: rows whose locale is not the default 'az' must have been chosen explicitly, so they get a timestamp.
-- Rows still on 'az' stay NULL (we cannot tell "chose az" from "never chose"); for them the first authenticated
-- load may replace az with the device/local language, once, after which the timestamp is set.
alter table public.profiles add column locale_set_at timestamptz;
update public.profiles set locale_set_at = coalesce(updated_at, now()) where locale <> 'az' and locale_set_at is null;

-- Stamped by the database, not trusted from the client. "update of locale" fires whenever locale appears in the
-- SET list, even with an unchanged value, so explicitly re-choosing az also counts as a choice.
create function public.stamp_profile_locale_set_at() returns trigger
language plpgsql set search_path = pg_temp as $$
begin
  new.locale_set_at := now();
  return new;
end $$;
create trigger profiles_stamp_locale_set_at before update of locale on public.profiles
  for each row execute function public.stamp_profile_locale_set_at();
