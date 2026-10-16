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

-- ── photos.sql ────────────────────────────────────────────────────────────────
\set dave    '44444444-4444-4444-4444-444444444444'
\set pubpost '55555555-5555-5555-5555-555555555555'
\set pripost '66666666-6666-6666-6666-666666666666'
insert into auth.users (id, email) values (:'dave', 'd@x');
insert into public.profiles (id, display_name) values (:'dave', 'Dave');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
insert into public.posts (id, author_id, event_date, title, activity_type, visibility, photo_path) values
  (:'pubpost', :'alice', '2026-10-15', 'Public sled push', 'HYROX', 'public', :'alice' || '/' || :'pubpost'),
  (:'pripost', :'alice', '2026-10-15', 'Private weigh-in', 'Other', 'private', :'alice' || '/' || :'pripost');
insert into storage.objects (bucket_id, name) values
  ('post-photos', :'alice' || '/' || :'pubpost' || '/thumb.webp'),
  ('post-photos', :'alice' || '/' || :'pubpost' || '/full.webp'),
  ('post-photos', :'alice' || '/' || :'pripost' || '/thumb.webp');
commit;

\echo '14. thumb and full of a visible post are readable; a private post''s are not'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'dave', true) \gset
do $$ begin assert (select count(*) from storage.objects where name like '%/55555555-5555-5555-5555-555555555555/%') = 2, 'stranger should read both variants of a public post photo'; end $$;
do $$ begin assert (select count(*) from storage.objects where name like '%/66666666-6666-6666-6666-666666666666/%') = 0, 'stranger read a private post photo'; end $$;
commit;

\echo '15. photo_path cannot point outside the author''s own folder'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'dave', true) \gset
do $$ begin
  insert into public.posts (author_id, event_date, title, activity_type, visibility, photo_path) values
    ('44444444-4444-4444-4444-444444444444', '2026-10-15', 'Borrowed photo', 'Run', 'public',
     '11111111-1111-1111-1111-111111111111/66666666-6666-6666-6666-666666666666');
  raise exception 'FAIL: dave pointed his post at alice''s private photo';
exception when check_violation then null; end $$;
do $$ begin assert (select count(*) from storage.objects where name like '%/66666666-6666-6666-6666-666666666666/%') = 0, 'private photo leaked through another post'; end $$;
commit;

\echo '16. the photo bucket only takes small WebP or JPEG files'
do $$ begin
  assert (select file_size_limit from storage.buckets where id = 'post-photos') = 262144, 'size cap missing';
  assert (select allowed_mime_types from storage.buckets where id = 'post-photos') = array['image/webp', 'image/jpeg'], 'type allow-list missing';
end $$;

-- ── social.sql ────────────────────────────────────────────────────────────────
-- State here: bob follows alice (accepted, test 6); alice and carol are blocked
-- (test 9); dave is a stranger to everyone.
\set erin '77777777-7777-7777-7777-777777777777'
insert into auth.users (id, email) values (:'erin', 'e@x');
insert into public.profiles (id, display_name) values (:'erin', 'Erin');
insert into public.follows (follower_id, followee_id, status) values (:'erin', :'alice', 'pending');
insert into storage.objects (bucket_id, name) values
  ('post-photos', :'alice' || '/avatar.webp'),
  ('post-photos', :'dave' || '/avatar.webp');

\echo '17. avatars are readable by signed-in users, but not across a block'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'dave', true) \gset
do $$ begin assert (select count(*) from storage.objects where name like '%/avatar.webp') = 2, 'dave should read both avatars'; end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin assert (select count(*) from storage.objects where name = '11111111-1111-1111-1111-111111111111/avatar.webp') = 0, 'blocked user read an avatar'; end $$;
do $$ begin assert (select count(*) from storage.objects where name = '44444444-4444-4444-4444-444444444444/avatar.webp') = 1, 'carol should read dave''s avatar'; end $$;
commit;

\echo '18. follow counts and lists show accepted follows only, to signed-in users'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'dave', true) \gset
do $$ begin
  assert (select followers from public.profile_follow_counts('11111111-1111-1111-1111-111111111111')) = 1, 'alice has one accepted follower (erin is pending)';
  assert (select following from public.profile_follow_counts('22222222-2222-2222-2222-222222222222')) = 1, 'bob follows one';
  assert (select array_agg(display_name) from public.profile_follows('11111111-1111-1111-1111-111111111111', 'followers')) = array['Bob'], 'dave should see bob as alice''s follower';
  assert (select count(*) from public.profile_follows('22222222-2222-2222-2222-222222222222', 'following')) = 1, 'bob follows alice';
  assert (select count(*) from public.profile_follows('11111111-1111-1111-1111-111111111111', 'sideways')) = 0, 'unknown direction returns nothing';
end $$;
-- pending requests stay private: dave still can't read the follow rows themselves
do $$ begin assert (select count(*) from public.follows) = 0, 'a stranger read follow rows'; end $$;
commit;
begin; set local role anon; select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin
  perform public.profile_follow_counts('11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL: anonymous caller ran profile_follow_counts';
exception when insufficient_privilege then null; end $$;
commit;

\echo '19. blocked users see no counts or lists for each other'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin
  assert (select count(*) from public.profile_follow_counts('11111111-1111-1111-1111-111111111111')) = 0, 'carol got alice''s counts';
  assert (select count(*) from public.profile_follows('11111111-1111-1111-1111-111111111111', 'followers')) = 0, 'carol got alice''s followers';
end $$;
commit;

\echo '20. only the blocker can list the people they blocked'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
do $$ begin
  assert (select array_agg(display_name) from public.get_blocked_users('11111111-1111-1111-1111-111111111111')) = array['Carol'], 'alice should see carol in her block list';
  -- carol's profile itself stays hidden from alice (blocks hide everything)
  assert (select count(*) from public.profiles where display_name = 'Carol') = 0, 'blocked profile became readable';
end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'dave', true) \gset
do $$ begin assert (select count(*) from public.get_blocked_users('11111111-1111-1111-1111-111111111111')) = 0, 'dave read alice''s block list'; end $$;
commit;
begin; set local role anon; select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin
  perform public.get_blocked_users('11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL: anonymous caller listed blocks';
exception when insufficient_privilege then null; end $$;
commit;

\echo '21. push subscriptions are private to their owner'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, device_tag) values (auth.uid(), 'https://push.example/alice', 'p', 'a', 'phone');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key) values (auth.uid(), 'https://push.example/bob', 'p', 'a');
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 1, 'bob should see only his own subscription';
  assert (select endpoint from public.push_subscriptions) = 'https://push.example/bob', 'bob read someone else''s subscription';
end $$;
update public.push_subscriptions set endpoint = 'https://evil.example/hijack' where user_id = '11111111-1111-1111-1111-111111111111';
delete from public.push_subscriptions where user_id = '11111111-1111-1111-1111-111111111111';
do $$ begin
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key) values ('11111111-1111-1111-1111-111111111111', 'https://evil.example/x', 'p', 'a');
  raise exception 'FAIL: bob subscribed in alice''s name';
exception when insufficient_privilege then null; end $$;
commit;
do $$ begin
  assert (select endpoint from public.push_subscriptions where user_id = '11111111-1111-1111-1111-111111111111') = 'https://push.example/alice', 'bob changed or deleted alice''s subscription';
end $$;
begin; set local role anon; select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin
  perform 1 from public.push_subscriptions;
  raise exception 'FAIL: anonymous caller read push subscriptions';
exception when insufficient_privilege then null; end $$;
commit;

\echo '22. notifications: only the recipient reads them, and only flips "read"'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
insert into public.kudos (post_id, user_id) select id, auth.uid() from public.posts where title = 'Public HYROX sim' on conflict do nothing;
insert into public.notifications (user_id, actor_id, type, post_id)
  select '11111111-1111-1111-1111-111111111111', auth.uid(), 'kudos_received', id from public.posts where title = 'Public HYROX sim';
do $$ begin assert (select count(*) from public.notifications) = 0, 'the sender read the notification he sent'; end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
do $$ begin assert (select count(*) from public.notifications where read = false) = 1, 'alice should have one unread notification'; end $$;
update public.notifications set read = true where user_id = auth.uid();
do $$ begin assert (select bool_and(read) from public.notifications), 'alice could not mark her notification read'; end $$;
do $$ begin
  update public.notifications set actor_id = '33333333-3333-3333-3333-333333333333';
  raise exception 'FAIL: alice rewrote who a notification is from';
exception when insufficient_privilege then null; end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin assert (select count(*) from public.notifications) = 0, 'carol read alice''s notifications'; end $$;
commit;
begin; set local role anon; select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin
  perform 1 from public.notifications;
  raise exception 'FAIL: anonymous caller read notifications';
exception when insufficient_privilege then null; end $$;
commit;

\echo '23. notifications: only about something you really did, as yourself, once per 5 minutes'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
do $$ begin
  insert into public.notifications (user_id, actor_id, type, post_id)
    select '11111111-1111-1111-1111-111111111111', auth.uid(), 'kudos_received', id from public.posts where title = 'Public HYROX sim';
  raise exception 'FAIL: the same kudos notified twice within 5 minutes';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.notifications (user_id, actor_id, type) values (auth.uid(), '11111111-1111-1111-1111-111111111111', 'follow_accepted');
  raise exception 'FAIL: bob created a notification in alice''s name';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.notifications (user_id, actor_id, type) values ('11111111-1111-1111-1111-111111111111', auth.uid(), 'follow_accepted');
  raise exception 'FAIL: bob announced an acceptance that never happened';
exception when insufficient_privilege then null; end $$;
do $$ begin
  assert not public.notification_allowed('follow_accepted', '11111111-1111-1111-1111-111111111111', auth.uid(), null, null), 'the check answered about someone else''s action';
end $$;
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'alice', true) \gset
-- bob follows alice (accepted earlier): alice may tell him so
insert into public.notifications (user_id, actor_id, type) values ('22222222-2222-2222-2222-222222222222', auth.uid(), 'follow_accepted');
commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'carol', true) \gset
do $$ begin
  insert into public.notifications (user_id, actor_id, type) values ('11111111-1111-1111-1111-111111111111', auth.uid(), 'follow_request');
  raise exception 'FAIL: a blocked user notified alice';
exception when insufficient_privilege then null; end $$;
commit;
-- A block after the event still stops the notification.
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
insert into public.comments (post_id, author_id, body) select id, auth.uid(), 'Nice one' from public.posts where title = 'Public HYROX sim';
commit;
select set_config('test.cid', id::text, false), set_config('test.pid', post_id::text, false) from public.comments where body = 'Nice one' \gset
insert into public.blocks (blocker_id, blocked_id) values (:'alice', :'bob');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'bob', true) \gset
do $$ begin
  insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
    values ('11111111-1111-1111-1111-111111111111', auth.uid(), 'comment_received', current_setting('test.pid')::uuid, current_setting('test.cid')::uuid);
  raise exception 'FAIL: bob notified alice after she blocked him';
exception when insufficient_privilege then null; end $$;
commit;
delete from public.blocks where blocker_id = :'alice' and blocked_id = :'bob';
do $$ begin assert (select count(*) from public.notifications) = 2, 'expected exactly the two genuine notifications'; end $$;

\echo ''
\echo 'ALL RLS TESTS PASSED'
