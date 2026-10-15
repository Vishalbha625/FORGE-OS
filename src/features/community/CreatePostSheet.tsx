import { useEffect, useState } from 'react';
import { Dumbbell, Footprints, Timer } from 'lucide-react';
import { Sheet } from '../../components/ui';
import { useApp } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { getByDateRange, getDB } from '../../db/database';
import { addDays, todayISO, DEFAULT_TZ } from '../../lib/dates';
import { createPost, type CommunityPost } from '../../lib/communityService';
import { queueCommunityWrite } from '../../lib/offlineQueueProcessor';
import { PostForm, draftToInput, emptyDraft, type PostDraft } from './PostForm';
import { describeWorkout, pickRecent, workoutToDraft, type RecentWorkout } from './recentWorkouts';
import { isOffline } from './shared';

const ICONS = { run: Footprints, strength: Dumbbell, hyrox: Timer } as const;

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  onCreated: (post: CommunityPost) => void;
}

export function CreatePostSheet({ open, onClose, userId, onCreated }: Props) {
  const { profile } = useApp();
  const toast = useToast();
  const [draft, setDraft] = useState<PostDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentWorkout[]>([]);
  const [linked, setLinked] = useState<string | null>(null);

  // Today's and yesterday's workouts, read from this device only (R1).
  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setError(null);
    setLinked(null);
    const today = todayISO(profile?.timezone ?? DEFAULT_TZ);
    const from = addDays(today, -1);
    let live = true;
    Promise.all([getByDateRange('runs', from, today), getByDateRange('strength', from, today), getByDateRange('hyrox', from, today)])
      .then(([runs, strength, hyrox]) => {
        if (!live) return;
        setRecent(pickRecent([
          ...runs.map((record) => ({ kind: 'run' as const, record })),
          ...strength.map((record) => ({ kind: 'strength' as const, record })),
          ...hyrox.map((record) => ({ kind: 'hyrox' as const, record })),
        ]));
      })
      .catch(() => live && setRecent([]));
    return () => {
      live = false;
    };
  }, [open, profile?.timezone]);

  const attach = (w: RecentWorkout) => {
    setLinked(w.record.id);
    setDraft((d) => workoutToDraft(w, d));
  };

  const submit = async () => {
    if (!draft.activity) return;
    const input = { ...draftToInput(draft), id: crypto.randomUUID(), activity_type: draft.activity };
    setError(null);
    if (isOffline()) {
      await queueCommunityWrite(await getDB(), 'createPost', { userId, input });
      toast('Saved offline. Will sync when you are back online.');
      onClose();
      return;
    }
    setBusy(true);
    const res = await createPost(userId, input);
    setBusy(false);
    if (res.error || !res.data) {
      setError(res.error ?? 'Could not share the post.');
      return;
    }
    onCreated(res.data);
    toast('Post shared');
    onClose();
  };

  const picker = recent.length > 0 && (
    <div className="mb-5">
      <span className="label">Attach a recent workout <span className="ml-1 font-normal text-muted">(optional)</span></span>
      <div className="space-y-2">
        {recent.map((w) => {
          const Icon = ICONS[w.kind];
          const on = linked === w.record.id;
          return (
            <button key={w.record.id} type="button" aria-pressed={on} onClick={() => attach(w)} className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${on ? 'border-foreground/60' : 'border-border hover:border-foreground/30'}`}>
              <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{describeWorkout(w)}</span>
              <span className="shrink-0 text-xs text-muted">{w.record.eventDate === todayISO(profile?.timezone ?? DEFAULT_TZ) ? 'Today' : 'Yesterday'}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">Fills in the fields below. Only what you see there is shared; the workout stays on this device.</p>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="New post">
      <PostForm draft={draft} onChange={setDraft} onSubmit={submit} submitLabel="Post" busyLabel="Posting…" busy={busy} error={error} before={picker} />
    </Sheet>
  );
}
