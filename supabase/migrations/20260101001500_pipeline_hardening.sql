-- Pipeline hardening (security review B3): storage paths are exactly "<owner uuid>/<flat file name>".
-- Allowed file-name characters: letters, digits, dot, underscore, space, hyphen. No further '/' (no sub-folders),
-- no '..' anywhere. The edge functions assert the same pattern before every storage call (defence in depth).
alter table public.documents add constraint documents_storage_path_safe
  check (storage_path ~ ('^' || user_id::text || '/[A-Za-z0-9._ -]+$') and storage_path !~ '\.\.');

alter table public.resources add constraint resources_storage_path_safe
  check (storage_path is null
         or (storage_path ~ ('^' || uploader_id::text || '/[A-Za-z0-9._ -]+$') and storage_path !~ '\.\.'));
