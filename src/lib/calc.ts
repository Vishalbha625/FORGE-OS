import type { Profile, RunRecord } from '../db/types';

// ── Pace & time ────────────────────────────────────────────────────────────

/** Average pace in sec/km. 5 km in 1800s → 360 s/km = 6:00 min/km. */
export function paceSecPerKm(distanceKm: number, durationSec: number): number | undefined {
  if (!distanceKm || distanceKm <= 0 || !durationSec || durationSec <= 0) return undefined;
  return Math.round(durationSec / distanceKm);
}

/** Format sec/km as "m:ss". */
export function fmtPace(secPerKm?: number): string {
  if (secPerKm === undefined || !isFinite(secPerKm) || secPerKm <= 0) return '–';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format seconds as "h:mm:ss" or "m:ss". */
export function fmtDuration(totalSec?: number): string {
  if (totalSec === undefined || totalSec < 0) return '–';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function fmtHrsMins(totalMin?: number): string {
  if (totalMin === undefined || totalMin < 0) return '–';
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m.toString().padStart(2, '0')}m`;
}

/** Parse "mm:ss" or "h:mm:ss" into seconds. Returns undefined if blank/bad. */
export function parseTimeToSec(input: string): number | undefined {
  const s = input.trim();
  if (!s) return undefined;
  const parts = s.split(':').map((p) => Number(p));
  if (parts.some((n) => isNaN(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 1) return parts[0] * 60; // treat bare number as minutes
  return undefined;
}

// ── Aggregations ───────────────────────────────────────────────────────────

export function weeklyKm(runs: RunRecord[]): number {
  return round1(runs.reduce((sum, r) => sum + (r.distanceKm || 0), 0));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round0(n: number): number {
  return Math.round(n);
}

export function mean(nums: number[]): number | undefined {
  const valid = nums.filter((n) => typeof n === 'number' && isFinite(n));
  if (!valid.length) return undefined;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

// ── Nutrition target estimation ──────────────────────────────────────────────
// Transparent, rule-based estimate. Only computed when enough data exists.
// Uses Mifflin–St Jeor for BMR, activity multiplier for TDEE.

export interface NutritionEstimate {
  canEstimate: boolean;
  bmr?: number;
  tdee?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  rationale: string[];
  missing: string[];
}

const ACTIVITY_FACTOR: Record<string, number> = {
  sedentary: 1.3,
  light: 1.45,
  moderate: 1.6,
  high: 1.75,
  very_high: 1.9,
};

export function estimateNutrition(p: Profile): NutritionEstimate {
  const missing: string[] = [];
  if (!p.weightKg) missing.push('current body weight');
  if (!p.heightCm) missing.push('height');
  if (!p.age && !p.dob) missing.push('age');
  const activity = p.activityLevel ?? 'moderate';

  if (missing.length) {
    return {
      canEstimate: false,
      rationale: [],
      missing,
    };
  }

  const age = p.age ?? ageFromDob(p.dob!) ?? 25;
  const weight = p.weightKg!;
  const height = p.heightCm!;
  // Male formula (profile goal/division is Men Open). Users can override targets.
  const bmr = Math.round(10 * weight + 6.25 * height - 5 * age + 5);
  const factor = ACTIVITY_FACTOR[activity] ?? 1.6;
  const tdee = Math.round(bmr * factor);

  // Goal-based adjustment: avoid aggressive restriction during endurance training.
  let calories = tdee;
  const rationale: string[] = [
    `BMR ≈ ${bmr} kcal (Mifflin–St Jeor).`,
    `TDEE ≈ ${tdee} kcal using a ${activity.replace('_', ' ')} activity factor (${factor}).`,
  ];
  if (p.primaryGoal === 'fatloss') {
    calories = Math.round(tdee * 0.88); // mild deficit only
    rationale.push('Mild 12% deficit for fat loss, kept small to protect endurance work.');
  } else if (p.primaryGoal === 'muscle') {
    calories = Math.round(tdee * 1.08);
    rationale.push('Slight 8% surplus to support muscle growth.');
  } else {
    rationale.push('Maintenance calories to fuel HYROX + running and support recomposition.');
  }

  // Protein 1.8 g/kg (endurance + muscle). Fat 0.9 g/kg. Carbs fill remainder.
  const protein = Math.round(weight * 1.8);
  const fat = Math.round(weight * 0.9);
  const carbCals = calories - protein * 4 - fat * 9;
  const carbs = Math.max(0, Math.round(carbCals / 4));
  rationale.push(`Protein ${protein} g (1.8 g/kg), fat ${fat} g (0.9 g/kg), carbs ${carbs} g fill the rest.`);
  rationale.push('These are estimates, not measurements. Edit any target to suit you.');

  return { canEstimate: true, bmr, tdee, calories, protein, carbs, fat, rationale, missing: [] };
}

export function ageFromDob(dob: string): number | undefined {
  if (!dob) return undefined;
  const [y, m, d] = dob.split('-').map(Number);
  if (!y) return undefined;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

// ── Unit helpers ──────────────────────────────────────────────────────────────

export function cmToFtIn(cm?: number): string {
  if (!cm) return '–';
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn % 12);
  return `${ft}′${inch}″`;
}

export function ftInToCm(ft: number, inch: number): number {
  return round1((ft * 12 + inch) * 2.54);
}
