import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../../lib/supabase';
import { supabaseCircuit } from '../../lib/circuitBreaker';
import {
  acceptFollow, blockUser, createPost, fetchFeed, getBlockedUsers, getFollowStatus, getPost, getPendingFollowRequests, getProfile, getProfilePosts,
  removeFollow, reportContent, requestFollow, searchProfiles, unblockUser, type CommunityPost,
} from '../../lib/communityService';
import { FakeBackend } from './fakeBackend';
import { RIYA, VISHAL } from './journeyFixtures';

// Follows, blocks and reports between two members. What each of them can see
// follows the row-level security rules, modelled in fakeBackend.ts.

let backend: FakeBackend;
let publicPost: CommunityPost;
let followersPost: CommunityPost;

const titlesInFeed = async (viewer: string) => {
  backend.as(viewer);
  return (await fetchFeed(viewer)).data?.data.map((p) => p.title) ?? [];
};

beforeEach(async () => {
  backend = new FakeBackend();
  backend.addUser(VISHAL, 'Vishal Bhardwaj');
  backend.addUser(RIYA, 'Riya Sharma');
  vi.mocked(getSupabase).mockReturnValue(backend.client());
  supabaseCircuit.reset();
  backend.as(VISHAL);
  publicPost = (await createPost(VISHAL, { title: 'Public sled push', activity_type: 'HYROX', visibility: 'public' })).data!;
  followersPost = (await createPost(VISHAL, { title: 'Followers tempo run', activity_type: 'Run', visibility: 'followers' })).data!;
  await createPost(VISHAL, { title: 'Private weigh-in', activity_type: 'Other', visibility: 'private' });
});

/** Riya asks to follow Vishal and he accepts. */
async function riyaFollowsVishal() {
  backend.as(RIYA);
  await requestFollow(RIYA, VISHAL);
  backend.as(VISHAL);
  await acceptFollow(RIYA, VISHAL);
}

describe('social journey', () => {
  it('a follow request stays pending until accepted, then followers-only posts show', async () => {
    backend.as(RIYA);
    expect((await requestFollow(RIYA, VISHAL)).error).toBeNull();
    expect((await getFollowStatus(RIYA, VISHAL)).data).toBe('pending');
    expect(await titlesInFeed(RIYA)).toEqual(['Public sled push']);
    // Opening the post directly is refused too: only the access rule stands in the way here.
    expect((await getPost(followersPost.id, RIYA)).error).toBe('Post not found.');

    backend.as(VISHAL);
    expect((await getPendingFollowRequests(VISHAL)).data?.map((r) => r.profile.display_name)).toEqual(['Riya Sharma']);
    expect((await acceptFollow(RIYA, VISHAL)).error).toBeNull();

    backend.as(RIYA);
    expect((await getFollowStatus(RIYA, VISHAL)).data).toBe('accepted');
    expect(await titlesInFeed(RIYA)).toEqual(['Followers tempo run', 'Public sled push']);
    expect((await getProfilePosts(VISHAL, RIYA)).data?.data.map((p) => p.id)).toEqual([followersPost.id, publicPost.id]);
    expect((await getPost(followersPost.id, RIYA)).data?.title).toBe('Followers tempo run');
  });

  it('unfollowing hides followers-only posts again', async () => {
    await riyaFollowsVishal();
    expect(await titlesInFeed(RIYA)).toContain('Followers tempo run');
    backend.as(RIYA);
    expect((await removeFollow(RIYA, VISHAL)).error).toBeNull();
    expect(await titlesInFeed(RIYA)).toEqual(['Public sled push']);
    expect((await getFollowStatus(RIYA, VISHAL)).data).toBe('none');
  });

  it('blocking hides posts, the profile and search results both ways, and ends the follow', async () => {
    await riyaFollowsVishal();
    backend.as(VISHAL);
    expect((await blockUser(VISHAL, RIYA)).error).toBeNull();
    expect(backend.tables.follows).toEqual([]);

    backend.as(RIYA);
    expect(await titlesInFeed(RIYA)).toEqual([]);
    // ProfilePage shows "This athlete is not available" for exactly this error.
    expect((await getProfile(VISHAL)).error).toBe('Profile not found.');
    expect((await searchProfiles('vish', RIYA)).data).toEqual([]);
    backend.as(VISHAL);
    expect((await searchProfiles('riya', VISHAL)).data).toEqual([]);
    expect((await getBlockedUsers(VISHAL)).data?.map((p) => p.display_name)).toEqual(['Riya Sharma']);
  });

  it('unblocking brings the profile back, but not the old follow', async () => {
    await riyaFollowsVishal();
    backend.as(VISHAL);
    await blockUser(VISHAL, RIYA);
    expect((await unblockUser(VISHAL, RIYA)).error).toBeNull();
    expect((await getBlockedUsers(VISHAL)).data).toEqual([]);

    backend.as(RIYA);
    expect((await getProfile(VISHAL)).data?.display_name).toBe('Vishal Bhardwaj');
    expect((await searchProfiles('vish', RIYA)).data?.map((p) => p.id)).toEqual([VISHAL]);
    expect((await getFollowStatus(RIYA, VISHAL)).data).toBe('none');
    expect(await titlesInFeed(RIYA)).toEqual(['Public sled push']);
  });

  it('a report is saved for moderators and the reporter cannot read it back', async () => {
    backend.as(RIYA);
    expect((await reportContent(RIYA, { postId: publicPost.id }, 'Spam <a href="x">link</a>')).error).toBeNull();
    expect(backend.tables.reports).toEqual([expect.objectContaining({ reporter_id: RIYA, post_id: publicPost.id, reason: 'Spam link' })]);
    expect(backend.calls('reports', 'select')).toEqual([]); // the service never reads reports

    const readBack = await backend.client().from('reports').select('*');
    expect(readBack.data).toEqual([]);
    // Nor can anyone file a report in someone else's name.
    expect((await reportContent(VISHAL, { postId: publicPost.id }, 'Fake')).error).toBe("You don't have permission to do that.");
  });
});
