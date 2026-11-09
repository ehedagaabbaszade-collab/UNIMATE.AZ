-- Entries supplied by the product owner on 2026-11-10 that are NOT in the edu.gov.az lists used by 20260101003000.
-- Marked source='user_supplied_unverified': an admin should verify each against the official register and fix/remove as needed.
-- Skipped as duplicates of institutions already present under their official names: UNEC/ADPU etc. (same names), "Bakı Dövlət İqtisadiyyat və Humanitar Kolleci",
-- "Bakı Qida Sənayesi Kolleci", "Asəf Zeynallı adına Musiqi Kolleci", "Gəncə Dövlət Regional Kolleci", "Azərbaycan Dövlət Bədən Tərbiyəsi və İdman Akademiyası".
insert into public.universities (name, institution_type, ownership, source) values
  ('İtaliya-Azərbaycan Universiteti', 'university', 'state', 'user_supplied_unverified'),
  ('Milli Müdafiə Universiteti', 'university', 'state', 'user_supplied_unverified'),
  ('Heydər Əliyev adına Hərbi İnstitut', 'university', 'state', 'user_supplied_unverified'),
  ('Azərbaycan Respublikası Dövlət Təhlükəsizliyi Xidmətinin Heydər Əliyev adına Akademiyası', 'university', 'state', 'user_supplied_unverified'),
  ('Azərbaycan Respublikası Daxili İşlər Nazirliyinin Polis Akademiyası', 'university', 'state', 'user_supplied_unverified'),
  ('Azərbaycan Respublikası Dövlət Sərhəd Xidməti Akademiyası', 'university', 'state', 'user_supplied_unverified'),
  ('Azərbaycan Respublikası Fövqəladə Hallar Nazirliyinin Akademiyası', 'university', 'state', 'user_supplied_unverified'),
  ('Azərbaycan Respublikası Dövlət Gömrük Komitəsinin Akademiyası', 'university', 'state', 'user_supplied_unverified'),
  ('Bakı Qızlar Universiteti', 'university', 'private', 'user_supplied_unverified'),
  ('Naxçıvan Universiteti', 'university', 'private', 'user_supplied_unverified'),
  ('Bakı İdarəetmə və Texnologiya Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Bakı Kompüter Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('1 nömrəli Bakı Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('2 nömrəli Bakı Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Sumqayıt Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Gəncə Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Gəncə Musiqi Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Mingəçevir Turizm Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Mingəçevir Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Lənkəran Dövlət Humanitar Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Lənkəran Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Şirvan Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Şəki Tibb Kolleci', 'college', 'state', 'user_supplied_unverified'),
  ('Cəlilabad Dövlət Regional Kolleci', 'college', 'state', 'user_supplied_unverified')
on conflict (name) do nothing;
