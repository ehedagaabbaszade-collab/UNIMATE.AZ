-- Locale / i18n backend. Postgres 15 syntax only.
--
-- Languages: az (default), tr, en, ru (user decision: Russian stays). profiles.locale already has
-- check (locale in ('az','en','ru','tr')) and default 'az' (20260101001600); nothing to change there.
--
-- !!! NATIVE-SPEAKER REVIEW REQUIRED !!!
-- The seeded notification copy below is hand-written by a non-native author for az, tr, en and ru. It is natural and
-- grammatical to the best of the author's ability but has NOT been certified by native speakers. Review before launch;
-- admins can fix any text without a deploy through admin_set_notification_template (audited).
--
-- Rendering: notifications keep (template_key, params); the title/body are rendered per RECIPIENT locale
-- (profiles.locale) with fallback to az, then to the legacy stored title/body.

-- ---------------------------------------------------------------- notification_templates
create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z0-9_.]{1,80}$'),
  locale text not null check (locale in ('az', 'tr', 'en', 'ru')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text check (body is null or length(body) <= 2000),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (key, locale)
);
alter table public.notification_templates enable row level security;
revoke all on public.notification_templates from anon;
revoke insert, update, delete, truncate, references, trigger on public.notification_templates from authenticated;
create policy notification_templates_read on public.notification_templates for select to authenticated using (true);
create policy notification_templates_service_all on public.notification_templates for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------- system_content (public, versioned)
create table public.system_content (
  key text not null check (key ~ '^[a-z0-9_.-]{1,100}$'),
  locale text not null check (locale in ('az', 'tr', 'en', 'ru')),
  body jsonb not null,
  version integer not null default 1 check (version >= 1),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (key, locale)
);
alter table public.system_content enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.system_content from anon, authenticated;
grant select on public.system_content to anon, authenticated;
create policy system_content_public_read on public.system_content for select to anon, authenticated using (true);
create policy system_content_service_all on public.system_content for all to service_role using (true) with check (true);

-- Append-only history, used for revert. Own table on purpose: config_versions snapshots the AI config and
-- admin_revert_config rebuilds routes/budgets from a snapshot, so content must never be written there.
create table public.system_content_versions (
  id bigint generated always as identity primary key,
  key text not null,
  locale text not null,
  version integer not null,
  body jsonb not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (key, locale, version)
);
alter table public.system_content_versions enable row level security;
revoke all on public.system_content_versions from anon;
revoke insert, update, delete, truncate, references, trigger on public.system_content_versions from authenticated;
create policy system_content_versions_admin_select on public.system_content_versions for select to authenticated using (public.is_admin());
create policy system_content_versions_service_all on public.system_content_versions for all to service_role using (true) with check (true);

create function public.admin_set_system_content(p_key text, p_locale text, p_body jsonb, p_reason text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_old integer;
  v_new integer;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_.-]{1,100}$' or p_locale is null or p_locale not in ('az', 'tr', 'en', 'ru')
     or p_body is null or pg_column_size(p_body) > 200000
     or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'valid key, locale, body (<= 200 KB) and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('content:' || p_key || ':' || p_locale, 0));
  select version into v_old from public.system_content where key = p_key and locale = p_locale;
  v_new := coalesce(v_old, 0) + 1;
  insert into public.system_content (key, locale, body, version, updated_by) values (p_key, p_locale, p_body, v_new, v_actor)
  on conflict (key, locale) do update set body = excluded.body, version = excluded.version,
    updated_by = excluded.updated_by, updated_at = now();
  insert into public.system_content_versions (key, locale, version, body, actor_id, reason)
  values (p_key, p_locale, v_new, p_body, v_actor, btrim(p_reason));
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'content.set', 'system_content', p_key || ':' || p_locale,
          jsonb_build_object('from_version', v_old, 'to_version', v_new, 'reason', btrim(p_reason)));
  return v_new;
end $$;

-- Reverting writes the old body as a NEW version (history stays linear and audited).
create function public.admin_revert_system_content(p_key text, p_locale text, p_version integer, p_reason text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_body jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  select body into v_body from public.system_content_versions where key = p_key and locale = p_locale and version = p_version;
  if not found then
    raise exception 'content version not found' using errcode = 'P0002';
  end if;
  return public.admin_set_system_content(p_key, p_locale, v_body, 'revert to v' || p_version || ': ' || coalesce(p_reason, ''));
end $$;

create function public.admin_set_notification_template(p_key text, p_locale text, p_title text, p_body text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin privileges required' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_.]{1,80}$' or p_locale is null or p_locale not in ('az', 'tr', 'en', 'ru')
     or p_title is null or length(btrim(p_title)) not between 1 and 200 or length(coalesce(p_body, '')) > 2000
     or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'valid key, locale, title, body and a reason (3-500 chars) are required' using errcode = '22023';
  end if;
  insert into public.notification_templates (key, locale, title, body, updated_by) values (p_key, p_locale, btrim(p_title), p_body, v_actor)
  on conflict (key, locale) do update set title = excluded.title, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'notification_template.set', 'notification_template', p_key || ':' || p_locale,
          jsonb_build_object('reason', btrim(p_reason)));
  return v_id;
end $$;

revoke all on function public.admin_set_system_content(text, text, jsonb, text), public.admin_revert_system_content(text, text, integer, text),
  public.admin_set_notification_template(text, text, text, text, text) from public, anon;
grant execute on function public.admin_set_system_content(text, text, jsonb, text), public.admin_revert_system_content(text, text, integer, text),
  public.admin_set_notification_template(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- notifications: template key + params
alter table public.notifications alter column title drop not null;
alter table public.notifications add column template_key text check (template_key is null or template_key ~ '^[a-z0-9_.]{1,80}$');
alter table public.notifications add column params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object');
alter table public.notifications add constraint notifications_has_text check (title is not null or template_key is not null);

create function public.render_template_text(p_text text, p_params jsonb) returns text
language plpgsql immutable set search_path = pg_temp as $$
declare
  r record;
  v text := p_text;
begin
  if v is null then
    return null;
  end if;
  for r in select key, value from jsonb_each_text(coalesce(p_params, '{}'::jsonb)) loop
    v := replace(v, '{' || r.key || '}', coalesce(r.value, ''));
  end loop;
  return v;
end $$;

-- Renders in p_locale, falling back to az, then to the stored legacy title/body, then to the key itself.
create function public.render_notification_fields(p_key text, p_params jsonb, p_locale text, p_title text, p_body text)
returns table (title text, body text, locale text)
language plpgsql stable set search_path = public, pg_temp as $$
declare
  t record;
begin
  if p_key is not null then
    select x.title, x.body, x.locale into t from public.notification_templates x
      where x.key = p_key and x.locale in (coalesce(p_locale, 'az'), 'az')
      order by (x.locale = coalesce(p_locale, 'az')) desc limit 1;
    if found then
      return query select public.render_template_text(t.title, p_params), public.render_template_text(t.body, p_params), t.locale;
      return;
    end if;
  end if;
  return query select coalesce(p_title, p_key), p_body, 'az'::text;
end $$;

-- security_invoker: RLS applies, so a user only ever renders their own notifications.
create view public.notifications_rendered with (security_invoker = true) as
select n.id, n.user_id, n.kind, n.template_key, n.params, n.read_at, n.created_at, r.title, r.body, r.locale
from public.notifications n
cross join lateral public.render_notification_fields(
  n.template_key, n.params, coalesce((select p.locale from public.profiles p where p.id = n.user_id), 'az'), n.title, n.body) r;
revoke all on public.notifications_rendered from anon;
revoke insert, update, delete, truncate, references, trigger on public.notifications_rendered from authenticated;
grant select on public.notifications_rendered to authenticated, service_role;

create function public.render_notification(p_notification_id uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'body', r.body, 'locale', r.locale)
  from public.notifications_rendered r where r.id = p_notification_id
$$;
revoke all on function public.render_notification(uuid), public.render_notification_fields(text, jsonb, text, text, text),
  public.render_template_text(text, jsonb) from public, anon;
grant execute on function public.render_notification(uuid), public.render_notification_fields(text, jsonb, text, text, text),
  public.render_template_text(text, jsonb) to authenticated, service_role;

-- Internal producer (definer-to-definer calls and service_role only). Requires an az template: it is the fallback.
create function public.notify_user(p_user_id uuid, p_key text, p_params jsonb default '{}'::jsonb, p_kind text default 'system')
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.notification_templates where key = p_key and locale = 'az') then
    raise exception 'unknown notification template %', p_key using errcode = '22023';
  end if;
  insert into public.notifications (user_id, kind, template_key, params)
  values (p_user_id, p_kind, p_key, coalesce(p_params, '{}'::jsonb)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.notify_user(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.notify_user(uuid, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------- seeds (events that exist; see header: needs native review)
-- Placeholders: {name} {title} {date} {plan}. Producers wired in SQL today: deletion_requested, deletion_cancelled,
-- plan_expired. document_ready, report_resolved, welcome and plan_expiring have templates only; their producers
-- (pipeline worker, admin_resolve_report, signup, expiry reminder) are NOT wired yet.
insert into public.notification_templates (key, locale, title, body) values
  ('welcome', 'az', 'UniMate-ə xoş gəldiniz', 'Salam, {name}! Sənədlərinizi yükləyin, xülasə və testlər hazırlayın, dərs planınızı bir yerdə qurun.'),
  ('welcome', 'tr', 'UniMate''e hoş geldiniz', 'Merhaba {name}! Belgelerinizi yükleyin, özet ve testler hazırlayın, ders planınızı tek yerde oluşturun.'),
  ('welcome', 'en', 'Welcome to UniMate', 'Hi {name}! Upload your documents, create summaries and quizzes, and keep your study plan in one place.'),
  ('welcome', 'ru', 'Добро пожаловать в UniMate', 'Привет, {name}! Загружайте документы, создавайте конспекты и тесты и ведите учебный план в одном месте.'),

  ('document_ready', 'az', 'Sənədiniz hazırdır', '“{title}” emal olundu. İndi xülasə, test və flash kartlar yarada bilərsiniz.'),
  ('document_ready', 'tr', 'Belgeniz hazır', '“{title}” işlendi. Artık özet, test ve bilgi kartları oluşturabilirsiniz.'),
  ('document_ready', 'en', 'Your document is ready', '“{title}” has been processed. You can now create summaries, quizzes and flashcards.'),
  ('document_ready', 'ru', 'Документ готов', 'Файл «{title}» обработан. Теперь можно создавать конспекты, тесты и карточки.'),

  ('deletion_requested', 'az', 'Hesabın silinməsi sorğusu qəbul edildi', 'Hesabınız {date} tarixində silinəcək. Bu tarixə qədər fikrinizi dəyişsəniz, silinməni ləğv edə bilərsiniz.'),
  ('deletion_requested', 'tr', 'Hesap silme talebiniz alındı', 'Hesabınız {date} tarihinde silinecek. Bu tarihe kadar fikrinizi değiştirirseniz silme işlemini iptal edebilirsiniz.'),
  ('deletion_requested', 'en', 'Account deletion requested', 'Your account will be deleted on {date}. If you change your mind before then, you can cancel the deletion.'),
  ('deletion_requested', 'ru', 'Запрос на удаление аккаунта принят', 'Ваш аккаунт будет удалён {date}. Если вы передумаете до этой даты, удаление можно отменить.'),

  ('deletion_cancelled', 'az', 'Hesabın silinməsi ləğv edildi', 'Hesabınız saxlanıldı və məlumatlarınız silinməyəcək.'),
  ('deletion_cancelled', 'tr', 'Hesap silme işlemi iptal edildi', 'Hesabınız korundu ve verileriniz silinmeyecek.'),
  ('deletion_cancelled', 'en', 'Account deletion cancelled', 'Your account has been kept and your data will not be deleted.'),
  ('deletion_cancelled', 'ru', 'Удаление аккаунта отменено', 'Ваш аккаунт сохранён, данные удалены не будут.'),

  ('plan_expiring', 'az', 'Planınızın müddəti bitir', '{plan} planınız {date} tarixində başa çatır. Bundan sonra hesabınız pulsuz plana keçəcək.'),
  ('plan_expiring', 'tr', 'Planınızın süresi dolmak üzere', '{plan} planınız {date} tarihinde sona eriyor. Bundan sonra hesabınız ücretsiz plana geçecek.'),
  ('plan_expiring', 'en', 'Your plan is about to expire', 'Your {plan} plan ends on {date}. After that your account will move to the free plan.'),
  ('plan_expiring', 'ru', 'Срок действия тарифа заканчивается', 'Тариф {plan} действует до {date}. После этого аккаунт перейдёт на бесплатный тариф.'),

  ('plan_expired', 'az', 'Planınızın müddəti bitdi', '{plan} planınızın müddəti başa çatdı və hesabınız pulsuz plana keçirildi.'),
  ('plan_expired', 'tr', 'Planınızın süresi doldu', '{plan} planınızın süresi doldu ve hesabınız ücretsiz plana geçirildi.'),
  ('plan_expired', 'en', 'Your plan has expired', 'Your {plan} plan has ended and your account is now on the free plan.'),
  ('plan_expired', 'ru', 'Срок действия тарифа истёк', 'Тариф {plan} закончился, и аккаунт переведён на бесплатный тариф.'),

  ('report_resolved', 'az', 'Şikayətinizə baxıldı', 'Göndərdiyiniz şikayətə moderatorlar baxdı. Bildirişiniz üçün təşəkkür edirik.'),
  ('report_resolved', 'tr', 'Şikâyetiniz incelendi', 'Gönderdiğiniz şikâyet moderatörler tarafından incelendi. Bildiriminiz için teşekkür ederiz.'),
  ('report_resolved', 'en', 'Your report was reviewed', 'The moderators have reviewed the report you sent. Thank you for letting us know.'),
  ('report_resolved', 'ru', 'Ваша жалоба рассмотрена', 'Модераторы рассмотрели вашу жалобу. Спасибо, что сообщили нам.')
on conflict (key, locale) do nothing;

-- ---------------------------------------------------------------- account deletion notifications
create or replace function public.request_account_deletion() returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_when timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('acct-del:' || v_uid::text, 0));
  select scheduled_for into v_when from public.account_deletion_requests where user_id = v_uid and status = 'pending';
  if found then
    return v_when;
  end if;
  insert into public.account_deletion_requests (user_id) values (v_uid) returning scheduled_for into v_when;
  perform public.notify_user(v_uid, 'deletion_requested',
    jsonb_build_object('date', to_char(v_when at time zone 'Asia/Baku', 'YYYY-MM-DD')), 'account');
  return v_when;
end $$;

create or replace function public.cancel_account_deletion() returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.account_deletion_requests set status = 'cancelled', cancelled_at = now()
    where user_id = v_uid and status = 'pending';
  if found then
    perform public.notify_user(v_uid, 'deletion_cancelled', '{}'::jsonb, 'account');
    return true;
  end if;
  return false;
end $$;
