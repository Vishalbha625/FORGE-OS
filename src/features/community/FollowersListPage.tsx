import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../store/toast';
import { Segmented } from '../../components/ui';
import { acceptFollow, getFollowList, getPendingFollowRequests, getProfile, removeFollow, type CommunityProfile, type FollowRelation } from '../../lib/communityService';
import { ProfileRow } from './shared';
import { useSocialNotify } from './useSocialNotify';

type Tab = 'followers' | 'following';

/** /community/profile/:userId/followers and /following. */
export function FollowersListPage() {
  const { userId = '' } = useParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const notifySocial = useSocialNotify();
  const tab: Tab = pathname.endsWith('/following') ? 'following' : 'followers';
  const isMe = user?.id === userId;

  const [name, setName] = useState<string>('');
  const [list, setList] = useState<CommunityProfile[]>([]);
  const [pending, setPending] = useState<FollowRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [people, requests, owner] = await Promise.all([
      getFollowList(userId, tab),
      isMe && tab === 'followers' ? getPendingFollowRequests(userId) : Promise.resolve(null),
      getProfile(userId),
    ]);
    setLoading(false);
    if (owner.data) setName(owner.data.display_name);
    if (people.error || !people.data) {
      setError(people.error ?? 'Could not load the list.');
      return;
    }
    setError(null);
    setList(people.data);
    setPending(requests?.data ?? []);
  }, [userId, tab, isMe]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async (r: FollowRelation) => {
    setBusy(r.follower_id);
    const res = await acceptFollow(r.follower_id, userId);
    setBusy(null);
    if (res.error) {
      toast(`Not accepted. ${res.error}`);
      return;
    }
    setPending((p) => p.filter((x) => x.follower_id !== r.follower_id));
    setList((l) => [r.profile, ...l.filter((x) => x.id !== r.profile.id)]);
    notifySocial('follow_accepted', r.follower_id);
    toast(`${r.profile.display_name} can now see your followers-only posts`);
  };

  const decline = async (r: FollowRelation) => {
    setBusy(r.follower_id);
    const res = await removeFollow(r.follower_id, userId);
    setBusy(null);
    if (res.error) {
      toast(`Not declined. ${res.error}`);
      return;
    }
    setPending((p) => p.filter((x) => x.follower_id !== r.follower_id));
  };

  return (
    <div className="pb-8">
      <div className="mb-3 mt-3 flex items-center justify-between gap-2">
        <Link to={`/community/profile/${userId}`} className="link inline-flex min-w-0 items-center gap-1.5">
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate">{name || 'Profile'}</span>
        </Link>
        <button className="grid h-9 w-9 place-items-center rounded-md border border-border text-foreground/80 hover:text-foreground" onClick={() => void load()} disabled={loading} aria-label="Refresh">
          <RefreshCw className={`h-4 w-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden />
        </button>
      </div>
      <Segmented
        value={tab}
        onChange={(t) => navigate(`/community/profile/${userId}/${t}`, { replace: true })}
        options={[{ value: 'followers', label: 'Followers' }, { value: 'following', label: 'Following' }]}
        label="Followers or following"
      />

      {pending.length > 0 && (
        <section className="mt-5" aria-labelledby="pending-title">
          <h2 id="pending-title" className="text-sm font-medium">Pending requests</h2>
          <p className="text-xs text-muted">Accepting lets them see your followers-only posts.</p>
          <ul className="mt-1 divide-y divide-border">
            {pending.map((r) => (
              <ProfileRow
                key={r.follower_id}
                profile={r.profile}
                right={
                  <span className="flex shrink-0 gap-1.5">
                    <button className="btn-soft h-8 px-3 text-xs" disabled={busy === r.follower_id} onClick={() => accept(r)}>Accept</button>
                    <button className="btn-outline h-8 px-3 text-xs" disabled={busy === r.follower_id} onClick={() => decline(r)}>Decline</button>
                  </span>
                }
              />
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5" aria-label={tab === 'followers' ? 'Followers' : 'Following'}>
        {loading && list.length === 0 ? (
          <div className="space-y-2" role="status" aria-label="Loading">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary motion-safe:animate-pulse" />)}</div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">{error}</p>
            <button className="btn-outline mt-3" onClick={() => void load()}>Try again</button>
          </div>
        ) : list.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted">{tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}</p>
            <Link to="/community/search" className="btn-outline mt-3 inline-flex">Find athletes</Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">{list.map((p) => <ProfileRow key={p.id} profile={p} />)}</ul>
        )}
      </section>
    </div>
  );
}
