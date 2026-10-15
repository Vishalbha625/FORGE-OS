-- Forge OS: list the people you blocked, so you can unblock them (run after
-- social.sql). Additive only.
--
-- profiles_select hides anyone blocked in either direction, so the blocker
-- can't read their names through the normal API. This SECURITY DEFINER
-- function returns them, but only to the blocker themself.

create or replace function public.get_blocked_users(blocker uuid)
returns table (id uuid, display_name text, avatar_path text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_path, b.created_at
  from public.blocks b
  join public.profiles p on p.id = b.blocked_id
  where auth.uid() is not null
    and b.blocker_id = blocker
    and blocker = auth.uid()
  order by b.created_at desc;
$$;

revoke all on function public.get_blocked_users(uuid) from public, anon;
grant execute on function public.get_blocked_users(uuid) to authenticated;
