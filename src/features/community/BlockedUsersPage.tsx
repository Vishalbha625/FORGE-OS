import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { useToast } from '../../store/toast';
import { getBlockedUsers, unblockUser, type CommunityProfile } from '../../lib/communityService';
import { Avatar } from './shared';

export function BlockedUsersPage() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const toast = useToast();
  const [list, setList] = useState<CommunityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getBlockedUsers(me);
    setLoading(false);
    setError(res.error);
    setList(res.data ?? []);
  }, [me]);

  useEffect(() => {
    void load();
  }, [load]);

  const unblock = async (p: CommunityProfile) => {
    setBusy(p.id);
    const res = await unblockUser(me, p.id);
    setBusy(null);
    if (res.error) {
      toast(`Not unblocked. ${res.error}`);
      return;
    }
    setList((l) => l.filter((x) => x.id !== p.id));
    toast(`${p.display_name} unblocked`);
  };

  return (
    <div className="pb-8">
      <Link to="/profile" className="link mb-3 mt-3 inline-flex items-center gap-1.5">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to profile
      </Link>
      <h1 className="text-xl font-medium tracking-tight">Blocked athletes</h1>
      <p className="mb-4 mt-1 text-sm text-muted">They can't see your posts or profile, and you can't see theirs. Unblocking doesn't restore follows.</p>
      {loading ? (
        <div className="space-y-2" role="status" aria-label="Loading">{[0, 1].map((i) => <div key={i} className="h-12 rounded-lg bg-secondary motion-safe:animate-pulse" />)}</div>
      ) : error ? (
        <div className="py-8 text-center">
          <p className="text-sm text-muted">{error}</p>
          <button className="btn-outline mt-3" onClick={() => void load()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">You haven't blocked anyone.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={p.display_name} path={p.avatar_path} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.display_name}</span>
              <button className="btn-outline h-8 shrink-0 px-3 text-xs" disabled={busy === p.id} onClick={() => unblock(p)}>
                {busy === p.id ? 'Unblocking…' : 'Unblock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
