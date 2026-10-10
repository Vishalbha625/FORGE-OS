import type { RunRecord, NutritionEntry, StrengthRecord } from '../db/types';

// Duplicate detection: flags likely double entries so the user can confirm.
// Never blocks or silently drops — the athlete decides.

/** A run on the same day with the same distance (±0.05 km) and time (±5 s). */
export function findDuplicateRun(
  runs: RunRecord[],
  cand: { id?: string; eventDate: string; distanceKm: number; durationSec: number },
): RunRecord | undefined {
  return runs.find(
    (r) =>
      r.id !== cand.id &&
      r.eventDate === cand.eventDate &&
      Math.abs(r.distanceKm - cand.distanceKm) <= 0.05 &&
      Math.abs(r.durationSec - cand.durationSec) <= 5,
  );
}

/** Same food, same meal slot, same day. */
export function findDuplicateMeal(
  entries: NutritionEntry[],
  cand: { id?: string; eventDate: string; meal: string; name: string },
): NutritionEntry | undefined {
  const name = cand.name.trim().toLowerCase();
  return entries.find(
    (e) =>
      e.id !== cand.id &&
      !e.isSupplement &&
      e.eventDate === cand.eventDate &&
      e.meal === cand.meal &&
      e.name.trim().toLowerCase() === name,
  );
}

/** Strength session on the same day with the same title. */
export function findDuplicateStrength(
  sessions: StrengthRecord[],
  cand: { id?: string; eventDate: string; title: string },
): StrengthRecord | undefined {
  const t = cand.title.trim().toLowerCase();
  return sessions.find((s) => s.id !== cand.id && s.eventDate === cand.eventDate && s.title.trim().toLowerCase() === t);
}
