-- ─────────────────────────────────────────────────────────────────────────────
-- Forge OS — community backend schema for Supabase (Postgres)
--
-- Scope: the multi-user social layer only (profiles, follows, blocks, posts,
-- comments, kudos, reports, post photos). Health data — sleep, nutrition, body
-- metrics, recovery, steps, training logs — is deliberately NOT stored here.
-- It stays on the athlete's device. A post only carries what the athlete chose
-- to share in it.
--
-- Privacy model (enforced by row-level security, not by the client):
--   private   → only the author
--   followers → the author + accepted followers
--   public    → any signed-in user
--   Blocking (either direction) hides posts, comments and kudos between users.
--
-- Apply: Supabase dashboard → SQL editor → run this file, then storage.sql.
-- Tested by supabase/tests/rls_test.sql (see README).
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

do $$ begin
  create type public.post_visibility as enum ('private', 'followers', 'public');
exception when duplicate_object then null; end $$;

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 60),
  bio           text check (char_length(bio) <= 300),
  goals         text[] not null default '{}',
  avatar_path   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A follow starts as a request; it only grants access to followers-only posts
-- once the followee accepts it.
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  followee_id  uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table if not exists public.blocks (
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.posts (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid not null references public.profiles (id) on delete cascade,
  event_date       date not null,
  title            text not null check (char_length(title) between 1 and 120),
  activity_type    text not null check (char_length(activity_type) <= 40),
  caption          text check (char_length(caption) <= 2000),
  distance_km      numeric(6, 2) check (distance_km is null or distance_km between 0 and 1000),
  duration_sec     integer check (duration_sec is null or duration_sec between 0 and 172800),
  pace_sec_per_km  integer check (pace_sec_per_km is null or pace_sec_per_km > 0),
  elevation_m      integer,
  station_detail   text check (char_length(station_detail) <= 2000),
  route_text       text check (char_length(route_text) <= 200),
  photo_path       text,
  is_pr            boolean not null default false,
  visibility       public.post_visibility not null default 'private',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists posts_author_idx on public.posts (author_id, event_date desc);
create index if not exists posts_public_idx on public.posts (event_date desc) where visibility = 'public';

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

create table if not exists public.kudos (
  post_id     uuid not null references public.posts (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles (id) on delete cascade,
  post_id      uuid references public.posts (id) on delete set null,
  comment_id   uuid references public.comments (id) on delete set null,
  user_id      uuid references public.profiles (id) on delete set null,
  reason       text not null check (char_length(reason) between 1 and 500),
  created_at   timestamptz not null default now(),
  check (post_id is not null or comment_id is not null or user_id is not null)
);

-- ── Helper functions ──────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies can consult follows/blocks without the caller
-- needing direct read access to other users' rows. search_path is pinned.

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create or replace function public.can_view_post(p_author uuid, p_visibility public.post_visibility)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then false
    when p_author = auth.uid() then true
    when public.is_blocked_between(auth.uid(), p_author) then false
    when p_visibility = 'public' then true
    when p_visibility = 'followers' then exists (
      select 1 from public.follows f
      where f.follower_id = auth.uid() and f.followee_id = p_author and f.status = 'accepted'
    )
    else false
  end;
$$;

create or replace function public.can_view_post_id(p_post uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.can_view_post(author_id, visibility) from public.posts where id = p_post), false);
$$;

-- Keep updated_at honest and stop clients from rewriting ownership/created_at.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.created_at := old.created_at;
  if tg_table_name = 'posts' then new.author_id := old.author_id; end if;
  return new;
end $$;

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.follows  enable row level security;
alter table public.blocks   enable row level security;
alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.kudos    enable row level security;
alter table public.reports  enable row level security;

-- profiles: signed-in users can see basic profiles (needed for search/follow);
-- you can only create/edit your own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (not public.is_blocked_between(auth.uid(), id));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- follows: visible to the two people involved; you manage your own follows.
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and status = 'pending' and not public.is_blocked_between(follower_id, followee_id));
-- only the followee can accept (column grant below limits updates to `status`)
drop policy if exists follows_update on public.follows;
create policy follows_update on public.follows for update to authenticated
  using (followee_id = auth.uid()) with check (followee_id = auth.uid());
drop policy if exists follows_delete on public.follows;
-- the follower can unfollow; the followee can remove a follower
create policy follows_delete on public.follows for delete to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- blocks: private to the blocker.
drop policy if exists blocks_all on public.blocks;
create policy blocks_all on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- posts: visibility rules above; only the author writes.
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated
  using (public.can_view_post(author_id, visibility));
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- comments: readable/writable only if you can see the post (and aren't blocked
-- by the commenter); deletable by the commenter or the post author.
drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated
  using (public.can_view_post_id(post_id) and not public.is_blocked_between(auth.uid(), author_id));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_view_post_id(post_id));
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- kudos: same visibility as the post; one per user per post (primary key).
drop policy if exists kudos_select on public.kudos;
create policy kudos_select on public.kudos for select to authenticated
  using (public.can_view_post_id(post_id));
drop policy if exists kudos_insert on public.kudos;
create policy kudos_insert on public.kudos for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_post_id(post_id));
drop policy if exists kudos_delete on public.kudos;
create policy kudos_delete on public.kudos for delete to authenticated
  using (user_id = auth.uid());

-- reports: write-only for users (moderators read them with the service role).
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- Anonymous visitors get nothing.
revoke all on public.profiles, public.follows, public.blocks, public.posts,
  public.comments, public.kudos, public.reports from anon;
grant select, insert, update, delete on public.profiles, public.blocks, public.posts to authenticated;
grant select, insert, delete on public.follows, public.comments, public.kudos to authenticated;
grant update (status) on public.follows to authenticated;
grant insert on public.reports to authenticated;
