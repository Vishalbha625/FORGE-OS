import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../../components/ui';
import { useToast } from '../../store/toast';
import { getDB } from '../../db/database';
import { blockUser, reportContent } from '../../lib/communityService';
import { removeAuthorFromCache } from '../../lib/feedCache';

export type BlockReportMode = 'block' | 'report';

interface Props {
  mode: BlockReportMode | null;
  onClose: () => void;
  currentUserId: string;
  /** The person being blocked or reported (or the author of the reported post). */
  target: { userId: string; name: string; postId?: string; commentId?: string };
}

export function BlockReportSheet({ mode, onClose, currentUserId, target }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason('');
    setError(null);
  }, [mode]);

  const block = async () => {
    setBusy(true);
    setError(null);
    const res = await blockUser(currentUserId, target.userId);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    // Their posts leave the cached feed now, not at the next refresh.
    getDB().then((db) => removeAuthorFromCache(db, target.userId)).catch(() => {});
    toast(`${target.name} blocked`);
    onClose();
    navigate('/community', { replace: true });
  };

  const report = async () => {
    setBusy(true);
    setError(null);
    const what = target.postId ? { postId: target.postId } : target.commentId ? { commentId: target.commentId } : { userId: target.userId };
    const res = await reportContent(currentUserId, what, reason);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    toast('Report submitted. Thank you.');
    onClose();
  };

  const subject = target.postId ? 'this post' : target.commentId ? 'this comment' : target.name;

  return (
    <Sheet open={mode !== null} onClose={onClose} title={mode === 'block' ? `Block ${target.name}?` : `Report ${subject}`}>
      {mode === 'block' ? (
        <div>
          <p className="text-sm text-muted">
            Blocking {target.name} will remove any follows between you and hide all their content. They won't be notified.
          </p>
          {error && <p role="alert" className="mt-4 rounded-lg border border-bad/40 px-3 py-2.5 text-sm text-bad">{error}</p>}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-danger" onClick={block} disabled={busy}>{busy ? 'Blocking…' : 'Block'}</button>
          </div>
        </div>
      ) : (
        <div>
          <label className="block">
            <span className="label">Why are you reporting this?</span>
            <textarea className="field min-h-[110px]" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell us what's wrong" />
          </label>
          <p className="mt-1 text-xs text-muted">Reports go to the community moderators. {target.name} won't see who reported.</p>
          {error && <p role="alert" className="mt-4 rounded-lg border border-bad/40 px-3 py-2.5 text-sm text-bad">{error}</p>}
          <button className="btn-solid mt-5 w-full" onClick={report} disabled={busy || !reason.trim()}>{busy ? 'Sending…' : 'Submit report'}</button>
        </div>
      )}
    </Sheet>
  );
}
