import type { HyroxRecord, RunRecord, StrengthRecord } from '../../db/types';
import { fmtDuration } from '../../lib/calc';
import type { PostDraft } from './PostForm';

// Turns a workout logged on this device into visible post fields. The athlete
// sees and can edit every value before posting; nothing else from the record
// (its id, notes, RPE, heart rate) is copied, and the record stays on the device (R1).

export type RecentWorkout =
  | { kind: 'run'; record: RunRecord }
  | { kind: 'strength'; record: StrengthRecord }
  | { kind: 'hyrox'; record: HyroxRecord };

const RUN_LABEL: Record<RunRecord['kind'], string> = {
  easy: 'Easy run', tempo: 'Tempo run', long: 'Long run', interval: 'Intervals', race: 'Race', other: 'Run',
};

/** Newest first by event date, then by when it was logged. */
export function pickRecent(workouts: RecentWorkout[], limit = 3): RecentWorkout[] {
  return [...workouts]
    .sort((a, b) => b.record.eventDate.localeCompare(a.record.eventDate) || b.record.createdAt.localeCompare(a.record.createdAt))
    .slice(0, limit);
}

export function describeWorkout(w: RecentWorkout): string {
  if (w.kind === 'run') return `${RUN_LABEL[w.record.kind]}, ${Number(w.record.distanceKm.toFixed(2))} km`;
  if (w.kind === 'strength') {
    const n = w.record.exercises.length;
    return `${w.record.title}, ${n} exercise${n === 1 ? '' : 's'}`;
  }
  return `${w.record.title}, ${w.record.stations.length} station${w.record.stations.length === 1 ? '' : 's'}`;
}

function strengthLines(r: StrengthRecord): string {
  return r.exercises
    .map((ex) => {
      const done = ex.sets.filter((s) => s.completed);
      if (done.length === 0) return '';
      const top = done.reduce<(typeof done)[number] | undefined>((best, s) => (s.weightKg !== undefined && (best?.weightKg === undefined || s.weightKg > best.weightKg) ? s : best), undefined);
      const reps = top?.reps ?? done[0].reps;
      const detail = top?.weightKg !== undefined ? `, top ${top.weightKg} kg${reps !== undefined ? ` × ${reps}` : ''}` : reps !== undefined ? ` × ${reps}` : '';
      return `${ex.name}: ${done.length} set${done.length === 1 ? '' : 's'}${detail}`;
    })
    .filter(Boolean)
    .join('\n');
}

function hyroxLines(r: HyroxRecord): string {
  const lines = r.stations.map((s) => {
    const parts = [
      s.distanceM !== undefined ? `${s.distanceM} m` : '',
      s.reps !== undefined ? `${s.reps} reps` : '',
      s.loadKg !== undefined ? `@ ${s.loadKg} kg` : '',
      s.timeSec !== undefined ? `in ${fmtDuration(s.timeSec)}` : '',
    ].filter(Boolean);
    return `${s.station}${parts.length ? `: ${parts.join(' ')}` : ''}`;
  });
  if (r.totalTimeSec !== undefined) lines.unshift(`Total ${fmtDuration(r.totalTimeSec)}`);
  return lines.join('\n');
}

/** Form fields filled from a workout. The title is only set if the athlete hasn't typed one. */
export function workoutToDraft(w: RecentWorkout, current: PostDraft): PostDraft {
  const base = { ...current, eventDate: w.record.eventDate };
  if (w.kind === 'run') {
    const r = w.record;
    return {
      ...base,
      activity: 'Run',
      title: current.title || RUN_LABEL[r.kind],
      distance: String(Number(r.distanceKm.toFixed(2))),
      duration: r.durationSec > 0 ? fmtDuration(r.durationSec) : '',
    };
  }
  if (w.kind === 'strength') {
    return { ...base, activity: 'Strength', title: current.title || w.record.title, stationDetail: strengthLines(w.record) };
  }
  return { ...base, activity: 'HYROX', title: current.title || w.record.title, stationDetail: hyroxLines(w.record) };
}

