-- Re-review: bound storage_path length (the safe-name pattern alone allows arbitrarily long names).
alter table public.documents add constraint documents_storage_path_length
  check (char_length(storage_path) <= 512);

alter table public.resources add constraint resources_storage_path_length
  check (storage_path is null or char_length(storage_path) <= 512);
