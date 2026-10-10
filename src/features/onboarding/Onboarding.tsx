import { useMemo, useState } from 'react';
import { useApp, newRecord } from '../../store/AppContext';
import { buildDefaultProfileDraft } from '../../lib/plan';
import { DEFAULT_SUPPLEMENTS, GOAL_LABELS } from '../../lib/constants';
import { Field, Chip, InfoNote, Bar } from '../../components/ui';
import { cmToFtIn, ftInToCm, ageFromDob, fmtPace, parseTimeToSec } from '../../lib/calc';
import { fmtDate } from '../../lib/dates';
import type { Profile, GoalKey, Supplement, Settings, Integration } from '../../db/types';

const STEPS = ['Welcome', 'Basics', 'Goals', 'Training', 'Nutrition', 'Lifestyle', 'Devices', 'Confirm'];

const INTEGRATIONS: Integration[] = [
  { key: 'apple', label: 'Apple Health', provides: 'Steps, workouts, sleep, heart rate', connected: false, implemented: false },
  { key: 'health_connect', label: 'Health Connect (Android)', provides: 'Steps, workouts, sleep', connected: false, implemented: false },
  { key: 'google_fit', label: 'Google Fit', provides: 'Steps, activity', connected: false, implemented: false },
  { key: 'garmin', label: 'Garmin', provides: 'Runs, HR, sleep, HRV', connected: false, implemented: false },
  { key: 'fitbit', label: 'Fitbit', provides: 'Steps, sleep, HR', connected: false, implemented: false },
  { key: 'strava', label: 'Strava (data source)', provides: 'Activities & routes', connected: false, implemented: false },
];

const num = (v: string): number | undefined => (v.trim() === '' ? undefined : isNaN(Number(v)) ? undefined : Number(v));

export function Onboarding() {
  const { saveProfile, saveSettings, regeneratePlan } = useApp();
  const [step, setStep] = useState(0);
  const draft = useMemo(() => buildDefaultProfileDraft(), []);
  const [p, setP] = useState<Partial<Profile>>(draft);
  const [ftIn, setFtIn] = useState({ ft: 5, in: 11 });
  const [best5k, setBest5k] = useState('');
  const [best10k, setBest10k] = useState('');
  const [easyPace, setEasyPace] = useState('');
  const [tempoPace, setTempoPace] = useState('');
  const [supps, setSupps] = useState<Supplement[]>([]);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Profile>) => setP((prev) => ({ ...prev, ...patch }));
  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const toggleGoal = (g: GoalKey) => {
    const goals = p.goals ?? [];
    const has = goals.includes(g);
    const nextGoals = has ? goals.filter((x) => x !== g) : [...goals, g];
    set({ goals: nextGoals, primaryGoal: nextGoals.includes(p.primaryGoal as GoalKey) ? p.primaryGoal : nextGoals[0] });
  };

  const finish = async () => {
    setSaving(true);
    const profile = newRecord<Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>>({
      source: 'manual',
      displayName: p.displayName || 'Athlete',
      dob: p.dob,
      age: p.age ?? (p.dob ? ageFromDob(p.dob) : undefined),
      heightCm: p.heightCm,
      weightKg: p.weightKg,
      goalWeightKg: p.goalWeightKg,
      country: p.country || 'India',
      timezone: p.timezone || 'Asia/Kolkata',
      units: p.units ?? { distance: 'km', weight: 'kg', pace: 'min/km' },
      photo: p.photo,
      goals: p.goals ?? ['hyrox'],
      primaryGoal: (p.primaryGoal as GoalKey) ?? 'hyrox',
      runningExperience: p.runningExperience,
      weeklyVolumeKm: p.weeklyVolumeKm,
      best5kSec: parseTimeToSec(best5k),
      best10kSec: parseTimeToSec(best10k),
      longestRunKm: p.longestRunKm,
      easyPaceSecPerKm: parseTimeToSec(easyPace),
      tempoPaceSecPerKm: parseTimeToSec(tempoPace),
      strengthRoutine: p.strengthRoutine,
      lifts: p.lifts ?? [],
      hyroxExperience: p.hyroxExperience,
      raceDivision: p.raceDivision || 'Men Open',
      raceDate: p.raceDate || '2027-01-24',
      trainingStartDate: p.trainingStartDate || '2026-10-12',
      equipment: p.equipment ?? [],
      preferredDays: p.preferredDays ?? [],
      sessionMinutes: p.sessionMinutes,
      injuries: p.injuries,
      diet: p.diet || 'vegetarian',
      allergies: p.allergies,
      mealSchedule: p.mealSchedule,
      foodPreferences: p.foodPreferences,
      dislikedFoods: p.dislikedFoods,
      typicalCalories: p.typicalCalories,
      typicalProtein: p.typicalProtein,
      cookingAccess: p.cookingAccess,
      budget: p.budget,
      supplements: supps,
      avgSleepHours: p.avgSleepHours,
      bedtime: p.bedtime,
      wakeTime: p.wakeTime,
      workSchedule: p.workSchedule,
      activityLevel: p.activityLevel ?? 'high',
      stepGoal: p.stepGoal ?? 8000,
      typicalSteps: p.typicalSteps,
      waterTargetMl: p.waterTargetMl ?? 3000,
      typicalWaterMl: p.typicalWaterMl,
      stressLevel: p.stressLevel,
      recoveryDays: p.recoveryDays,
      onboarded: true,
      historicalSource: p.historicalSource,
    }) as Profile;

    await saveProfile(profile);

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
    await saveSettings(settings);

    await regeneratePlan(profile.trainingStartDate, profile.raceDate);
  };

  return (
    <div className="min-h-full max-w-md mx-auto px-4 pt-safe pb-10 flex flex-col">
      {step > 0 && (
        <div className="py-4">
          <div className="flex items-center justify-between mb-2 text-xs text-muted">
            <span>Step {step} of {STEPS.length - 1}</span>
            <span>{STEPS[step]}</span>
          </div>
          <Bar pct={(step / (STEPS.length - 1)) * 100} />
        </div>
      )}

      <div className="flex-1 animate-rise">
        {step === 0 && <Welcome onStart={next} />}
        {step === 1 && (
          <StepWrap title="Basic profile" desc="Confirm or update these. Draft values come from your previously reported info — not verified current measurements.">
            <Field label="Display name"><input className="field" value={p.displayName ?? ''} onChange={(e) => set({ displayName: e.target.value })} placeholder="Your name" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Age"><input className="field" inputMode="numeric" value={p.age ?? ''} onChange={(e) => set({ age: num(e.target.value) })} /></Field>
              <Field label="Date of birth" optional><input type="date" className="field" value={p.dob ?? ''} onChange={(e) => set({ dob: e.target.value, age: ageFromDob(e.target.value) })} /></Field>
            </div>
            <Field label="Height" hint={`≈ ${cmToFtIn(p.heightCm)} / ${p.heightCm ?? '—'} cm`}>
              <div className="flex gap-2 items-center">
                <input className="field" inputMode="numeric" value={ftIn.ft} onChange={(e) => { const ft = Number(e.target.value) || 0; setFtIn((s) => ({ ...s, ft })); set({ heightCm: ftInToCm(ft, ftIn.in) }); }} /> <span className="text-muted">ft</span>
                <input className="field" inputMode="numeric" value={ftIn.in} onChange={(e) => { const inch = Number(e.target.value) || 0; setFtIn((s) => ({ ...s, in: inch })); set({ heightCm: ftInToCm(ftIn.ft, inch) }); }} /> <span className="text-muted">in</span>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Current weight (kg)"><input className="field" inputMode="decimal" value={p.weightKg ?? ''} onChange={(e) => set({ weightKg: num(e.target.value) })} /></Field>
              <Field label="Goal weight (kg)" optional><input className="field" inputMode="decimal" value={p.goalWeightKg ?? ''} onChange={(e) => set({ goalWeightKg: num(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country"><input className="field" value={p.country ?? ''} onChange={(e) => set({ country: e.target.value })} /></Field>
              <Field label="Timezone"><input className="field" value={p.timezone ?? ''} onChange={(e) => set({ timezone: e.target.value })} /></Field>
            </div>
            <InfoNote>Units are set to km, metres, kg, min/km, hours & minutes — your preference. Change later in Profile.</InfoNote>
          </StepWrap>
        )}
        {step === 2 && (
          <StepWrap title="Athletic goals" desc="Pick all that apply, then tap your primary goal (★).">
            <div className="flex flex-wrap gap-2 mb-4">
              {(Object.keys(GOAL_LABELS) as GoalKey[]).map((g) => (
                <Chip key={g} active={(p.goals ?? []).includes(g)} onClick={() => toggleGoal(g)}>{GOAL_LABELS[g]}</Chip>
              ))}
            </div>
            {(p.goals ?? []).length > 0 && (
              <Field label="Primary goal">
                <div className="flex flex-wrap gap-2">
                  {(p.goals ?? []).map((g) => (
                    <Chip key={g} active={p.primaryGoal === g} onClick={() => set({ primaryGoal: g })}>{p.primaryGoal === g ? '★ ' : ''}{GOAL_LABELS[g]}</Chip>
                  ))}
                </div>
              </Field>
            )}
          </StepWrap>
        )}
        {step === 3 && (
          <StepWrap title="Training background" desc="All optional — share what you know. Precise pace targets need a recent 5k/10k time.">
            <Field label="Running experience" optional><input className="field" value={p.runningExperience ?? ''} onChange={(e) => set({ runningExperience: e.target.value })} placeholder="e.g. 2 years consistent" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Weekly volume (km)"><input className="field" inputMode="decimal" value={p.weeklyVolumeKm ?? ''} onChange={(e) => set({ weeklyVolumeKm: num(e.target.value) })} /></Field>
              <Field label="Longest run (km)" optional><input className="field" inputMode="decimal" value={p.longestRunKm ?? ''} onChange={(e) => set({ longestRunKm: num(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Recent 5k (mm:ss)" optional hint={best5k && parseTimeToSec(best5k) ? `${fmtPace(Math.round(parseTimeToSec(best5k)! / 5))} /km` : undefined}><input className="field" value={best5k} onChange={(e) => setBest5k(e.target.value)} placeholder="27:30" /></Field>
              <Field label="Recent 10k (mm:ss)" optional><input className="field" value={best10k} onChange={(e) => setBest10k(e.target.value)} placeholder="57:00" /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Easy pace (min/km)" optional><input className="field" value={easyPace} onChange={(e) => setEasyPace(e.target.value)} placeholder="6:30" /></Field>
              <Field label="Tempo pace (min/km)" optional><input className="field" value={tempoPace} onChange={(e) => setTempoPace(e.target.value)} placeholder="5:15" /></Field>
            </div>
            <Field label="Current strength routine" optional><input className="field" value={p.strengthRoutine ?? ''} onChange={(e) => set({ strengthRoutine: e.target.value })} placeholder="e.g. PPL 5 days" /></Field>
            <Field label="HYROX experience" optional><input className="field" value={p.hyroxExperience ?? ''} onChange={(e) => set({ hyroxExperience: e.target.value })} placeholder="e.g. first race" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Race division"><input className="field" value={p.raceDivision ?? ''} onChange={(e) => set({ raceDivision: e.target.value })} /></Field>
              <Field label="Race date"><input type="date" className="field" value={p.raceDate ?? ''} onChange={(e) => set({ raceDate: e.target.value })} /></Field>
            </div>
            <Field label="Training start date" hint="Your plan is generated from here to race day."><input type="date" className="field" value={p.trainingStartDate ?? ''} onChange={(e) => set({ trainingStartDate: e.target.value })} /></Field>
            <Field label="Session time available (min)" optional><input className="field" inputMode="numeric" value={p.sessionMinutes ?? ''} onChange={(e) => set({ sessionMinutes: num(e.target.value) })} /></Field>
            <Field label="Previous injuries / limitations" optional hint="Only if you choose to disclose."><input className="field" value={p.injuries ?? ''} onChange={(e) => set({ injuries: e.target.value })} /></Field>
          </StepWrap>
        )}
        {step === 4 && (
          <StepWrap title="Nutrition" desc="Default diet is vegetarian — edit if needed.">
            <Field label="Dietary preference"><input className="field" value={p.diet ?? ''} onChange={(e) => set({ diet: e.target.value })} /></Field>
            <Field label="Allergies / intolerances" optional><input className="field" value={p.allergies ?? ''} onChange={(e) => set({ allergies: e.target.value })} /></Field>
            <Field label="Typical meal schedule" optional><input className="field" value={p.mealSchedule ?? ''} onChange={(e) => set({ mealSchedule: e.target.value })} placeholder="e.g. 8am, 1pm, 8pm + snack" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Typical calories" optional><input className="field" inputMode="numeric" value={p.typicalCalories ?? ''} onChange={(e) => set({ typicalCalories: num(e.target.value) })} /></Field>
              <Field label="Typical protein (g)" optional><input className="field" inputMode="numeric" value={p.typicalProtein ?? ''} onChange={(e) => set({ typicalProtein: num(e.target.value) })} /></Field>
            </div>
            <Field label="Food preferences" optional><input className="field" value={p.foodPreferences ?? ''} onChange={(e) => set({ foodPreferences: e.target.value })} /></Field>
            <Field label="Disliked foods" optional><input className="field" value={p.dislikedFoods ?? ''} onChange={(e) => set({ dislikedFoods: e.target.value })} /></Field>
            <Field label="Supplements currently used" hint="Previously reported — confirm which you still take.">
              <div className="flex flex-wrap gap-2">
                {DEFAULT_SUPPLEMENTS.map((s) => {
                  const active = supps.some((x) => x.name === s.name);
                  return (
                    <Chip key={s.name} active={active} onClick={() => setSupps((prev) => active ? prev.filter((x) => x.name !== s.name) : [...prev, { ...s }])}>{s.name}</Chip>
                  );
                })}
              </div>
            </Field>
          </StepWrap>
        )}
        {step === 5 && (
          <StepWrap title="Lifestyle & recovery" desc="Helps tailor recovery guidance.">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Avg sleep (hours)"><input className="field" inputMode="decimal" value={p.avgSleepHours ?? ''} onChange={(e) => set({ avgSleepHours: num(e.target.value) })} /></Field>
              <Field label="Daily steps (typical)"><input className="field" inputMode="numeric" value={p.typicalSteps ?? ''} onChange={(e) => set({ typicalSteps: num(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bedtime" optional><input type="time" className="field" value={p.bedtime ?? ''} onChange={(e) => set({ bedtime: e.target.value })} /></Field>
              <Field label="Wake time" optional><input type="time" className="field" value={p.wakeTime ?? ''} onChange={(e) => set({ wakeTime: e.target.value })} /></Field>
            </div>
            <Field label="Step goal"><input className="field" inputMode="numeric" value={p.stepGoal ?? ''} onChange={(e) => set({ stepGoal: num(e.target.value) })} /></Field>
            <Field label="Water target (ml)"><input className="field" inputMode="numeric" value={p.waterTargetMl ?? ''} onChange={(e) => set({ waterTargetMl: num(e.target.value) })} /></Field>
            <Field label="Daily activity level">
              <div className="flex flex-wrap gap-2">
                {(['sedentary', 'light', 'moderate', 'high', 'very_high'] as const).map((a) => (
                  <Chip key={a} active={p.activityLevel === a} onClick={() => set({ activityLevel: a })}>{a.replace('_', ' ')}</Chip>
                ))}
              </div>
            </Field>
            <Field label="Work schedule" optional><input className="field" value={p.workSchedule ?? ''} onChange={(e) => set({ workSchedule: e.target.value })} /></Field>
          </StepWrap>
        )}
        {step === 6 && (
          <StepWrap title="Devices & integrations" desc="These are not yet connected. Automatic sync needs native integration/APIs — until then, logging is manual with the source clearly labelled.">
            {INTEGRATIONS.map((i) => (
              <div key={i.key} className="card p-3.5 mb-2.5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{i.label}</div>
                  <div className="text-xs text-muted">{i.provides}</div>
                </div>
                <span className="pill bg-muted/15 text-muted">Not available yet</span>
              </div>
            ))}
            <InfoNote tone="warn">No integration is active. The app won't display fake steps, sleep or heart-rate data — you'll enter these manually, marked as manual, until a supported connection exists.</InfoNote>
          </StepWrap>
        )}
        {step === 7 && <Confirm p={p} supps={supps} best5k={best5k} best10k={best10k} saving={saving} />}
      </div>

      {step > 0 && step < 7 && (
        <div className="flex gap-3 pt-4 sticky bottom-0 bg-bg pb-safe">
          <button className="btn-ghost flex-1" onClick={back}>Back</button>
          <button className="btn-primary flex-1" onClick={next}>Continue</button>
        </div>
      )}
      {step === 7 && !saving && (
        <div className="flex gap-3 pt-4 sticky bottom-0 bg-bg pb-safe">
          <button className="btn-ghost flex-1" onClick={back}>Back</button>
          <button className="btn-primary flex-[2]" onClick={finish}>Create my dashboard →</button>
        </div>
      )}
    </div>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center">
      <div className="text-6xl mb-4">🔥</div>
      <h1 className="text-3xl font-extrabold tracking-tight">Forge OS</h1>
      <p className="text-muted mt-2 mb-1">Your personal AI athlete assistant.</p>
      <p className="text-sm text-muted/80 max-w-xs">Training, running, strength, HYROX, nutrition, sleep, recovery and a fitness community — in one place, on your phone.</p>
      <div className="card p-4 mt-6 text-left text-sm text-muted max-w-xs">
        We've pre-filled a few values from your previously reported info. You'll confirm each one — nothing is assumed current, and we never fabricate data.
      </div>
      <button className="btn-primary w-full max-w-xs mt-6" onClick={onStart}>Start onboarding</button>
    </div>
  );
}

function StepWrap({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
      {desc && <p className="text-sm text-muted mt-1 mb-4">{desc}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Confirm({ p, supps, best5k, best10k, saving }: { p: Partial<Profile>; supps: Supplement[]; best5k: string; best10k: string; saving: boolean }) {
  const rows: [string, string][] = [
    ['Name', p.displayName || '—'],
    ['Age', p.age ? String(p.age) : '—'],
    ['Height', `${cmToFtIn(p.heightCm)} (${p.heightCm ?? '—'} cm)`],
    ['Weight', p.weightKg ? `${p.weightKg} kg` : '—'],
    ['Primary goal', p.primaryGoal ? GOAL_LABELS[p.primaryGoal] : '—'],
    ['Race', `${p.raceDivision} · ${p.raceDate ? fmtDate(p.raceDate) : '—'}`],
    ['Training start', p.trainingStartDate ? fmtDate(p.trainingStartDate) : '—'],
    ['Weekly volume', p.weeklyVolumeKm ? `${p.weeklyVolumeKm} km` : '—'],
    ['5k / 10k', `${best5k || '—'} / ${best10k || '—'}`],
    ['Diet', p.diet || '—'],
    ['Supplements', supps.length ? supps.map((s) => s.name).join(', ') : 'none confirmed'],
    ['Sleep / Steps', `${p.avgSleepHours ?? '—'} h · ${p.typicalSteps ?? '—'} steps`],
    ['Water target', `${p.waterTargetMl ?? '—'} ml`],
  ];
  return (
    <div>
      <h2 className="text-2xl font-extrabold tracking-tight">Confirm your profile</h2>
      <p className="text-sm text-muted mt-1 mb-4">Review before we build your personalized dashboard and 15-week plan.</p>
      <div className="card divide-y divide-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
            <span className="text-muted">{k}</span>
            <span className="font-semibold text-right max-w-[60%]">{v}</span>
          </div>
        ))}
      </div>
      {saving && (
        <div className="card p-5 mt-4 text-center">
          <div className="text-2xl animate-pulse mb-1">⚙️</div>
          <div className="font-semibold">Building your plan…</div>
          <div className="text-xs text-muted">Generating training calendar through race day.</div>
        </div>
      )}
    </div>
  );
}
