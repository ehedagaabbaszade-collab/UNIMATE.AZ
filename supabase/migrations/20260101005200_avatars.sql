-- Profile pictures. Public-read 'avatars' bucket (the app shows them via the public https URL stored in
-- profiles.avatar_url, which already requires https). Writes are owner-only, under a folder named after the uid:
--   avatars/<auth.uid()>/<file>
-- Listing through the API is owner-only too, so nobody can enumerate other users' files; public GET of a known
-- object URL is served by Storage without RLS (that is what public = true means).
-- Small images only: 2 MB, jpeg/png/webp (the app crops to a square and compresses before upload).
-- (RLS on storage.objects is enabled by Supabase; we must not ALTER that table.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_bucket_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_bucket_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_bucket_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_bucket_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
