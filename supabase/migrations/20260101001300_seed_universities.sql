-- Reference data that production needs. supabase/seed.sql does NOT run on a hosted `supabase db push`
-- (only on local `db reset`), so anything required in prod must live in a migration. Mirrors seed.sql: names only.
insert into public.universities (name) values
  ('Bakı Dövlət Universiteti'),
  ('ADA Universiteti'),
  ('Azərbaycan Tibb Universiteti'),
  ('Azərbaycan Dövlət İqtisad Universiteti'),
  ('Bakı Ali Neft Məktəbi'),
  ('Azərbaycan Dillər Universiteti'),
  ('Azərbaycan Texniki Universiteti'),
  ('Azərbaycan Dövlət Neft və Sənaye Universiteti'),
  ('Xəzər Universiteti'),
  ('Azərbaycan Dövlət Pedaqoji Universiteti'),
  ('Azərbaycan Memarlıq və İnşaat Universiteti')
on conflict (name) do nothing;
