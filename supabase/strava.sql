-- Forge OS: Strava connections (run after notifications.sql). Additive only.
--
-- Strava tokens are the keys to someone's Strava account, so the app never
-- sees them (R4): the coach server exchanges the OAuth code, stores the tokens
-- here with the service role, and calls Strava on the athlete's behalf. No app
-- user, signed in or not, can read or write this table: there are no table
-- rights for them and the one policy refuses everything. Imported activities
-- go to the athlete's device (IndexedDB), never into Supabase (R1).

create table if not exists public.strava_connections (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  strava_athlete_id  bigint not null,
  access_token       text not null,
  refresh_token      text not null,
  token_expires_at   timestamptz not null,
  athlete_name       text,
  scope              text,
  connected_at       timestamptz not null default now(),
  last_sync_at       timestamptz
);

alter table public.strava_connections enable row level security;

drop policy if exists strava_connections_no_access on public.strava_connections;
create policy strava_connections_no_access on public.strava_connections for all to anon, authenticated
  using (false) with check (false);

revoke all on public.strava_connections from anon, authenticated;
