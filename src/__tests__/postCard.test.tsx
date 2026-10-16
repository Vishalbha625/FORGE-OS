import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { PostCard } from '../features/community/PostCard';
import { AuthProvider } from '../store/AuthContext';
import { AppProvider } from '../store/AppContext';
import type { CommunityPost } from '../lib/communityService';

const post = (extra: Partial<CommunityPost> = {}): CommunityPost => ({
  id: 'p1', author_id: 'u-author', event_date: '2026-10-15', title: 'Sled push PB', activity_type: 'HYROX',
  is_pr: false, visibility: 'public', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  author: { id: 'u-author', display_name: 'Vishal Bhardwaj', goals: [], created_at: '2026-10-01T00:00:00Z' },
  kudos_count: 12, comment_count: 3, user_has_kudosed: false, ...extra,
});
// The card reads the session (to notify the author after kudos), so it renders inside the app's providers.
const render = (p: CommunityPost, me = 'u-viewer') => renderToStaticMarkup(<MemoryRouter><AuthProvider><AppProvider><PostCard post={p} currentUserId={me} /></AppProvider></AuthProvider></MemoryRouter>);

describe('PostCard', () => {
  it('renders the title, the author and a link to their profile', () => {
    const html = render(post());
    expect(html).toContain('Sled push PB');
    expect(html).toContain('Vishal Bhardwaj');
    expect(html).toContain('href="/community/profile/u-author"');
    expect(html).toContain('>VB<'); // initials avatar
  });

  it('renders the kudos and comment counts, and whether you gave kudos', () => {
    const html = render(post());
    expect(html).toMatch(/aria-label="Give kudos"[^>]*>.*?>12</);
    expect(html).toContain('Comments (3)');
    expect(render(post({ user_has_kudosed: true }))).toContain('aria-label="Remove kudos"');
  });

  it('shows only the stats that were shared, never a 0 for missing ones', () => {
    const html = render(post({ activity_type: 'Run', distance_km: 12.5, duration_sec: 3725, pace_sec_per_km: 298 }));
    expect(html).toContain('12.5 km');
    expect(html).toContain('1:02:05');
    expect(html).toContain('4:58 /km');
    expect(html).not.toContain('↑');
    expect(render(post())).not.toContain(' km<');
  });

  it('shows the PR badge, and a post menu to signed-in viewers (edit on yours, report on others)', () => {
    expect(render(post({ is_pr: true }))).toContain('>PR<');
    expect(render(post())).toContain('Post options'); // others' posts: report
    expect(render(post(), '')).not.toContain('Post options'); // nobody signed in: no menu
    const mine = renderToStaticMarkup(<MemoryRouter><AuthProvider><AppProvider><PostCard post={post()} currentUserId="u-author" onEdit={() => {}} onRemove={() => {}} /></AppProvider></AuthProvider></MemoryRouter>);
    expect(mine).toContain('Post options');
    expect(render(post())).toContain('href="/community/profile/u-author"');
  });
});
