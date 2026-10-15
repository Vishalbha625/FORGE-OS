import { useEffect, useState } from 'react';
import { Sheet } from '../../components/ui';
import { useToast } from '../../store/toast';
import { fmtDuration } from '../../lib/calc';
import { updatePost, type CommunityPost, type UpdatePostInput } from '../../lib/communityService';
import { PostForm, draftToInput, type PostDraft } from './PostForm';
import { ACTIVITY_TYPES, isOffline, type ActivityType } from './shared';

const toDraft = (p: CommunityPost): PostDraft => ({
  title: p.title,
  activity: (ACTIVITY_TYPES as readonly string[]).includes(p.activity_type) ? (p.activity_type as ActivityType) : 'Other',
  distance: p.distance_km !== undefined ? String(p.distance_km) : '',
  duration: p.duration_sec !== undefined ? fmtDuration(p.duration_sec) : '',
  stationDetail: p.station_detail ?? '',
  caption: p.caption ?? '',
  isPr: p.is_pr,
  visibility: p.visibility,
  eventDate: p.event_date,
});

interface Props {
  post: CommunityPost | null;
  userId: string;
  onClose: () => void;
  onSaved: (post: CommunityPost) => void;
}

/** Same form as a new post; the activity type and photo can't change. */
export function EditPostSheet({ post, userId, onClose, onSaved }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<PostDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(post ? toDraft(post) : null);
    setError(null);
  }, [post]);

  const save = async () => {
    if (!post || !draft) return;
    if (isOffline()) {
      setError("You're offline. Edits need a connection.");
      return;
    }
    const input = draftToInput(draft);
    // Every field is sent: a key that is present but empty clears that field.
    const updates: UpdatePostInput = {
      title: input.title,
      caption: input.caption,
      is_pr: input.is_pr,
      visibility: input.visibility,
    };
    if (post.activity_type === 'Run') Object.assign(updates, { distance_km: input.distance_km, duration_sec: input.duration_sec, pace_sec_per_km: input.pace_sec_per_km });
    if (post.activity_type === 'Strength' || post.activity_type === 'HYROX') updates.station_detail = input.station_detail;

    setBusy(true);
    setError(null);
    const res = await updatePost(post.id, userId, updates);
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error ?? 'Could not save the changes.');
      return;
    }
    onSaved(res.data);
    toast('Changes saved');
    onClose();
  };

  return (
    <Sheet open={post !== null && draft !== null} onClose={onClose} title="Edit post">
      {draft && <PostForm draft={draft} onChange={setDraft} onSubmit={save} submitLabel="Save changes" busy={busy} error={error} locked />}
    </Sheet>
  );
}
