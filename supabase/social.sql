-- Forge OS: profiles and follows for everyone in the community (run after
-- schema.sql, storage.sql and photos.sql). Additive only.
--
-- Follow rows are private to the two people involved (schema.sql), which is
-- right for pending requests. Profiles still need follower counts and lists,
-- so these SECURITY DEFINER functions expose ACCEPTED follows only, and hide
-- anyone blocked with the viewer. search_path is pinned.

-- 1. Avatars: <user uuid>/avatar.webp, readable by any signed-in user who is
--    not blocked with its owner. Matched on the exact file name, never on
--    profiles.avatar_path, so that column can't be pointed at another file.
drop policy if exists post_photos_select_avatars on storage.objects;
create policy post_photos_select_avatars on storage.objects for select to authenticated
  using (
    bucket_id = 'post-photos'
    and array_length(storage.foldername(storage.objects.name), 1) = 1
    and storage.objects.name = (storage.foldername(storage.objects.name))[1] || '/avatar.webp'
    and exists (
      select 1 from public.profiles p
      where p.id::text = (storage.foldername(storage.objects.name))[1]
        and not public.is_blocked_between(auth.uid(), p.id)
    )
  );

-- 2. Follower and following counts of a profile (accepted follows only).
create or replace function public.profile_follow_counts(p_user uuid)
returns table (followers bigint, following bigint)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.follows f
      where f.followee_id = p_user and f.status = 'accepted'
        and not public.is_blocked_between(auth.uid(), f.follower_id)),
    (select count(*) from public.follows f
      where f.follower_id = p_user and f.status = 'accepted'
        and not public.is_blocked_between(auth.uid(), f.followee_id))
  where auth.uid() is not null and not public.is_blocked_between(auth.uid(), p_user);
$$;

-- 3. Who follows a profile, or whom it follows (accepted only), newest first.
create or replace function public.profile_follows(p_user uuid, p_direction text)
returns table (id uuid, display_name text, bio text, goals text[], avatar_path text, created_at timestamptz, followed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.bio, p.goals, p.avatar_path, p.created_at, f.created_at
  from public.follows f
  join public.profiles p
    on p.id = case when p_direction = 'followers' then f.follower_id else f.followee_id end
  where auth.uid() is not null
    and p_direction in ('followers', 'following')
    and f.status = 'accepted'
    and (case when p_direction = 'followers' then f.followee_id else f.follower_id end) = p_user
    and not public.is_blocked_between(auth.uid(), p_user)
    and not public.is_blocked_between(auth.uid(), p.id)
  order by f.created_at desc
  limit 500;
$$;

revoke all on function public.profile_follow_counts(uuid) from public, anon;
revoke all on function public.profile_follows(uuid, text) from public, anon;
grant execute on function public.profile_follow_counts(uuid) to authenticated;
grant execute on function public.profile_follows(uuid, text) to authenticated;
