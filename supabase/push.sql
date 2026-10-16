-- Forge OS: Web Push subscriptions (run after unblock.sql). Additive only.
--
-- One row per browser that turned notifications on. The app writes its own
-- rows through the coach server with the user's own token, so these policies
-- apply; the server reads other people's rows (to deliver a push to them) with
-- the service role. A push never carries health data (R1): the server writes
-- the text itself, from a fixed list of messages.

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null check (char_length(endpoint) between 1 and 1000),
  p256dh      text not null check (char_length(p256dh) between 1 and 200),
  auth_key    text not null check (char_length(auth_key) between 1 and 100),
  device_tag  text not null default 'default' check (device_tag in ('default', 'phone', 'desktop')),
  -- Categories the person switched off on this device, e.g. '{social}'. The
  -- server skips them; the sender's device can't know the recipient's choice.
  muted       text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
