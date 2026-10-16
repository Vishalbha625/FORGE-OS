-- Minimal stand-ins for what Supabase provides, so schema.sql / storage.sql and
-- their row-level security can be tested on plain Postgres. NOT for production.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
-- Supabase's service_role: used only by the coach server, bypasses RLS, and
-- has full rights on every table (Supabase grants this by default).
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
-- Supabase's own defaults: every new table, sequence and function in public is
-- granted to anon, authenticated and service_role. The schema files must revoke
-- what they don't want, and these tests check that they do.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
-- Supabase's auth.uid(): the `sub` claim of the caller's JWT. Same definition
-- as Supabase: the legacy per-claim setting (used by rls_test.sql) or the JSON
-- claims PostgREST sends.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
