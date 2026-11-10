-- Feeds the sign-up / onboarding "university -> faculty -> major" picker with the DİM 2026/2027 college catalog (20260101005000).
-- * Colleges missing from the directory are added as institution_type 'college', source 'dim.gov.az' (name exactly as printed by DİM).
--   Ownership is not stated in the PDF: it is 'private' only for the four colleges named after private universities already in the directory.
-- * Each college gets ONE faculty ("Orta ixtisas təhsili") and its distinct DİM specialty names become majors with degree_level 'vocational'
--   (secondary specialized education; not bachelor programs).
-- Idempotent: every insert is guarded, so re-running adds nothing.

alter table public.universities drop constraint if exists universities_source_check;
alter table public.universities add constraint universities_source_check check (source in ('edu.gov.az', 'wikipedia', 'user_supplied_unverified', 'admin_verified', 'dim.gov.az'));

alter table public.majors drop constraint if exists majors_degree_level_check;
alter table public.majors add constraint majors_degree_level_check check (degree_level in ('bachelor', 'master', 'phd', 'vocational'));

insert into public.universities (name, institution_type, ownership, source, affiliated_with)
select c.college_name,
       'college',
       case when c.college_name ~ '^(Odlar Yurdu|Qərbi Kaspi|Bakı Avrasiya|Bakı Biznes)' then 'private' else 'state' end,
       'dim.gov.az',
       case when c.parent_institution is null then null
            when c.parent_institution ~ '(Universitetinin|Akademiyasının)$' then regexp_replace(c.parent_institution, '(nin|nın)$', '')
            else c.parent_institution end
from public.admission_colleges c
where c.university_id is null
  and not exists (select 1 from public.universities u where u.name = c.college_name)
on conflict (name) do nothing;

update public.admission_colleges c
set university_id = u.id
from public.universities u
where c.university_id is null and u.name = c.college_name and u.institution_type = 'college';

insert into public.faculties (university_id, name)
select distinct c.university_id, 'Orta ixtisas təhsili'
from public.admission_colleges c
where c.university_id is not null
on conflict (university_id, name) do nothing;

insert into public.majors (faculty_id, name, degree_level)
-- Two music specialties print a 270-character instrument list in brackets; majors.name is limited to 200, so those use the part before the bracket
-- (the full official text stays in college_programs.specialty).
select distinct f.id, case when length(p.specialty) > 200 then btrim(regexp_replace(p.specialty, '\s*\(.*$', '')) else p.specialty end, 'vocational'
from public.college_programs p
join public.admission_colleges c on c.id = p.college_id
join public.faculties f on f.university_id = c.university_id and f.name = 'Orta ixtisas təhsili'
on conflict (faculty_id, name, degree_level) do nothing;
