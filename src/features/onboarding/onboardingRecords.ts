import type { GoalKey, Integration, Profile, Settings, Supplement } from '../../db/types';
import { newRecord } from '../../store/AppContext';
import { ageFromDob, parseTimeToSec } from '../../lib/calc';

// The records onboarding saves, built from what the athlete entered. Kept out
// of the component so the journey can be tested without a browser.

export const INTEGRATIONS: Integration[] = [
  { key: 'apple', label: 'Apple Health', provides: 'Steps, workouts, sleep, heart rate', connected: false, implemented: false },
  { key: 'health_connect', label: 'Health Connect (Android)', provides: 'Steps, workouts, sleep', connected: false, implemented: false },
  { key: 'google_fit', label: 'Google Fit', provides: 'Steps, activity', connected: false, implemented: false },
  { key: 'garmin', label: 'Garmin', provides: 'Runs, HR, sleep, HRV', connected: false, implemented: false },
  { key: 'fitbit', label: 'Fitbit', provides: 'Steps, sleep, HR', connected: false, implemented: false },
  { key: 'strava', label: 'Strava (data source)', provides: 'Activities & routes', connected: false, implemented: false },
];

export interface OnboardingInput {
  draft: Partial<Profile>;
  best5k: string;
  best10k: string;
  easyPace: string;
  tempoPace: string;
  supplements: Supplement[];
  /** Records from an earlier, unfinished run of onboarding keep their ids. */
  savedProfile?: Profile | null;
  savedSettings?: Settings | null;
}

/**
 * Profile and settings from the onboarding answers. The profile is saved with
 * onboarded false: the optional community step that follows sets it, so the
 * app opens after that step (and resumes there if it is closed).
 */
export function buildOnboardingRecords(input: OnboardingInput): { profile: Profile; settings: Settings } {
  const draft = input.draft;
  const profile = newRecord<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>({
    source: 'manual',
    displayName: draft.displayName || 'Athlete',
    dob: draft.dob,
    age: draft.age ?? (draft.dob ? ageFromDob(draft.dob) : undefined),
    heightCm: draft.heightCm,
    weightKg: draft.weightKg,
    goalWeightKg: draft.goalWeightKg,
    country: draft.country || 'India',
    timezone: draft.timezone || 'Asia/Kolkata',
    units: draft.units ?? { distance: 'km', weight: 'kg', pace: 'min/km' },
    photo: draft.photo,
    goals: draft.goals ?? ['hyrox'],
    primaryGoal: (draft.primaryGoal as GoalKey) ?? 'hyrox',
    runningExperience: draft.runningExperience,
    weeklyVolumeKm: draft.weeklyVolumeKm,
    best5kSec: parseTimeToSec(input.best5k),
    best10kSec: parseTimeToSec(input.best10k),
    longestRunKm: draft.longestRunKm,
    easyPaceSecPerKm: parseTimeToSec(input.easyPace),
    tempoPaceSecPerKm: parseTimeToSec(input.tempoPace),
    strengthRoutine: draft.strengthRoutine,
    lifts: draft.lifts ?? [],
    hyroxExperience: draft.hyroxExperience,
    raceDivision: draft.raceDivision || 'Men Open',
    raceDate: draft.raceDate || '2027-01-24',
    trainingStartDate: draft.trainingStartDate || '2026-10-12',
    equipment: draft.equipment ?? [],
    preferredDays: draft.preferredDays ?? [],
    sessionMinutes: draft.sessionMinutes,
    injuries: draft.injuries,
    diet: draft.diet || 'vegetarian',
    allergies: draft.allergies,
    mealSchedule: draft.mealSchedule,
    foodPreferences: draft.foodPreferences,
    dislikedFoods: draft.dislikedFoods,
    typicalCalories: draft.typicalCalories,
    typicalProtein: draft.typicalProtein,
    cookingAccess: draft.cookingAccess,
    budget: draft.budget,
    supplements: input.supplements,
    avgSleepHours: draft.avgSleepHours,
    bedtime: draft.bedtime,
    wakeTime: draft.wakeTime,
    workSchedule: draft.workSchedule,
    activityLevel: draft.activityLevel ?? 'high',
    stepGoal: draft.stepGoal ?? 8000,
    typicalSteps: draft.typicalSteps,
    waterTargetMl: draft.waterTargetMl ?? 3000,
    typicalWaterMl: draft.typicalWaterMl,
    stressLevel: draft.stressLevel,
    recoveryDays: draft.recoveryDays,
    // Set by the optional community step that follows, so the app opens after it.
    onboarded: false,
    historicalSource: draft.historicalSource,
  }) as Profile;
  if (input.savedProfile) Object.assign(profile, { id: input.savedProfile.id, createdAt: input.savedProfile.createdAt });

  const settings = newRecord<Omit<Settings, 'id' | 'createdAt' | 'updatedAt'>>({
    source: 'manual',
    theme: 'dark',
    waterServingMl: 250,
    reminders: [
      { key: 'workout', label: 'Workout start', enabled: false },
      { key: 'bedtime', label: 'Bedtime routine', enabled: false },
      { key: 'water', label: 'Water intake', enabled: false },
      { key: 'meal', label: 'Meal logging', enabled: false },
      { key: 'weigh', label: 'Morning weigh-in', enabled: false },
      { key: 'review', label: 'Weekly review', enabled: false },
    ],
    integrations: INTEGRATIONS,
  }) as Settings;
  if (input.savedSettings) Object.assign(settings, { id: input.savedSettings.id, createdAt: input.savedSettings.createdAt });
  return { profile, settings };
}
