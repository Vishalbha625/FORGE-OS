-- Forge OS: in-app notifications (run after push.sql). Additive only.
--
-- The app writes a notification right after the action it is about (there are
-- no Edge Functions or database webhooks, R8). Row-level security makes that
-- safe: you can only notify someone about something you really did to them,
-- never across a block, and the same event at most once per 5 minutes (so
-- toggling kudos can't spam). Only the recipient can read, mark read or
-- delete their notifications.
--
-- Housekeeping: the app shows the last 90 days. Once a quarter, run
--   delete from public.notifications where created_at < now() - interval '90 days';

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null check (type in ('kudos_received', 'comment_received', 'follow_request', 'follow_accepted')),
  actor_id    uuid not null references public.profiles (id) on delete cascade,
  post_id     uuid references public.posts (id) on delete cascade,
  comment_id  uuid references public.comments (id) on delete set null,
  read        boolean not null default false,
  created_at  timestamptz not null default now(),
  check (actor_id <> user_id)
);

create index if not exists idx_notifications_user_unread on public.notifications (user_id, created_at desc) where read = false;
create index if not exists idx_notifications_user_created on public.notifications (user_id, created_at desc);
create index if not exists idx_notifications_dedup on public.notifications (actor_id, user_id, type, created_at desc);

-- Is the caller allowed to send this notification? SECURITY DEFINER so it can
-- check kudos, comments, follows and recent notifications the caller can't read
-- directly. It only answers about the caller's own actions (p_actor must be the
-- caller), so it can't be used to probe what other people did.
create or replace function public.notification_allowed(p_type text, p_actor uuid, p_user uuid, p_post uuid, p_comment uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    auth.uid() is not null
    and p_actor = auth.uid()
    and p_user is not null and p_user <> p_actor
    and not public.is_blocked_between(p_actor, p_user)
    and case p_type
      when 'kudos_received' then p_comment is null and exists (
        select 1 from public.kudos k join public.posts p on p.id = k.post_id
        where k.post_id = p_post and k.user_id = p_actor and p.author_id = p_user)
      when 'comment_received' then exists (
        select 1 from public.comments c join public.posts p on p.id = c.post_id
        where c.id = p_comment and c.post_id = p_post and c.author_id = p_actor and p.author_id = p_user)
      when 'follow_request' then p_post is null and p_comment is null and exists (
        select 1 from public.follows f where f.follower_id = p_actor and f.followee_id = p_user and f.status = 'pending')
      when 'follow_accepted' then p_post is null and p_comment is null and exists (
        select 1 from public.follows f where f.follower_id = p_user and f.followee_id = p_actor and f.status = 'accepted')
      else false
    end
    and not exists (
      select 1 from public.notifications n
      where n.actor_id = p_actor and n.user_id = p_user and n.type = p_type
        and n.post_id is not distinct from p_post
        and n.created_at > now() - interval '5 minutes');
$$;

alter table public.notifications enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications for insert to authenticated
  with check (actor_id = auth.uid() and user_id <> auth.uid() and public.notification_allowed(type, actor_id, user_id, post_id, comment_id));

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
-- New notifications start unread: `read` and `created_at` take their defaults.
grant insert (id, user_id, type, actor_id, post_id, comment_id) on public.notifications to authenticated;
-- The recipient can only flip `read`.
grant update (read) on public.notifications to authenticated;

revoke all on function public.notification_allowed(text, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.notification_allowed(text, uuid, uuid, uuid, uuid) to authenticated;
