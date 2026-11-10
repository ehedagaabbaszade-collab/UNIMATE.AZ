-- UNIMATE CAREER, part 1: two new AI routing tasks. Postgres 15 syntax only.
-- ALTER TYPE ... ADD VALUE: the new values cannot be USED in the same transaction, so this is its own migration.
-- No route rows are inserted: until an admin calls admin_set_ai_route for these tasks they fail with ai_not_configured.
alter type public.ai_task add value if not exists 'cv_feedback';
alter type public.ai_task add value if not exists 'interview_prep';
