-- Row-level security tests for supabase/schema.sql + storage.sql.
-- Run with supabase/tests/run.sh (spins up a throwaway Postgres).
-- Any failed assertion aborts with a non-zero exit code.
\set ON_ERROR_STOP on
\set QUIET on

\set alice   '11111111-1111-1111-1111-111111111111'
\set bob     '22222222-2222-2222-2222-222222222222'
\set carol   '33333333-3333-3333-3333-333333333333'

-- ── Fixtures (as the database owner, which bypasses RLS) ───────────────────────
insert into auth.users (id, email) values (:'alice', 'a@x'), (:'bob', 'b@x'), (:'carol', 'c@x');
insert into public.profiles (id, display_name) values (:'alice', 'Alice'), (:'bob', 'Bob'), (:'carol', 'Carol');

-- Alice creates three posts through the API role (exercises the insert policy).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'alice', true) \gset
insert into public.posts (author_id, event_date, title, activity_type, visibility, photo_path) values
  (:'alice', '2026-10-12', 'Private tempo', 'Run', 'private', null),
  (:'alice', '2026-10-13', 'Followers long run', 'Run', 'followers', :'alice' || '/p2/photo.jpg'),
  (:'alice', '2026-10-14', 'Public HYROX sim', 'HYROX', 'public', null);
insert into storage.objects (bucket_id, name) values ('post-photos', :'alice' || '/p2/photo.jpg');
commit;

\echo '1. author sees all own posts'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
do $$ begin assert (select count(*) from public.posts) = 3, 'alice should see 3 posts'; end $$;
commit;

\echo '2. stranger sees only public'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
do $$ begin assert (select count(*) from public.posts) = 1, 'bob (not following) should see 1'; end $$;
do $$ begin assert (select title from public.posts) = 'Public HYROX sim', 'bob should only see the public post'; end $$;
commit;

\echo '3. a pending follow request grants nothing'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
insert into public.follows (follower_id, followee_id) values (:'bob', :'alice');
do $$ begin assert (select count(*) from public.posts) = 1, 'pending follow must not unlock followers posts'; end $$;
commit;

\echo '4. follower cannot accept their own request'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
update public.follows set status = 'accepted' where follower_id = auth.uid();
do $$ begin assert (select status from public.follows where follower_id = auth.uid()) = 'pending', 'bob must not self-accept'; end $$;
commit;

\echo '5. follower cannot insert an already-accepted follow'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin
  insert into public.follows (follower_id, followee_id, status) values (auth.uid(), '11111111-1111-1111-1111-111111111111', 'accepted');
  raise exception 'FAIL: carol inserted an accepted follow';
exception when insufficient_privilege then null; end $$;
commit;

\echo '6. after the author accepts, follower sees followers-only but not private'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
update public.follows set status = 'accepted' where followee_id = auth.uid();
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
do $$ begin assert (select count(*) from public.posts) = 2, 'accepted follower should see 2'; end $$;
do $$ begin assert not exists (select 1 from public.posts where visibility = 'private'), 'private post leaked to follower'; end $$;
commit;

\echo '7. nobody can write as someone else'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
do $$ begin
  insert into public.posts (author_id, event_date, title, activity_type) values ('11111111-1111-1111-1111-111111111111', '2026-10-15', 'Forged', 'Run');
  raise exception 'FAIL: bob posted as alice';
exception when insufficient_privilege then null; end $$;
update public.posts set title = 'hacked';
delete from public.posts;
do $$ begin assert (select count(*) from public.posts where title = 'hacked') = 0, 'bob edited alice''s post'; end $$;
commit;
do $$ begin assert (select count(*) from public.posts) = 3, 'bob deleted alice''s posts'; end $$;

\echo '8. comments and kudos follow post visibility'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
insert into public.comments (post_id, author_id, body) select id, auth.uid(), 'Nice!' from public.posts where visibility = 'followers';
insert into public.kudos (post_id, user_id) select id, auth.uid() from public.posts where visibility = 'followers';
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin assert (select count(*) from public.comments) = 0, 'carol saw a comment on a followers-only post'; end $$;
do $$ begin assert (select count(*) from public.kudos) = 0, 'carol saw kudos on a followers-only post'; end $$;
commit;
-- carol tries to comment on the private post, using its id fetched by the owner
do $$ declare pid uuid; begin
  select id into pid from public.posts where visibility = 'private';
  perform set_config('test.private_post', pid::text, false);
end $$;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin
  insert into public.comments (post_id, author_id, body) values (current_setting('test.private_post')::uuid, auth.uid(), 'sneaky');
  raise exception 'FAIL: carol commented on a private post';
exception when insufficient_privilege then null; end $$;
commit;

\echo '9. blocking hides everything both ways'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), :'carol');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin assert (select count(*) from public.posts) = 0, 'blocked user still sees public post'; end $$;
do $$ begin assert (select count(*) from public.profiles where display_name = 'Alice') = 0, 'blocked user still sees blocker profile'; end $$;
do $$ begin assert (select count(*) from public.blocks) = 0, 'blocked user can read the block list'; end $$;
commit;

\echo '10. anonymous visitors get nothing'
begin; set local role anon;
do $$ begin
  perform count(*) from public.posts;
  raise exception 'FAIL: anon read posts';
exception when insufficient_privilege then null; end $$;
commit;

\echo '11. reports are write-only for users'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
insert into public.reports (reporter_id, user_id, reason) values (auth.uid(), :'carol', 'spam');
do $$ begin
  perform count(*) from public.reports;
  raise exception 'FAIL: user read reports';
exception when insufficient_privilege then null; end $$;
commit;

\echo '12. post photos follow post visibility; uploads stay in your own folder'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
do $$ begin assert (select count(*) from storage.objects) = 1, 'accepted follower should read the followers-post photo'; end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('post-photos', '11111111-1111-1111-1111-111111111111/p9/evil.jpg');
  raise exception 'FAIL: bob uploaded into alice''s folder';
exception when insufficient_privilege then null; end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin assert (select count(*) from storage.objects) = 0, 'blocked stranger read a followers-only photo'; end $$;
commit;

\echo '13. authors cannot rewrite ownership or timestamps'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
update public.posts set created_at = '2000-01-01' where visibility = 'public';
do $$ begin assert (select created_at > '2020-01-01' from public.posts where visibility = 'public'), 'created_at was rewritten'; end $$;
commit;

\echo ''
\echo 'ALL RLS TESTS PASSED'
