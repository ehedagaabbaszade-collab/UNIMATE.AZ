-- NOTE: seed.sql runs only on local `supabase db reset`, NOT on hosted `supabase db push`.
-- Data needed in production belongs in a migration (see migrations/*_seed_universities.sql, which mirrors this list).
-- Seed: real Azerbaijani universities, names only. No users, no jobs/opportunities, no other data.
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
