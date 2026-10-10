// ─────────────────────────────────────────────────────────────────────────────
// Forge OS: data model
// Every record keeps a stable identity, the real event date (used for sorting
// and history), creation/update timestamps, and an explicit data source so that
// manually entered data is never confused with imported/device data.
// ─────────────────────────────────────────────────────────────────────────────

export type DataSource = 'manual' | 'imported' | 'device' | 'seed' | 'coach';

/** Base fields present on every persisted record. */
export interface BaseRecord {
  id: string;
  /** ISO datetime (UTC) when the record was created. */
  createdAt: string;
  /** ISO datetime (UTC) of the last edit. */
  updatedAt: string;
  /** Where the data came from. Never guess: default to 'manual'. */
  source: DataSource;
  notes?: string;
}

/** A record anchored to a calendar day (YYYY-MM-DD in the athlete's timezone). */
export interface DatedRecord extends BaseRecord {
  /** The real day the event happened: drives history sorting, not createdAt. */
  eventDate: string; // YYYY-MM-DD
}

// ── Profile ─────────────────────────────────────────────────────────────────

export type GoalKey =
  | 'hyrox'
  | 'running'
  | 'muscle'
  | 'strength'
  | 'fatloss'
  | 'recomp'
  | 'general';

export interface Supplement {
  name: string;
  serving?: string;
  timing?: string;
  active: boolean;
}

export interface LiftBaseline {
  name: string;
  weightKg?: number;
  reps?: number;
}

export interface Profile extends BaseRecord {
  displayName: string;
  dob?: string; // YYYY-MM-DD
  age?: number;
  heightCm?: number;
  weightKg?: number;
  goalWeightKg?: number;
  country: string;
  timezone: string;
  units: {
    distance: 'km' | 'mi';
    weight: 'kg' | 'lb';
    pace: 'min/km' | 'min/mi';
  };
  photo?: string; // data URL, optional
  goals: GoalKey[];
  primaryGoal: GoalKey;
  // Athletic background
  runningExperience?: string;
  weeklyVolumeKm?: number;
  best5kSec?: number;
  best10kSec?: number;
  longestRunKm?: number;
  easyPaceSecPerKm?: number;
  tempoPaceSecPerKm?: number;
  strengthRoutine?: string;
  lifts: LiftBaseline[];
  hyroxExperience?: string;
  raceDivision: string;
  raceDate: string; // YYYY-MM-DD
  trainingStartDate: string; // YYYY-MM-DD
  equipment: string[];
  preferredDays: string[];
  sessionMinutes?: number;
  injuries?: string;
  // Nutrition
  diet: string;
  allergies?: string;
  mealSchedule?: string;
  foodPreferences?: string;
  dislikedFoods?: string;
  typicalCalories?: number;
  typicalProtein?: number;
  cookingAccess?: string;
  budget?: string;
  supplements: Supplement[];
  // Lifestyle
  avgSleepHours?: number;
  bedtime?: string; // HH:MM
  wakeTime?: string; // HH:MM
  workSchedule?: string;
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'high' | 'very_high';
  stepGoal: number;
  typicalSteps?: number;
  waterTargetMl: number;
  typicalWaterMl?: number;
  stressLevel?: number; // 1-5
  recoveryDays?: string[];
  // Targets (editable)
  calorieTarget?: number;
  proteinTarget?: number;
  carbTarget?: number;
  fatTarget?: number;
  // Onboarding completion
  onboarded: boolean;
  // Provenance of prepopulated draft values
  historicalSource?: string;
}

// ── Training ──────────────────────────────────────────────────────────────────

export type SessionType =
  | 'easy_run'
  | 'tempo_run'
  | 'long_run'
  | 'interval_run'
  | 'strength'
  | 'hyrox'
  | 'rest'
  | 'cross';

export type MuscleGroup =
  | 'legs'
  | 'abs'
  | 'chest'
  | 'triceps'
  | 'back'
  | 'biceps'
  | 'delts'
  | 'fullbody'
  | 'core';

/** A prescribed strength exercise inside a planned/actual workout. */
export interface PlannedExercise {
  name: string;
  group: MuscleGroup;
  sets: number;
  reps: string; // "8-10" etc.
  targetWeightKg?: number;
  targetRPE?: number;
  restSec?: number;
  instructions?: string;
}

export interface PlannedRun {
  kind: 'easy' | 'tempo' | 'long' | 'interval';
  distanceKm?: number;
  durationMin?: number;
  targetRPE?: number;
  description?: string;
}

/** HYROX station prescription. */
export interface HyroxStationPlan {
  station: string;
  target: string; // "1000 m" | "100 reps" | "50 m"
  loadKg?: number;
  notes?: string;
}

/** A planned training session on a given day. Separate from actual logs. */
export interface PlannedWorkout extends DatedRecord {
  phase: string;
  weekIndex: number; // 1-based week in the plan
  title: string;
  types: SessionType[];
  focus: string;
  warmup?: string;
  cooldown?: string;
  runs: PlannedRun[];
  exercises: PlannedExercise[];
  hyroxStations: HyroxStationPlan[];
  deload: boolean;
  description?: string;
}

export type PlanStatus = 'planned' | 'completed' | 'partial' | 'missed' | 'rescheduled';

// ── Actual logged activity ────────────────────────────────────────────────────

export interface LoggedSet {
  reps?: number;
  weightKg?: number;
  rpe?: number;
  rir?: number;
  completed: boolean;
}

export interface LoggedExercise {
  name: string;
  group: MuscleGroup;
  sets: LoggedSet[];
}

export interface RunRecord extends DatedRecord {
  kind: 'easy' | 'tempo' | 'long' | 'interval' | 'race' | 'other';
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm?: number; // derived, but stored
  rpe?: number;
  elevationM?: number;
  route?: string;
  linkedPlanId?: string;
}

export interface StrengthRecord extends DatedRecord {
  title: string;
  exercises: LoggedExercise[];
  durationMin?: number;
  rpe?: number;
  linkedPlanId?: string;
}

export interface HyroxStationResult {
  station: string;
  distanceM?: number;
  reps?: number;
  loadKg?: number;
  timeSec?: number;
  breaks?: number;
  rpe?: number;
  notes?: string;
}

export interface HyroxRecord extends DatedRecord {
  title: string;
  mode: 'station' | 'combo' | 'simulation' | 'race';
  stations: HyroxStationResult[];
  runSegments?: { label: string; distanceM: number; timeSec: number }[];
  totalTimeSec?: number;
  rpe?: number;
  linkedPlanId?: string;
}

// ── Health / lifestyle ────────────────────────────────────────────────────────

export interface NutritionEntry extends DatedRecord {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement';
  name: string;
  time?: string; // HH:MM
  servingSize?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  isSupplement?: boolean;
}

export interface WaterEntry extends DatedRecord {
  amountMl: number;
}

export interface SleepRecord extends DatedRecord {
  bedtime: string; // ISO datetime
  wakeTime: string; // ISO datetime
  durationMin: number; // computed, handles midnight crossing
  quality?: number; // 1-5
  restingHr?: number;
  hrv?: number;
}

export interface StepRecord extends DatedRecord {
  steps: number;
  distanceKm?: number;
  activeMinutes?: number;
  dedupeKey?: string; // device sync dedup id
  syncedAt?: string;
}

export interface BodyRecord extends DatedRecord {
  weightKg?: number;
  heightCm?: number;
  waistCm?: number;
  hipsCm?: number;
  chestCm?: number;
  armCm?: number;
  thighCm?: number;
  bodyFatPct?: number; // only if entered/measured, never estimated
  photo?: string; // private data URL
}

export interface RecoveryRecord extends DatedRecord {
  fatigue?: number; // 1-5
  soreness?: number; // 1-5
  motivation?: number; // 1-5
  stress?: number; // 1-5
  pain?: string;
}

// ── Social ────────────────────────────────────────────────────────────────────

export type Visibility = 'private' | 'followers' | 'public';

export interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface SocialPost extends DatedRecord {
  author: string;
  title: string;
  activityType: string;
  caption?: string;
  distanceKm?: number;
  durationSec?: number;
  paceSecPerKm?: number;
  elevationM?: number;
  stationDetail?: string;
  photo?: string;
  visibility: Visibility;
  kudos: number;
  kudosedByMe: boolean;
  comments: Comment[];
  pr?: boolean;
  routeText?: string;
}

// ── Settings / integrations ───────────────────────────────────────────────────

export interface Integration {
  key: string;
  label: string;
  provides: string;
  connected: boolean;
  implemented: boolean;
}

export interface Reminder {
  key: string;
  label: string;
  time?: string; // HH:MM
  enabled: boolean;
}

export interface SavedMeal {
  id: string;
  name: string;
  meal: NutritionEntry['meal'];
  servingSize?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
}

export interface Settings extends BaseRecord {
  reminders: Reminder[];
  quietHours?: { start: string; end: string };
  integrations: Integration[];
  waterServingMl: number;
  theme: 'dark';
  savedMeals?: SavedMeal[];
  /** Opt-in: send a summarized snapshot to the self-hosted coach server. */
  aiCoachEnabled?: boolean;
}

// ── Audit history ─────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  at: string; // ISO datetime of the change
  store: string;
  recordId: string;
  action: 'update' | 'delete';
  eventDate?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
}

// ── Store map ─────────────────────────────────────────────────────────────────

export interface StoreMap {
  profile: Profile;
  plannedWorkouts: PlannedWorkout;
  runs: RunRecord;
  strength: StrengthRecord;
  hyrox: HyroxRecord;
  nutrition: NutritionEntry;
  water: WaterEntry;
  sleep: SleepRecord;
  steps: StepRecord;
  body: BodyRecord;
  recovery: RecoveryRecord;
  social: SocialPost;
  settings: Settings;
  audit: AuditEntry;
}
export type StoreName = keyof StoreMap;
