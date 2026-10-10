import { useMemo, useState } from 'react';
import { useApp, newRecord } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { Field, Segmented, Chip, InfoNote } from '../../components/ui';
import { parseTimeToSec, paceSecPerKm, fmtPace, round1 } from '../../lib/calc';
import { combineDateTime, sleepMinutes, todayISO } from '../../lib/dates';
import { FOOD_DB } from '../../lib/constants';
import type {
  RunRecord, StrengthRecord, HyroxRecord, NutritionEntry, WaterEntry,
  SleepRecord, StepRecord, BodyRecord, RecoveryRecord, LoggedExercise,
  HyroxStationResult, PlannedWorkout, MuscleGroup, LoggedSet,
} from '../../db/types';
import { HYROX_STATIONS } from '../../lib/constants';

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
};

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Date (event date)">
      <input type="date" className="field" value={value} onChange={(e) => onChange(e.target.value)} max={todayISO()} />
    </Field>
  );
}

// ── Run ─────────────────────────────────────────────────────────────────────
export function LogRunForm({ onDone, plan }: { onDone: () => void; plan?: PlannedWorkout }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const prefillRun = plan?.runs[0];
  const [date, setDate] = useState(plan?.eventDate ?? today);
  const [kind, setKind] = useState<RunRecord['kind']>(prefillRun?.kind ?? 'easy');
  const [distance, setDistance] = useState(prefillRun?.distanceKm ? String(prefillRun.distanceKm) : '');
  const [time, setTime] = useState('');
  const [rpe, setRpe] = useState(prefillRun?.targetRPE ? String(prefillRun.targetRPE) : '');
  const [elevation, setElevation] = useState('');
  const [notes, setNotes] = useState('');

  const dist = num(distance);
  const sec = parseTimeToSec(time);
  const pace = dist && sec ? paceSecPerKm(dist, sec) : undefined;

  const lastSame = useMemo(
    () => [...data.runs].filter((r) => r.kind === kind).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0],
    [data.runs, kind],
  );

  const submit = async () => {
    if (!dist || !sec) {
      toast('Enter distance and time');
      return;
    }
    const rec = newRecord<Omit<RunRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      kind,
      distanceKm: round1(dist),
      durationSec: sec,
      avgPaceSecPerKm: paceSecPerKm(dist, sec),
      rpe: num(rpe),
      elevationM: num(elevation),
      notes: notes || undefined,
      linkedPlanId: plan?.id,
    }) as RunRecord;
    await save('runs', rec);
    toast('Run logged');
    onDone();
  };

  return (
    <div>
      {plan && <InfoNote>Prefilled from today's plan. Review and edit before saving — nothing is logged until you tap Save.</InfoNote>}
      <div className="h-3" />
      <DateField value={date} onChange={setDate} />
      <Field label="Type">
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as RunRecord['kind'])}
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'tempo', label: 'Tempo' },
            { value: 'long', label: 'Long' },
            { value: 'interval', label: 'Interval' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Distance (km)">
          <input className="field" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="5" />
        </Field>
        <Field label="Time (mm:ss)" hint="or h:mm:ss">
          <input className="field" inputMode="numeric" value={time} onChange={(e) => setTime(e.target.value)} placeholder="30:00" />
        </Field>
      </div>
      <div className="card p-3 mb-3 flex items-center justify-between">
        <span className="text-sm text-muted">Average pace</span>
        <span className="text-xl font-extrabold text-accent tabular-nums">{pace ? `${fmtPace(pace)} /km` : '—'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="RPE (1–10)" optional>
          <input className="field" inputMode="numeric" value={rpe} onChange={(e) => setRpe(e.target.value)} placeholder="4" />
        </Field>
        <Field label="Elevation (m)" optional>
          <input className="field" inputMode="numeric" value={elevation} onChange={(e) => setElevation(e.target.value)} placeholder="" />
        </Field>
      </div>
      <Field label="Notes" optional>
        <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it feel?" />
      </Field>
      {lastSame && (
        <div className="text-xs text-muted mb-3">
          Last {kind} run: {lastSame.distanceKm} km @ {fmtPace(lastSame.avgPaceSecPerKm)} /km on {lastSame.eventDate}.
        </div>
      )}
      <button className="btn-primary w-full" onClick={submit}>
        Save run
      </button>
    </div>
  );
}

// ── Strength ────────────────────────────────────────────────────────────────
interface EditExercise {
  name: string;
  group: MuscleGroup;
  sets: LoggedSet[];
}
export function LogStrengthForm({ onDone, plan }: { onDone: () => void; plan?: PlannedWorkout }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(plan?.eventDate ?? today);
  const [title, setTitle] = useState(plan?.title?.replace(/ \+ Easy run.*/, '') ?? 'Strength session');
  const init: EditExercise[] = plan?.exercises.length
    ? plan.exercises.map((e) => ({ name: e.name, group: e.group, sets: Array.from({ length: e.sets }, () => ({ completed: false })) }))
    : [{ name: '', group: 'fullbody', sets: [{ completed: false }] }];
  const [exs, setExs] = useState<EditExercise[]>(init);

  const prevFor = (name: string) => {
    for (const s of [...data.strength].sort((a, b) => b.eventDate.localeCompare(a.eventDate))) {
      const ex = s.exercises.find((e) => e.name.toLowerCase() === name.toLowerCase() && name);
      if (ex) {
        const top = ex.sets.filter((x) => x.weightKg).sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0))[0];
        if (top) return `prev: ${top.weightKg} kg × ${top.reps ?? '?'} (${s.eventDate})`;
      }
    }
    return null;
  };

  const update = (i: number, patch: Partial<EditExercise>) => setExs((p) => p.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const updateSet = (ei: number, si: number, patch: Partial<LoggedSet>) =>
    setExs((p) => p.map((e, idx) => (idx === ei ? { ...e, sets: e.sets.map((s, sidx) => (sidx === si ? { ...s, ...patch } : s)) } : e)));
  const addSet = (ei: number) => setExs((p) => p.map((e, idx) => (idx === ei ? { ...e, sets: [...e.sets, { completed: false }] } : e)));
  const addExercise = () => setExs((p) => [...p, { name: '', group: 'fullbody', sets: [{ completed: false }] }]);
  const removeExercise = (ei: number) => setExs((p) => p.filter((_, idx) => idx !== ei));

  const submit = async () => {
    const cleaned: LoggedExercise[] = exs
      .filter((e) => e.name.trim())
      .map((e) => ({
        name: e.name.trim(),
        group: e.group,
        sets: e.sets.map((s) => ({ ...s, completed: s.reps !== undefined || s.weightKg !== undefined || s.completed })),
      }));
    if (!cleaned.length) {
      toast('Add at least one exercise');
      return;
    }
    const rec = newRecord<Omit<StrengthRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      title: title || 'Strength session',
      exercises: cleaned,
      linkedPlanId: plan?.id,
    }) as StrengthRecord;
    await save('strength', rec);
    toast('Strength logged');
    onDone();
  };

  return (
    <div>
      {plan && <InfoNote>Prefilled from plan. Fill the weights you actually lifted. Save when done.</InfoNote>}
      <div className="h-3" />
      <DateField value={date} onChange={setDate} />
      <Field label="Session title">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {exs.map((ex, ei) => (
        <div key={ei} className="card p-3 mb-3">
          <div className="flex gap-2 items-center mb-2">
            <input className="field flex-1" placeholder="Exercise name" value={ex.name} onChange={(e) => update(ei, { name: e.target.value })} />
            <button onClick={() => removeExercise(ei)} className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 border border-line text-muted">×</button>
          </div>
          {ex.name && prevFor(ex.name) && <div className="text-xs text-info mb-2">↳ {prevFor(ex.name)}</div>}
          <div className="space-y-2">
            {ex.sets.map((st, si) => (
              <div key={si} className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 items-center">
                <span className="text-xs text-muted w-8">#{si + 1}</span>
                <input className="field py-2 text-sm" inputMode="numeric" placeholder="reps" value={st.reps ?? ''} onChange={(e) => updateSet(ei, si, { reps: num(e.target.value) })} />
                <input className="field py-2 text-sm" inputMode="decimal" placeholder="kg" value={st.weightKg ?? ''} onChange={(e) => updateSet(ei, si, { weightKg: num(e.target.value) })} />
                <input className="field py-2 text-sm" inputMode="numeric" placeholder="RPE" value={st.rpe ?? ''} onChange={(e) => updateSet(ei, si, { rpe: num(e.target.value) })} />
              </div>
            ))}
          </div>
          <button onClick={() => addSet(ei)} className="btn-ghost w-full mt-2 py-2 text-sm">+ Add set</button>
        </div>
      ))}
      <button onClick={addExercise} className="btn-ghost w-full mb-3">+ Add exercise</button>
      <button className="btn-primary w-full" onClick={submit}>
        Save session
      </button>
    </div>
  );
}

// ── HYROX ───────────────────────────────────────────────────────────────────
export function LogHyroxForm({ onDone, plan }: { onDone: () => void; plan?: PlannedWorkout }) {
  const { save, today } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(plan?.eventDate ?? today);
  const [mode, setMode] = useState<HyroxRecord['mode']>(plan?.title.includes('Simulation') ? 'simulation' : 'station');
  const [title, setTitle] = useState(plan?.title ?? 'HYROX session');
  const planStations = plan?.hyroxStations.length ? plan.hyroxStations : HYROX_STATIONS;
  const [stations, setStations] = useState<(HyroxStationResult & { include: boolean })[]>(
    planStations.map((s) => ({ station: s.station, loadKg: s.loadKg, include: true })),
  );

  const upd = (i: number, patch: Partial<HyroxStationResult & { include: boolean }>) =>
    setStations((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const submit = async () => {
    const chosen = stations.filter((s) => s.include);
    if (!chosen.length) {
      toast('Include at least one station');
      return;
    }
    const rec = newRecord<Omit<HyroxRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      title,
      mode,
      stations: chosen.map((s) => ({
        station: s.station,
        distanceM: s.distanceM,
        reps: s.reps,
        loadKg: s.loadKg,
        timeSec: s.timeSec,
        breaks: s.breaks,
        rpe: s.rpe,
        notes: s.notes,
      })),
      linkedPlanId: plan?.id,
    }) as HyroxRecord;
    await save('hyrox', rec);
    toast('HYROX session logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      <Field label="Mode">
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as HyroxRecord['mode'])}
          options={[
            { value: 'station', label: 'Stations' },
            { value: 'combo', label: 'Combo' },
            { value: 'simulation', label: 'Sim' },
            { value: 'race', label: 'Race' },
          ]}
        />
      </Field>
      <Field label="Title">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <InfoNote tone="warn">Loads/standards are defaults for Men Open — confirm against your event's rules.</InfoNote>
      <div className="h-3" />
      {stations.map((s, i) => (
        <div key={i} className={`card p-3 mb-2 ${s.include ? '' : 'opacity-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">{s.station}</span>
            <Chip active={s.include} onClick={() => upd(i, { include: !s.include })}>
              {s.include ? 'Included' : 'Skip'}
            </Chip>
          </div>
          {s.include && (
            <div className="grid grid-cols-3 gap-2">
              <input className="field py-2 text-sm" inputMode="numeric" placeholder="time mm:ss" onChange={(e) => upd(i, { timeSec: parseTimeToSec(e.target.value) })} />
              <input className="field py-2 text-sm" inputMode="decimal" placeholder="load kg" value={s.loadKg ?? ''} onChange={(e) => upd(i, { loadKg: num(e.target.value) })} />
              <input className="field py-2 text-sm" inputMode="numeric" placeholder="breaks" onChange={(e) => upd(i, { breaks: num(e.target.value) })} />
              <input className="field py-2 text-sm" inputMode="numeric" placeholder={s.station.includes('Wall') ? 'reps' : 'dist m'} onChange={(e) => (s.station.includes('Wall') ? upd(i, { reps: num(e.target.value) }) : upd(i, { distanceM: num(e.target.value) }))} />
              <input className="field py-2 text-sm" inputMode="numeric" placeholder="RPE" onChange={(e) => upd(i, { rpe: num(e.target.value) })} />
              <input className="field py-2 text-sm" placeholder="note" onChange={(e) => upd(i, { notes: e.target.value })} />
            </div>
          )}
        </div>
      ))}
      <button className="btn-primary w-full mt-2" onClick={submit}>
        Save HYROX session
      </button>
    </div>
  );
}

// ── Meal ────────────────────────────────────────────────────────────────────
export function LogMealForm({ onDone }: { onDone: () => void }) {
  const { save, today } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<NutritionEntry['meal']>('breakfast');
  const [name, setName] = useState('');
  const [serving, setServing] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [fiber, setFiber] = useState('');

  const matches = name.length >= 2 ? FOOD_DB.filter((f) => f.name.toLowerCase().includes(name.toLowerCase())).slice(0, 5) : [];
  const pick = (f: (typeof FOOD_DB)[number]) => {
    setName(f.name);
    setServing(f.serving);
    setCalories(String(f.calories));
    setProtein(String(f.protein));
    setCarbs(String(f.carbs));
    setFat(String(f.fat));
    setFiber(f.fiber ? String(f.fiber) : '');
  };

  const submit = async () => {
    if (!name.trim()) {
      toast('Enter a food name');
      return;
    }
    const rec = newRecord<Omit<NutritionEntry, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      meal,
      name: name.trim(),
      servingSize: serving || undefined,
      calories: num(calories),
      protein: num(protein),
      carbs: num(carbs),
      fat: num(fat),
      fiber: num(fiber),
    }) as NutritionEntry;
    await save('nutrition', rec);
    toast('Meal logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      <Field label="Meal">
        <Segmented
          value={meal}
          onChange={(v) => setMeal(v as NutritionEntry['meal'])}
          options={[
            { value: 'breakfast', label: 'Breakfast' },
            { value: 'lunch', label: 'Lunch' },
            { value: 'dinner', label: 'Dinner' },
            { value: 'snack', label: 'Snack' },
          ]}
        />
      </Field>
      <Field label="Food" hint="Search the built-in list or type a custom food.">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paneer, Dal, Oats" />
      </Field>
      {matches.length > 0 && (
        <div className="card p-2 mb-3 -mt-2">
          {matches.map((f) => (
            <button key={f.name} onClick={() => pick(f)} className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2 flex justify-between text-sm">
              <span>{f.name}</span>
              <span className="text-muted">{f.calories} kcal · {f.protein}p</span>
            </button>
          ))}
        </div>
      )}
      <Field label="Serving size" optional>
        <input className="field" value={serving} onChange={(e) => setServing(e.target.value)} placeholder="1 bowl / 100 g" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Calories (kcal)"><input className="field" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} /></Field>
        <Field label="Protein (g)"><input className="field" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></Field>
        <Field label="Carbs (g)" optional><input className="field" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></Field>
        <Field label="Fat (g)" optional><input className="field" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></Field>
      </div>
      <Field label="Fibre (g)" optional><input className="field" inputMode="decimal" value={fiber} onChange={(e) => setFiber(e.target.value)} /></Field>
      <InfoNote>Nutrition values are from the built-in reference or your own entry — the app never fabricates exact values. Leave fields blank if unknown.</InfoNote>
      <div className="h-3" />
      <button className="btn-primary w-full" onClick={submit}>Save meal</button>
    </div>
  );
}

// ── Water ───────────────────────────────────────────────────────────────────
export function LogWaterForm({ onDone }: { onDone: () => void }) {
  const { save, today, settings } = useApp();
  const toast = useToast();
  const serving = settings?.waterServingMl ?? 250;
  const [custom, setCustom] = useState('');
  const quick = [serving, serving * 2, 500, 1000];

  const add = async (ml: number) => {
    const rec = newRecord<Omit<WaterEntry, 'id' | 'createdAt' | 'updatedAt'>>({ eventDate: today, source: 'manual', amountMl: ml }) as WaterEntry;
    await save('water', rec);
    toast(`+${ml} ml logged`);
    onDone();
  };

  return (
    <div>
      <p className="text-sm text-muted mb-3">Tap to add water for today.</p>
      <div className="grid grid-cols-2 gap-3 mb-3">
        {quick.map((q) => (
          <button key={q} className="btn-ghost py-4 text-lg" onClick={() => add(q)}>
            💧 {q} ml
          </button>
        ))}
      </div>
      <Field label="Custom amount (ml)">
        <div className="flex gap-2">
          <input className="field flex-1" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="300" />
          <button className="btn-primary px-5" onClick={() => { const n = num(custom); if (n) add(n); else toast('Enter ml'); }}>Add</button>
        </div>
      </Field>
    </div>
  );
}

// ── Weight / body ───────────────────────────────────────────────────────────
export function LogWeightForm({ onDone }: { onDone: () => void }) {
  const { save, today, profile, saveProfile } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [chest, setChest] = useState('');
  const [arm, setArm] = useState('');
  const [thigh, setThigh] = useState('');
  const [bf, setBf] = useState('');

  const submit = async () => {
    const w = num(weight);
    if (!w && !num(waist) && !num(chest)) {
      toast('Enter at least one measurement');
      return;
    }
    const rec = newRecord<Omit<BodyRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      weightKg: w,
      waistCm: num(waist),
      chestCm: num(chest),
      armCm: num(arm),
      thighCm: num(thigh),
      bodyFatPct: num(bf),
    }) as BodyRecord;
    await save('body', rec);
    if (w && profile) await saveProfile({ ...profile, weightKg: w });
    toast('Body metrics logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      <Field label="Body weight (kg)">
        <input className="field text-lg" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="69.0" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Waist (cm)" optional><input className="field" inputMode="decimal" value={waist} onChange={(e) => setWaist(e.target.value)} /></Field>
        <Field label="Chest (cm)" optional><input className="field" inputMode="decimal" value={chest} onChange={(e) => setChest(e.target.value)} /></Field>
        <Field label="Arm (cm)" optional><input className="field" inputMode="decimal" value={arm} onChange={(e) => setArm(e.target.value)} /></Field>
        <Field label="Thigh (cm)" optional><input className="field" inputMode="decimal" value={thigh} onChange={(e) => setThigh(e.target.value)} /></Field>
      </div>
      <Field label="Body fat %" optional hint="Only if measured (e.g. DEXA, calipers). Never estimated.">
        <input className="field" inputMode="decimal" value={bf} onChange={(e) => setBf(e.target.value)} />
      </Field>
      <button className="btn-primary w-full" onClick={submit}>Save</button>
    </div>
  );
}

// ── Sleep ───────────────────────────────────────────────────────────────────
export function LogSleepForm({ onDone }: { onDone: () => void }) {
  const { save, today, profile } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [bedtime, setBedtime] = useState(profile?.bedtime ?? '23:00');
  const [wake, setWake] = useState(profile?.wakeTime ?? '06:30');
  const [quality, setQuality] = useState(3);
  const [rhr, setRhr] = useState('');
  const [hrv, setHrv] = useState('');

  // bedtime belongs to the previous calendar evening; wake to the event date.
  const bedISO = combineDateTime(date, bedtime);
  const wakeISO = combineDateTime(date, wake);
  const mins = sleepMinutes(bedISO, wakeISO);
  const h = Math.floor(mins / 60);
  const m = mins % 60;

  const submit = async () => {
    const rec = newRecord<Omit<SleepRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      bedtime: bedISO,
      wakeTime: wakeISO,
      durationMin: mins,
      quality,
      restingHr: num(rhr),
      hrv: num(hrv),
    }) as SleepRecord;
    await save('sleep', rec);
    toast('Sleep logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bedtime"><input type="time" className="field" value={bedtime} onChange={(e) => setBedtime(e.target.value)} /></Field>
        <Field label="Wake time"><input type="time" className="field" value={wake} onChange={(e) => setWake(e.target.value)} /></Field>
      </div>
      <div className="card p-3 mb-3 flex items-center justify-between">
        <span className="text-sm text-muted">Duration (crosses midnight correctly)</span>
        <span className="text-xl font-extrabold text-info tabular-nums">{h}h {m.toString().padStart(2, '0')}m</span>
      </div>
      <Field label="Quality (1–5)">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setQuality(n)} className={`flex-1 py-3 rounded-xl font-bold border ${quality === n ? 'bg-accent text-black border-accent' : 'bg-surface-2 border-line text-muted'}`}>{n}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Resting HR" optional><input className="field" inputMode="numeric" value={rhr} onChange={(e) => setRhr(e.target.value)} /></Field>
        <Field label="HRV (ms)" optional hint="From a device only."><input className="field" inputMode="numeric" value={hrv} onChange={(e) => setHrv(e.target.value)} /></Field>
      </div>
      <button className="btn-primary w-full" onClick={submit}>Save sleep</button>
    </div>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────
export function LogStepsForm({ onDone }: { onDone: () => void }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [steps, setSteps] = useState('');
  const [distance, setDistance] = useState('');
  const [active, setActive] = useState('');

  const existing = data.steps.find((s) => s.eventDate === date);

  const submit = async () => {
    const n = num(steps);
    if (!n) {
      toast('Enter step count');
      return;
    }
    const rec = newRecord<Omit<StepRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      steps: n,
      distanceKm: num(distance),
      activeMinutes: num(active),
    }) as StepRecord;
    if (existing) rec.id = existing.id; // one record per day, avoid double-count
    await save('steps', rec);
    toast('Steps logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      {existing && <InfoNote tone="warn">A step record already exists for this day ({existing.steps}). Saving overwrites it to avoid double-counting.</InfoNote>}
      <div className="h-3" />
      <Field label="Steps">
        <input className="field text-lg" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="8000" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Distance (km)" optional><input className="field" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} /></Field>
        <Field label="Active minutes" optional><input className="field" inputMode="numeric" value={active} onChange={(e) => setActive(e.target.value)} /></Field>
      </div>
      <InfoNote>Source: <b>manual entry</b>. A web app can't read phone/device sensors without native integration — connect a supported device later for automatic sync.</InfoNote>
      <div className="h-3" />
      <button className="btn-primary w-full" onClick={submit}>Save steps</button>
    </div>
  );
}

// ── Recovery ────────────────────────────────────────────────────────────────
export function LogRecoveryForm({ onDone }: { onDone: () => void }) {
  const { save, today } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const [fatigue, setFatigue] = useState(3);
  const [soreness, setSoreness] = useState(3);
  const [motivation, setMotivation] = useState(3);
  const [stress, setStress] = useState(3);
  const [pain, setPain] = useState('');

  const Scale = ({ label, value, set }: { label: string; value: number; set: (n: number) => void }) => (
    <Field label={label}>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => set(n)} className={`flex-1 py-3 rounded-xl font-bold border ${value === n ? 'bg-accent text-black border-accent' : 'bg-surface-2 border-line text-muted'}`}>{n}</button>
        ))}
      </div>
    </Field>
  );

  const submit = async () => {
    const rec = newRecord<Omit<RecoveryRecord, 'id' | 'createdAt' | 'updatedAt'>>({
      eventDate: date,
      source: 'manual',
      fatigue,
      soreness,
      motivation,
      stress,
      pain: pain || undefined,
    }) as RecoveryRecord;
    await save('recovery', rec);
    toast('Recovery logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      <Scale label="Fatigue (1 fresh – 5 exhausted)" value={fatigue} set={setFatigue} />
      <Scale label="Muscle soreness (1 none – 5 severe)" value={soreness} set={setSoreness} />
      <Scale label="Motivation (1 low – 5 high)" value={motivation} set={setMotivation} />
      <Scale label="Stress (1 low – 5 high)" value={stress} set={setStress} />
      <Field label="Pain / discomfort" optional hint="Note anything unusual. If pain persists, see a professional — don't train through injury.">
        <input className="field" value={pain} onChange={(e) => setPain(e.target.value)} />
      </Field>
      <button className="btn-primary w-full" onClick={submit}>Save recovery</button>
    </div>
  );
}
