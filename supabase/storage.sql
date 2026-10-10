-- Forge OS — post photo storage policies (run after schema.sql).
-- Bucket is private: photos are reachable only through these policies (or
-- short-lived signed URLs created by someone who passes them).
-- Object path convention: <author uuid>/<post uuid>/<file name>

insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', false)
on conflict (id) do update set public = false;

-- Upload/replace/delete only inside your own folder.
drop policy if exists post_photos_insert on storage.objects;
create policy post_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists post_photos_update on storage.objects;
create policy post_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists post_photos_delete on storage.objects;
create policy post_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Read: your own files, or a photo attached to a post you're allowed to see.
drop policy if exists post_photos_select on storage.objects;
create policy post_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'post-photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.posts p
        where p.photo_path = storage.objects.name and public.can_view_post(p.author_id, p.visibility)
      )
    )
  );
