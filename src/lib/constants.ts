import type { HyroxStationPlan, MuscleGroup } from '../db/types';

// HYROX Men Open station standards: CONFIGURABLE and flagged for confirmation.
// Loads vary by event/division; always confirm against official rules for your race.
export const HYROX_STATIONS: HyroxStationPlan[] = [
  { station: 'SkiErg', target: '1000 m', notes: 'Full-body pull. Confirm distance for your division.' },
  { station: 'Sled Push', target: '50 m', loadKg: 152, notes: 'Men Open sled plus load ≈ 152 kg. Confirm for your event.' },
  { station: 'Sled Pull', target: '50 m', loadKg: 103, notes: 'Men Open sled plus load ≈ 103 kg. Confirm for your event.' },
  { station: 'Burpee Broad Jumps', target: '80 m', notes: 'Chest to floor, jump forward.' },
  { station: 'Row', target: '1000 m', notes: 'Confirm distance for your division.' },
  { station: "Farmer's Carry", target: '200 m', loadKg: 24, notes: 'Men Open ≈ 2×24 kg. Confirm for your event.' },
  { station: 'Sandbag Lunges', target: '100 m', loadKg: 20, notes: 'Men Open ≈ 20 kg. Confirm for your event.' },
  { station: 'Wall Balls', target: '100 reps', loadKg: 6, notes: 'Men Open 6 kg to a 3 m target. Confirm for your event.' },
];

// Strength exercise library by muscle group (names + brief cues).
// No fixed kilogram loads are prescribed: progression is driven by logged data + RPE.
export const EXERCISE_LIBRARY: Record<MuscleGroup, { name: string; sets: number; reps: string; cue: string }[]> = {
  legs: [
    { name: 'Back Squat', sets: 4, reps: '5-8', cue: 'Brace, controlled descent, drive through mid-foot.' },
    { name: 'Romanian Deadlift', sets: 3, reps: '8-10', cue: 'Hinge, soft knees, feel hamstrings.' },
    { name: 'Walking Lunge', sets: 3, reps: '10/leg', cue: 'Long stride, tall torso. Carries over to HYROX lunges.' },
    { name: 'Leg Press / Split Squat', sets: 3, reps: '10-12', cue: 'Full range, no bouncing.' },
    { name: 'Standing Calf Raise', sets: 3, reps: '12-15', cue: 'Pause at top.' },
  ],
  abs: [
    { name: 'Hanging Leg Raise', sets: 3, reps: '10-12', cue: 'No swing, control the lower.' },
    { name: 'Cable / Weighted Crunch', sets: 3, reps: '12-15', cue: 'Flex the spine, not the hips.' },
    { name: 'Plank', sets: 3, reps: '45-60s', cue: 'Glutes + abs tight, neutral spine.' },
  ],
  chest: [
    { name: 'Barbell / DB Bench Press', sets: 4, reps: '6-10', cue: 'Shoulder blades back, controlled touch.' },
    { name: 'Incline DB Press', sets: 3, reps: '8-12', cue: 'Upper-chest focus.' },
    { name: 'Cable Fly / Dip', sets: 3, reps: '10-12', cue: 'Stretch and squeeze.' },
  ],
  triceps: [
    { name: 'Triceps Pushdown', sets: 3, reps: '10-12', cue: 'Elbows pinned.' },
    { name: 'Overhead Extension', sets: 3, reps: '10-12', cue: 'Full stretch overhead.' },
  ],
  back: [
    { name: 'Pull-up / Lat Pulldown', sets: 4, reps: '6-10', cue: 'Drive elbows down, full stretch.' },
    { name: 'Barbell / Cable Row', sets: 3, reps: '8-10', cue: 'Squeeze shoulder blades.' },
    { name: 'Face Pull', sets: 3, reps: '12-15', cue: 'Rear delts + posture.' },
  ],
  biceps: [
    { name: 'Barbell / DB Curl', sets: 3, reps: '8-12', cue: 'No swing.' },
    { name: 'Hammer Curl', sets: 3, reps: '10-12', cue: 'Brachialis + forearm.' },
  ],
  delts: [
    { name: 'Overhead Press', sets: 4, reps: '6-10', cue: 'Brace, press in a straight line.' },
    { name: 'Lateral Raise', sets: 3, reps: '12-15', cue: 'Lead with elbows.' },
    { name: 'Rear Delt Fly', sets: 3, reps: '12-15', cue: 'Control, no momentum.' },
  ],
  fullbody: [
    { name: 'Deadlift', sets: 3, reps: '3-5', cue: 'Neutral spine, full lockout.' },
    { name: 'Clean & Press', sets: 3, reps: '5', cue: 'Explosive, athletic.' },
  ],
  core: [
    { name: 'Pallof Press', sets: 3, reps: '10/side', cue: 'Anti-rotation.' },
    { name: 'Ab Wheel', sets: 3, reps: '8-10', cue: 'Keep hips tucked.' },
  ],
};

export const DEFAULT_SUPPLEMENTS = [
  { name: 'Creatine Monohydrate', serving: '5 g', timing: 'Daily', active: true },
  { name: 'Mass Gainer', serving: '1 scoop', timing: 'Post-workout', active: true },
  { name: 'BCAA', serving: '1 scoop', timing: 'Intra-workout', active: true },
  { name: 'Pre-workout', serving: '1 scoop', timing: 'Before training', active: true },
];

export const GOAL_LABELS: Record<string, string> = {
  hyrox: 'HYROX performance',
  running: 'Running endurance & speed',
  muscle: 'Muscle growth',
  strength: 'Strength',
  fatloss: 'Fat loss',
  recomp: 'Body recomposition',
  general: 'General fitness',
};

// Small built-in vegetarian-friendly food reference (user-editable, clearly labelled).
// Values are approximate per serving; the app never fabricates precise values beyond these.
export interface FoodRef {
  name: string;
  serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  veg: boolean;
}
export const FOOD_DB: FoodRef[] = [
  { name: 'Paneer (100 g)', serving: '100 g', calories: 265, protein: 18, carbs: 3, fat: 21, veg: true },
  { name: 'Tofu (100 g)', serving: '100 g', calories: 76, protein: 8, carbs: 2, fat: 5, veg: true },
  { name: 'Greek Yogurt (170 g)', serving: '170 g', calories: 100, protein: 17, carbs: 6, fat: 0, veg: true },
  { name: 'Whey Protein (1 scoop)', serving: '30 g', calories: 120, protein: 24, carbs: 3, fat: 2, veg: true },
  { name: 'Lentils / Dal (1 cup cooked)', serving: '198 g', calories: 230, protein: 18, carbs: 40, fat: 1, fiber: 16, veg: true },
  { name: 'Chickpeas (1 cup cooked)', serving: '164 g', calories: 269, protein: 15, carbs: 45, fat: 4, fiber: 13, veg: true },
  { name: 'Rajma (1 cup cooked)', serving: '177 g', calories: 225, protein: 15, carbs: 40, fat: 1, fiber: 13, veg: true },
  { name: 'Rice, cooked (1 cup)', serving: '158 g', calories: 205, protein: 4, carbs: 45, fat: 0, veg: true },
  { name: 'Roti / Chapati', serving: '1 piece', calories: 120, protein: 3, carbs: 18, fat: 3, fiber: 3, veg: true },
  { name: 'Oats (40 g dry)', serving: '40 g', calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, veg: true },
  { name: 'Banana', serving: '1 medium', calories: 105, protein: 1, carbs: 27, fat: 0, fiber: 3, veg: true },
  { name: 'Peanut Butter (2 tbsp)', serving: '32 g', calories: 190, protein: 8, carbs: 6, fat: 16, fiber: 2, veg: true },
  { name: 'Almonds (28 g)', serving: '28 g', calories: 164, protein: 6, carbs: 6, fat: 14, fiber: 3, veg: true },
  { name: 'Eggs (2 large)', serving: '2', calories: 156, protein: 13, carbs: 1, fat: 11, veg: true },
  { name: 'Milk, full (250 ml)', serving: '250 ml', calories: 150, protein: 8, carbs: 12, fat: 8, veg: true },
  { name: 'Soya Chunks (50 g dry)', serving: '50 g', calories: 172, protein: 26, carbs: 17, fat: 0.5, fiber: 6, veg: true },
  { name: 'Mixed Vegetables (1 cup)', serving: '1 cup', calories: 80, protein: 4, carbs: 16, fat: 0, fiber: 6, veg: true },
  { name: 'Sweet Potato (1 medium)', serving: '130 g', calories: 112, protein: 2, carbs: 26, fat: 0, fiber: 4, veg: true },
];
