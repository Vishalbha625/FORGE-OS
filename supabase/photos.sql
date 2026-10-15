-- Forge OS: post photo variants (run after schema.sql and storage.sql).
-- Additive only: nothing in schema.sql or storage.sql is changed.
--
-- Each post with a photo stores two files in its own folder:
--   <author uuid>/<post uuid>/thumb.webp   (feed, about 25 KB)
--   <author uuid>/<post uuid>/full.webp    (full view, about 120 KB)
-- and posts.photo_path holds the folder, "<author uuid>/<post uuid>".

-- 1. Read the variants of a photo whose post you are allowed to see.
--    (storage.sql's read policy matches photo_path to a single file name.)
drop policy if exists post_photos_select_variants on storage.objects;
create policy post_photos_select_variants on storage.objects for select to authenticated
  using (
    bucket_id = 'post-photos'
    and exists (
      select 1 from public.posts p
      where p.photo_path = array_to_string(storage.foldername(storage.objects.name), '/')
        and (storage.foldername(storage.objects.name))[1] = p.author_id::text
        and public.can_view_post(p.author_id, p.visibility)
    )
  );

-- 2. A post's photo_path must point inside its author's own folder. Without
--    this, an author could set photo_path to someone else's private photo and
--    every viewer of the author's post could then read it.
alter table public.posts drop constraint if exists posts_photo_path_own_folder;
alter table public.posts add constraint posts_photo_path_own_folder
  check (photo_path is null or photo_path like author_id::text || '/%');

-- 3. The client is untrusted: cap file size and type at the bucket, so one
--    account cannot fill the 1 GB storage budget. Compressed photos are well
--    under this (thumb about 25 KB, full about 120 KB).
update storage.buckets
  set file_size_limit = 262144, allowed_mime_types = array['image/webp', 'image/jpeg']
  where id = 'post-photos';
