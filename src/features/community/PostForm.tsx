import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Chip, Field, Segmented } from '../../components/ui';
import { fmtDuration, fmtPace, paceSecPerKm, parseTimeToSec } from '../../lib/calc';
import type { CreatePostInput, Visibility } from '../../lib/communityService';
import { ACTIVITY_TYPES, VISIBILITY, type ActivityType } from './shared';

export interface PostDraft {
  title: string;
  activity: ActivityType | '';
  distance: string; // km, as typed
  duration: string; // "mm:ss" or "h:mm:ss"
  stationDetail: string;
  caption: string;
  isPr: boolean;
  visibility: Visibility;
  photo?: File;
  eventDate?: string;
}

export const emptyDraft = (): PostDraft => ({
  title: '', activity: '', distance: '', duration: '', stationDetail: '', caption: '', isPr: false, visibility: 'private',
});

/** Number of km, or undefined when blank or not a sensible distance. */
const km = (s: string) => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() && Number.isFinite(n) && n > 0 && n <= 1000 ? n : undefined;
};
const seconds = (s: string) => {
  const n = parseTimeToSec(s);
  return n !== undefined && n > 0 && n <= 172800 ? Math.round(n) : undefined;
};

/**
 * The post fields for this draft. Only what is shown in the form goes in: the
 * stats that fit the activity type, nothing else from a linked workout (R1).
 * A field left blank is undefined (R2).
 */
export function draftToInput(d: PostDraft): Omit<CreatePostInput, 'id' | 'activity_type'> {
  const isRun = d.activity === 'Run';
  const detailed = d.activity === 'Strength' || d.activity === 'HYROX';
  const distance = isRun ? km(d.distance) : undefined;
  const duration = isRun ? seconds(d.duration) : undefined;
  return {
    title: d.title,
    event_date: d.eventDate,
    caption: d.caption.trim() || undefined,
    distance_km: distance,
    duration_sec: duration,
    pace_sec_per_km: distance && duration ? paceSecPerKm(distance, duration) : undefined,
    station_detail: detailed ? d.stationDetail.trim() || undefined : undefined,
    is_pr: d.isPr,
    visibility: d.visibility,
    photo: d.photo,
  };
}

interface PostFormProps {
  draft: PostDraft;
  onChange: (draft: PostDraft) => void;
  onSubmit: () => void;
  submitLabel: string;
  busyLabel?: string;
  busy: boolean;
  error: string | null;
  /** Editing: the activity type and photo are fixed. */
  locked?: boolean;
  /** Extra content above the fields (the recent-workout picker). */
  before?: ReactNode;
}

export function PostForm({ draft, onChange, onSubmit, submitLabel, busyLabel = 'Saving…', busy, error, locked = false, before }: PostFormProps) {
  const set = (patch: Partial<PostDraft>) => onChange({ ...draft, ...patch });
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!draft.photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(draft.photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draft.photo]);

  const distance = km(draft.distance);
  const duration = seconds(draft.duration);
  const pace = distance && duration ? paceSecPerKm(distance, duration) : undefined;
  const canSubmit = draft.title.trim().length > 0 && draft.activity !== '' && !busy;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };

  return (
    <form onSubmit={submit} noValidate>
      {before}
      <Field label="Title">
        <input className="field" maxLength={120} required value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Tempo run by the lake" />
      </Field>

      <div className="mb-4">
        <span className="label">Activity</span>
        {locked ? (
          <span className="pill border-border text-foreground/80">{draft.activity}</span>
        ) : (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Activity type">
            {ACTIVITY_TYPES.map((t) => (
              <span key={t} className="shrink-0">
                <Chip active={draft.activity === t} onClick={() => set({ activity: t })}>{t}</Chip>
              </span>
            ))}
          </div>
        )}
      </div>

      {draft.activity === 'Run' && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Distance (km)</span>
            <input className="field" inputMode="decimal" value={draft.distance} onChange={(e) => set({ distance: e.target.value })} placeholder="8.5" />
          </label>
          <label className="block">
            <span className="label">Time</span>
            <input className="field" inputMode="numeric" value={draft.duration} onChange={(e) => set({ duration: e.target.value })} placeholder="45:30" />
          </label>
          <p className="col-span-2 text-xs text-muted" aria-live="polite">
            {pace ? <>Pace {fmtPace(pace)} /km over {fmtDuration(duration)}</> : 'Pace is worked out from distance and time.'}
          </p>
        </div>
      )}
      {(draft.activity === 'Strength' || draft.activity === 'HYROX') && (
        <Field label={draft.activity === 'HYROX' ? 'Stations' : 'Exercises'} optional>
          <textarea className="field min-h-[88px]" maxLength={2000} value={draft.stationDetail} onChange={(e) => set({ stationDetail: e.target.value })} placeholder={draft.activity === 'HYROX' ? 'Sled push 4 × 25 m @ 152 kg' : 'Back squat 5 × 5 @ 100 kg'} />
        </Field>
      )}

      <Field label="Caption" optional>
        <textarea className="field min-h-[88px]" maxLength={2000} value={draft.caption} onChange={(e) => set({ caption: e.target.value })} placeholder="How did it feel?" />
      </Field>

      {!locked && (
        <div className="mb-4">
          <span className="label">Photo <span className="ml-1 font-normal text-muted">(optional)</span></span>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" aria-label="Choose a photo" onChange={(e) => set({ photo: e.target.files?.[0] ?? undefined })} />
          {preview ? (
            <div className="relative w-fit">
              <img src={preview} alt="Selected photo" className="h-28 w-28 rounded-lg border border-border object-cover" />
              <button type="button" className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-card" aria-label="Remove photo" onClick={() => { set({ photo: undefined }); if (fileRef.current) fileRef.current.value = ''; }}>
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          ) : (
            <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" aria-hidden /> Add a photo
            </button>
          )}
          <p className="mt-1 text-xs text-muted">Resized and compressed before it uploads.</p>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Personal record</div>
          <div className="text-xs text-muted">Adds a PR badge to the post.</div>
        </div>
        <button type="button" role="switch" aria-checked={draft.isPr} aria-label="Personal record" onClick={() => set({ isPr: !draft.isPr })} className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${draft.isPr ? 'border-transparent bg-foreground' : 'border-border bg-secondary'}`}>
          <span className={`absolute top-[3px] h-4 w-4 rounded-full transition-all motion-reduce:transition-none ${draft.isPr ? 'left-[22px] bg-background' : 'left-[3px] bg-foreground/70'}`} />
        </button>
      </div>

      <div className="mb-5">
        <span className="label">Who can see it</span>
        <Segmented value={draft.visibility} onChange={(v) => set({ visibility: v })} options={VISIBILITY.map((v) => ({ value: v.value, label: v.label }))} label="Who can see it" />
        <p className="mt-1.5 text-xs text-muted">{VISIBILITY.find((v) => v.value === draft.visibility)?.hint}</p>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-bad/40 px-3 py-2.5 text-sm text-bad">{error}</p>}
      <button type="submit" className="btn-solid w-full" disabled={!canSubmit}>
        {busy ? busyLabel : submitLabel}
      </button>
    </form>
  );
}
