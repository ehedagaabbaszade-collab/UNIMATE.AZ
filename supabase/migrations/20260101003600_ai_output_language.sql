-- AI output language, separate from the document's source language. Postgres 15 syntax only.
--
-- output_language: the language the AI writes in (az, tr, en, ru). Defaults to the owner's profiles.locale (then az).
-- source_language: the language of the source document; nullable (unknown / mixed). The two are independent.
-- The generation cache key (params_hash, built in packages/pipeline generate.ts) includes both.

create function public.default_output_language() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.output_language is null then
    new.output_language := coalesce((select p.locale from public.profiles p where p.id = new.user_id), 'az');
  end if;
  return new;
end $$;
revoke all on function public.default_output_language() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['conversations', 'summaries', 'quizzes', 'flashcards'] loop
    execute format('alter table public.%I add column output_language text', t);
    execute format('alter table public.%I add column source_language text', t);
    execute format('update public.%I x set output_language = coalesce((select p.locale from public.profiles p where p.id = x.user_id), ''az'')', t);
    execute format('alter table public.%I alter column output_language set not null', t);
    execute format('alter table public.%I add constraint %I check (output_language in (''az'', ''tr'', ''en'', ''ru''))', t, t || '_output_language_check');
    execute format('alter table public.%I add constraint %I check (source_language is null or source_language in (''az'', ''tr'', ''en'', ''ru''))', t, t || '_source_language_check');
    execute format('create trigger %I before insert on public.%I for each row execute function public.default_output_language()', t || '_default_output_language', t);
  end loop;
end $$;
