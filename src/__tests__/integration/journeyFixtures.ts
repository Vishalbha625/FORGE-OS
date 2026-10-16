import type { Profile, RunRecord, StrengthRecord, NutritionEntry } from '../../db/types';
import { putRecord, wipeAll } from '../../db/database';
import { newRecord } from '../../store/AppContext';
import { rebuildPlan } from '../../store/appData';
import { buildOnboardingRecords } from '../../features/onboarding/onboardingRecords';
import { paceSecPerKm } from '../../lib/calc';
import { addDays, todayISO } from '../../lib/dates';

export const VISHAL = '11111111-1111-4111-8111-111111111111';
export const RIYA = '22222222-2222-4222-8222-222222222222';
export const ARJUN = '33333333-3333-4333-8333-333333333333';

export const today = () => todayISO('Asia/Kolkata');

/** Waits for promises the code under test started without awaiting. */
export const settle = () => new Promise((r) => setTimeout(r, 0));

/**
 * Walks onboarding the way the screens do: the answers become a profile and
 * settings (steps 1 to 7), the plan is generated, and the optional community
 * step (8) marks onboarding complete.
 */
export async function onboard(draft: Partial<Profile> = {}): Promise<Profile> {
  const { profile, settings } = buildOnboardingRecords({
    draft: { displayName: 'Vishal Bhardwaj', goals: ['hyrox', 'running'], primaryGoal: 'hyrox', weightKg: 72, heightCm: 178, age: 23, ...draft },
    best5k: '24:30',
    best10k: '',
    easyPace: '6:10',
    tempoPace: '',
    supplements: [],
  });
  await putRecord('profile', profile);
  await putRecord('settings', settings);
  await rebuildPlan(profile.trainingStartDate, profile.raceDate);
  const done = { ...profile, onboarded: true };
  await putRecord('profile', done);
  return done;
}

export const freshDevice = () => wipeAll();

/** A run as the quick log saves it. */
export async function logRun(fields: Partial<RunRecord> = {}): Promise<RunRecord> {
  const distanceKm = fields.distanceKm ?? 8;
  const durationSec = fields.durationSec ?? 2640;
  const run = newRecord<Omit<RunRecord, 'id' | 'createdAt' | 'updatedAt'>>({
    source: 'manual',
    eventDate: today(),
    kind: 'easy',
    distanceKm,
    durationSec,
    avgPaceSecPerKm: paceSecPerKm(distanceKm, durationSec),
    ...fields,
  });
  await putRecord('runs', run);
  return run;
}

export async function logStrength(): Promise<StrengthRecord> {
  const rec = newRecord<Omit<StrengthRecord, 'id' | 'createdAt' | 'updatedAt'>>({
    source: 'manual',
    eventDate: today(),
    title: 'Lower body',
    exercises: [
      { name: 'Back squat', group: 'legs', sets: [1, 2, 3, 4].map(() => ({ reps: 5, weightKg: 90, completed: true })) },
      { name: 'Plank', group: 'core', sets: [{ completed: true }, { completed: true }, { completed: false }] },
    ],
  });
  await putRecord('strength', rec);
  return rec;
}

export async function logMeal(fields: Partial<NutritionEntry>): Promise<NutritionEntry> {
  const rec = newRecord<Omit<NutritionEntry, 'id' | 'createdAt' | 'updatedAt'>>({ source: 'manual', eventDate: today(), meal: 'lunch', name: 'Meal', ...fields });
  await putRecord('nutrition', rec);
  return rec;
}

/** A plan that starts two weeks from now, so today has nothing planned. */
export const laterPlan = () => ({ trainingStartDate: addDays(today(), 14), raceDate: addDays(today(), 120) });
