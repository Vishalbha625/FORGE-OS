import { useMemo, useState } from 'react';
import { useApp, newRecord, uid } from '../../store/AppContext';
import { useToast } from '../../store/toast';
import { useConfirmDuplicate } from '../../store/confirm';
import { Field, Segmented, Chip, InfoNote } from '../../components/ui';
import { parseTimeToSec, paceSecPerKm, fmtPace, fmtDuration, round1 } from '../../lib/calc';
import { combineDateTime, sleepMinutes, todayISO, addDays } from '../../lib/dates';
import { FOOD_DB, HYROX_STATIONS } from '../../lib/constants';
import { findDuplicateRun, findDuplicateMeal, findDuplicateStrength } from '../../lib/dedupe';
import type {
  RunRecord, StrengthRecord, HyroxRecord, NutritionEntry, WaterEntry,
  SleepRecord, StepRecord, BodyRecord, RecoveryRecord, LoggedExercise,
  PlannedWorkout, MuscleGroup, LoggedSet, SavedMeal,
} from '../../db/types';

const num = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return isNaN(n) ? undefined : n;
};
const str = (n?: number) => (n === undefined ? '' : String(n));

/** Merge edits onto an existing record (keeping id/createdAt/source), or create a new one. */
function upsert<T extends object>(existing: T | undefined, fields: object): T {
  if (existing) return { ...existing, ...fields } as T;
  return newRecord({ source: 'manual', ...fields }) as unknown as T;
}

function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Date (event date)">
      <input type="date" className="field" value={value} onChange={(e) => onChange(e.target.value)} max={todayISO()} />
    </Field>
  );
}

function EditBanner({ existing }: { existing?: { createdAt: string; source: string } }) {
  if (!existing) return null;
  return <div className="mb-3"><InfoNote>Editing an existing {existing.source} entry. The change is recorded in your edit history (Profile → Edit history).</InfoNote></div>;
}

// ── Run ─────────────────────────────────────────────────────────────────────
export function LogRunForm({ onDone, plan, existing }: { onDone: () => void; plan?: PlannedWorkout; existing?: RunRecord }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const confirmDup = useConfirmDuplicate();
  const prefillRun = plan?.runs[0];
  const [date, setDate] = useState(existing?.eventDate ?? plan?.eventDate ?? today);
  const [kind, setKind] = useState<RunRecord['kind']>(existing?.kind ?? prefillRun?.kind ?? 'easy');
  const [distance, setDistance] = useState(str(existing?.distanceKm ?? prefillRun?.distanceKm));
  const [time, setTime] = useState(existing ? fmtDuration(existing.durationSec) : '');
  const [rpe, setRpe] = useState(str(existing?.rpe ?? prefillRun?.targetRPE));
  const [elevation, setElevation] = useState(str(existing?.elevationM));
  const [notes, setNotes] = useState(existing?.notes ?? '');

  const dist = num(distance);
  const sec = parseTimeToSec(time);
  const pace = dist && sec ? paceSecPerKm(dist, sec) : undefined;

  const lastSame = useMemo(
    () => [...data.runs].filter((r) => r.kind === kind && r.id !== existing?.id).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0],
    [data.runs, kind, existing?.id],
  );

  const submit = async () => {
    if (!dist || dist <= 0 || !sec) {
      toast('Enter distance and time');
      return;
    }
    if (dist > 200) {
      toast('Distance looks wrong (over 200 km)');
      return;
    }
    const dup = findDuplicateRun(data.runs, { id: existing?.id, eventDate: date, distanceKm: round1(dist), durationSec: sec });
    if (dup && !(await confirmDup(`A ${dup.distanceKm} km run in ${fmtDuration(dup.durationSec)} is already logged on ${date}. Save this one as well?`))) return;
    const rec = upsert<RunRecord>(existing, {
      eventDate: date,
      kind,
      distanceKm: round1(dist),
      durationSec: sec,
      avgPaceSecPerKm: paceSecPerKm(dist, sec),
      rpe: num(rpe),
      elevationM: num(elevation),
      notes: notes || undefined,
      linkedPlanId: existing?.linkedPlanId ?? plan?.id,
    });
    await save('runs', rec);
    toast(existing ? 'Run updated' : 'Run logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
      {plan && !existing && <div className="mb-3"><InfoNote>Prefilled from the plan. Review and edit before saving. Nothing is logged until you tap Save.</InfoNote></div>}
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
        <span className="text-xl font-semibold text-accent tabular-nums">{pace ? `${fmtPace(pace)} /km` : '–'}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="RPE (1–10)" optional>
          <input className="field" inputMode="numeric" value={rpe} onChange={(e) => setRpe(e.target.value)} placeholder="4" />
        </Field>
        <Field label="Elevation (m)" optional>
          <input className="field" inputMode="numeric" value={elevation} onChange={(e) => setElevation(e.target.value)} />
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
      <button className="btn-primary w-full" onClick={submit}>{existing ? 'Save changes' : 'Save run'}</button>
    </div>
  );
}

// ── Strength ────────────────────────────────────────────────────────────────
interface EditExercise {
  name: string;
  group: MuscleGroup;
  sets: LoggedSet[];
}
export function LogStrengthForm({ onDone, plan, existing }: { onDone: () => void; plan?: PlannedWorkout; existing?: StrengthRecord }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const confirmDup = useConfirmDuplicate();
  const [date, setDate] = useState(existing?.eventDate ?? plan?.eventDate ?? today);
  const [title, setTitle] = useState(existing?.title ?? plan?.title?.replace(/ \+ Easy run.*/, '') ?? 'Strength session');
  const init: EditExercise[] = existing
    ? existing.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) }))
    : plan?.exercises.length
      ? plan.exercises.map((e) => ({ name: e.name, group: e.group, sets: Array.from({ length: e.sets }, () => ({ completed: false })) }))
      : [{ name: '', group: 'fullbody', sets: [{ completed: false }] }];
  const [exs, setExs] = useState<EditExercise[]>(init);

  const prevFor = (name: string) => {
    for (const s of [...data.strength].filter((x) => x.id !== existing?.id).sort((a, b) => b.eventDate.localeCompare(a.eventDate))) {
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
  const addSet = (ei: number) => setExs((p) => p.map((e, idx) => (idx === ei ? { ...e, sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? {}), completed: false }] } : e)));
  const removeSet = (ei: number, si: number) => setExs((p) => p.map((e, idx) => (idx === ei ? { ...e, sets: e.sets.filter((_, j) => j !== si) } : e)));
  const addExercise = () => setExs((p) => [...p, { name: '', group: 'fullbody', sets: [{ completed: false }] }]);
  const removeExercise = (ei: number) => setExs((p) => p.filter((_, idx) => idx !== ei));

  const submit = async () => {
    const cleaned: LoggedExercise[] = exs
      .filter((e) => e.name.trim())
      .map((e) => ({
        name: e.name.trim(),
        group: e.group,
        // A set counts as completed only if something was actually recorded.
        sets: e.sets.map((s) => ({ ...s, completed: s.reps !== undefined || s.weightKg !== undefined })),
      }));
    if (!cleaned.length) {
      toast('Add at least one exercise');
      return;
    }
    const finalTitle = title.trim() || 'Strength session';
    const dup = findDuplicateStrength(data.strength, { id: existing?.id, eventDate: date, title: finalTitle });
    if (dup && !(await confirmDup(`"${dup.title}" is already logged on ${date}. Save a second session with the same name?`))) return;
    const rec = upsert<StrengthRecord>(existing, {
      eventDate: date,
      title: finalTitle,
      exercises: cleaned,
      linkedPlanId: existing?.linkedPlanId ?? plan?.id,
    });
    await save('strength', rec);
    toast(existing ? 'Session updated' : 'Strength logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
      {plan && !existing && <div className="mb-3"><InfoNote>Prefilled from the plan. Fill in what you actually lifted, then save.</InfoNote></div>}
      <DateField value={date} onChange={setDate} />
      <Field label="Session title">
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {exs.map((ex, ei) => (
        <div key={ei} className="card p-3 mb-3">
          <div className="flex gap-2 items-center mb-2">
            <input className="field flex-1" placeholder="Exercise name" value={ex.name} onChange={(e) => update(ei, { name: e.target.value })} />
            <button onClick={() => removeExercise(ei)} className="w-9 h-9 shrink-0 rounded-xl bg-surface-2 border border-line text-muted" aria-label="Remove exercise">×</button>
          </div>
          {ex.name && prevFor(ex.name) && <div className="text-xs text-info mb-2">↳ {prevFor(ex.name)}</div>}
          <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1.75rem] gap-2 text-[10px] text-muted uppercase tracking-wide mb-1 px-0.5">
            <span>Set</span><span>Reps</span><span>kg</span><span>RPE</span><span />
          </div>
          <div className="space-y-2">
            {ex.sets.map((st, si) => (
              <div key={si} className="grid grid-cols-[2rem_1fr_1fr_1fr_1.75rem] gap-2 items-center">
                <span className="text-xs text-muted">#{si + 1}</span>
                <input className="field py-2 text-sm" inputMode="numeric" placeholder="reps" value={str(st.reps)} onChange={(e) => updateSet(ei, si, { reps: num(e.target.value) })} />
                <input className="field py-2 text-sm" inputMode="decimal" placeholder="kg" value={str(st.weightKg)} onChange={(e) => updateSet(ei, si, { weightKg: num(e.target.value) })} />
                <input className="field py-2 text-sm" inputMode="numeric" placeholder="RPE" value={str(st.rpe)} onChange={(e) => updateSet(ei, si, { rpe: num(e.target.value) })} />
                <button className="text-muted text-sm" onClick={() => removeSet(ei, si)} aria-label="Remove set">×</button>
              </div>
            ))}
          </div>
          <button onClick={() => addSet(ei)} className="btn-ghost w-full mt-2 py-2 text-sm">+ Add set</button>
        </div>
      ))}
      <button onClick={addExercise} className="btn-ghost w-full mb-3">+ Add exercise</button>
      <button className="btn-primary w-full" onClick={submit}>{existing ? 'Save changes' : 'Save session'}</button>
    </div>
  );
}

// ── HYROX ───────────────────────────────────────────────────────────────────
interface StationDraft {
  station: string;
  include: boolean;
  time: string;
  loadKg: string;
  breaks: string;
  amount: string; // distance m, or reps for wall balls
  rpe: string;
  notes: string;
}
const isRepStation = (s: string) => s.toLowerCase().includes('wall');

export function LogHyroxForm({ onDone, plan, existing }: { onDone: () => void; plan?: PlannedWorkout; existing?: HyroxRecord }) {
  const { save, today } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(existing?.eventDate ?? plan?.eventDate ?? today);
  const [mode, setMode] = useState<HyroxRecord['mode']>(existing?.mode ?? ((plan && /simulation/i.test(plan.title)) ? 'simulation' : 'station'));
  const [title, setTitle] = useState(existing?.title ?? plan?.title ?? 'HYROX session');
  const [stations, setStations] = useState<StationDraft[]>(() => {
    if (existing) {
      return existing.stations.map((s) => ({
        station: s.station,
        include: true,
        time: s.timeSec !== undefined ? fmtDuration(s.timeSec) : '',
        loadKg: str(s.loadKg),
        breaks: str(s.breaks),
        amount: str(isRepStation(s.station) ? s.reps : s.distanceM),
        rpe: str(s.rpe),
        notes: s.notes ?? '',
      }));
    }
    const src = plan?.hyroxStations.length ? plan.hyroxStations : HYROX_STATIONS;
    return src.map((s) => ({ station: s.station, include: true, time: '', loadKg: str(s.loadKg), breaks: '', amount: '', rpe: '', notes: '' }));
  });

  const upd = (i: number, patch: Partial<StationDraft>) => setStations((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const submit = async () => {
    const chosen = stations.filter((s) => s.include);
    if (!chosen.length) {
      toast('Include at least one station');
      return;
    }
    const rec = upsert<HyroxRecord>(existing, {
      eventDate: date,
      title,
      mode,
      stations: chosen.map((s) => ({
        station: s.station,
        timeSec: parseTimeToSec(s.time),
        loadKg: num(s.loadKg),
        breaks: num(s.breaks),
        reps: isRepStation(s.station) ? num(s.amount) : undefined,
        distanceM: isRepStation(s.station) ? undefined : num(s.amount),
        rpe: num(s.rpe),
        notes: s.notes || undefined,
      })),
      linkedPlanId: existing?.linkedPlanId ?? plan?.id,
    });
    await save('hyrox', rec);
    toast(existing ? 'Session updated' : 'HYROX session logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
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
      <InfoNote tone="warn">Loads and standards are Men Open defaults. Confirm them against your event's rules.</InfoNote>
      <div className="h-3" />
      {stations.map((s, i) => (
        <div key={i} className={`card p-3 mb-2 ${s.include ? '' : 'opacity-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">{s.station}</span>
            <Chip active={s.include} onClick={() => upd(i, { include: !s.include })}>
              {s.include ? 'Included' : 'Skipped'}
            </Chip>
          </div>
          {s.include && (
            <div className="grid grid-cols-3 gap-2">
              <input className="field py-2 text-sm" inputMode="numeric" placeholder="time m:ss" value={s.time} onChange={(e) => upd(i, { time: e.target.value })} />
              <input className="field py-2 text-sm" inputMode="decimal" placeholder="load kg" value={s.loadKg} onChange={(e) => upd(i, { loadKg: e.target.value })} />
              <input className="field py-2 text-sm" inputMode="numeric" placeholder="breaks" value={s.breaks} onChange={(e) => upd(i, { breaks: e.target.value })} />
              <input className="field py-2 text-sm" inputMode="numeric" placeholder={isRepStation(s.station) ? 'reps' : 'dist m'} value={s.amount} onChange={(e) => upd(i, { amount: e.target.value })} />
              <input className="field py-2 text-sm" inputMode="numeric" placeholder="RPE" value={s.rpe} onChange={(e) => upd(i, { rpe: e.target.value })} />
              <input className="field py-2 text-sm" placeholder="note" value={s.notes} onChange={(e) => upd(i, { notes: e.target.value })} />
            </div>
          )}
        </div>
      ))}
      <button className="btn-primary w-full mt-2" onClick={submit}>{existing ? 'Save changes' : 'Save HYROX session'}</button>
    </div>
  );
}

// ── Meal ────────────────────────────────────────────────────────────────────
export function LogMealForm({ onDone, existing, date: initialDate }: { onDone: () => void; existing?: NutritionEntry; date?: string }) {
  const { save, today, data, settings, saveSettings } = useApp();
  const toast = useToast();
  const confirmDup = useConfirmDuplicate();
  const [date, setDate] = useState(existing?.eventDate ?? initialDate ?? today);
  const [meal, setMeal] = useState<NutritionEntry['meal']>(existing?.meal ?? 'breakfast');
  const [name, setName] = useState(existing?.name ?? '');
  const [serving, setServing] = useState(existing?.servingSize ?? '');
  const [calories, setCalories] = useState(str(existing?.calories));
  const [protein, setProtein] = useState(str(existing?.protein));
  const [carbs, setCarbs] = useState(str(existing?.carbs));
  const [fat, setFat] = useState(str(existing?.fat));
  const [fiber, setFiber] = useState(str(existing?.fiber));
  const [favourite, setFavourite] = useState(false);

  const saved = settings?.savedMeals ?? [];
  const q = name.trim().toLowerCase();
  const savedMatches = q.length >= 2 ? saved.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 4) : [];
  const dbMatches = q.length >= 2 ? FOOD_DB.filter((f) => f.name.toLowerCase().includes(q)).slice(0, 5) : [];

  const fill = (f: { name: string; servingSize?: string; serving?: string; calories?: number; protein?: number; carbs?: number; fat?: number; fiber?: number }) => {
    setName(f.name);
    setServing(f.servingSize ?? f.serving ?? '');
    setCalories(str(f.calories));
    setProtein(str(f.protein));
    setCarbs(str(f.carbs));
    setFat(str(f.fat));
    setFiber(str(f.fiber));
  };

  const submit = async () => {
    if (!name.trim()) {
      toast('Enter a food name');
      return;
    }
    const dup = findDuplicateMeal(data.nutrition, { id: existing?.id, eventDate: date, meal, name });
    if (dup && !(await confirmDup(`"${dup.name}" is already logged for ${meal} on ${date}. Log it again?`))) return;
    const fields = {
      eventDate: date,
      meal,
      name: name.trim(),
      servingSize: serving || undefined,
      calories: num(calories),
      protein: num(protein),
      carbs: num(carbs),
      fat: num(fat),
      fiber: num(fiber),
    };
    await save('nutrition', upsert<NutritionEntry>(existing, fields));
    if (favourite && settings && !saved.some((m) => m.name.toLowerCase() === fields.name.toLowerCase())) {
      const sm: SavedMeal = { id: uid(), name: fields.name, meal, servingSize: fields.servingSize, calories: fields.calories, protein: fields.protein, carbs: fields.carbs, fat: fields.fat, fiber: fields.fiber };
      await saveSettings({ ...settings, savedMeals: [...saved, sm] });
    }
    toast(existing ? 'Entry updated' : 'Meal logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
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
      {!existing && saved.length > 0 && q.length < 2 && (
        <Field label="Your saved meals">
          <div className="flex flex-wrap gap-1.5">
            {saved.slice(0, 8).map((m) => <Chip key={m.id} onClick={() => fill(m)}>{m.name}</Chip>)}
          </div>
        </Field>
      )}
      <Field label="Food" hint="Search your saved meals and the built-in list, or type a custom food.">
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paneer, Dal, Oats" />
      </Field>
      {(savedMatches.length > 0 || dbMatches.length > 0) && (
        <div className="card p-2 mb-3 -mt-2">
          {savedMatches.map((f) => (
            <button key={f.id} onClick={() => fill(f)} className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2 flex justify-between text-sm">
              <span>{f.name} <span className="text-muted">(saved)</span></span>
              <span className="text-muted">{f.calories ?? '–'} kcal · {f.protein ?? '–'}p</span>
            </button>
          ))}
          {dbMatches.map((f) => (
            <button key={f.name} onClick={() => fill(f)} className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2 flex justify-between text-sm">
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
        <Field label="Calories (kcal)" optional><input className="field" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} /></Field>
        <Field label="Protein (g)" optional><input className="field" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} /></Field>
        <Field label="Carbs (g)" optional><input className="field" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} /></Field>
        <Field label="Fat (g)" optional><input className="field" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} /></Field>
      </div>
      <Field label="Fibre (g)" optional><input className="field" inputMode="decimal" value={fiber} onChange={(e) => setFiber(e.target.value)} /></Field>
      {!existing && (
        <label className="flex items-center gap-2 mb-3 text-sm">
          <input type="checkbox" checked={favourite} onChange={(e) => setFavourite(e.target.checked)} /> Save as a favourite meal
        </label>
      )}
      <InfoNote>Values come from the built-in reference or your own entry. Leave a field blank if you don't know it. Blank stays blank; it is never guessed.</InfoNote>
      <div className="h-3" />
      <button className="btn-primary w-full" onClick={submit}>{existing ? 'Save changes' : 'Save meal'}</button>
    </div>
  );
}

// ── Water ───────────────────────────────────────────────────────────────────
export function LogWaterForm({ onDone }: { onDone: () => void }) {
  const { save, today, settings } = useApp();
  const toast = useToast();
  const serving = settings?.waterServingMl ?? 250;
  const [custom, setCustom] = useState('');
  const quick = [...new Set([serving, serving * 2, 500, 1000])];

  const add = async (ml: number) => {
    if (ml <= 0 || ml > 5000) {
      toast('Enter 1–5000 ml');
      return;
    }
    const rec = newRecord({ eventDate: today, source: 'manual', amountMl: ml }) as WaterEntry;
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
            {q} ml
          </button>
        ))}
      </div>
      <Field label="Custom amount (ml)">
        <div className="flex gap-2">
          <input className="field flex-1" inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="300" />
          <button className="btn-soft" onClick={() => { const n = num(custom); if (n) add(n); else toast('Enter ml'); }}>Add</button>
        </div>
      </Field>
    </div>
  );
}

// ── Weight / body ───────────────────────────────────────────────────────────
export function LogWeightForm({ onDone, existing }: { onDone: () => void; existing?: BodyRecord }) {
  const { save, today, profile, saveProfile, data } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(existing?.eventDate ?? today);
  const [weight, setWeight] = useState(str(existing?.weightKg));
  const [waist, setWaist] = useState(str(existing?.waistCm));
  const [chest, setChest] = useState(str(existing?.chestCm));
  const [arm, setArm] = useState(str(existing?.armCm));
  const [thigh, setThigh] = useState(str(existing?.thighCm));
  const [bf, setBf] = useState(str(existing?.bodyFatPct));
  const [photo, setPhoto] = useState<string | undefined>(existing?.photo);

  const onPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    downscaleImage(f, 900).then(setPhoto).catch(() => toast('Could not read that image'));
  };

  const submit = async () => {
    const w = num(weight);
    if (!w && !num(waist) && !num(chest) && !num(arm) && !num(thigh) && !photo) {
      toast('Enter at least one measurement');
      return;
    }
    if (w !== undefined && (w < 30 || w > 250)) {
      toast('Weight looks wrong (30–250 kg)');
      return;
    }
    const rec = upsert<BodyRecord>(existing, {
      eventDate: date,
      weightKg: w,
      waistCm: num(waist),
      chestCm: num(chest),
      armCm: num(arm),
      thighCm: num(thigh),
      bodyFatPct: num(bf),
      photo,
    });
    await save('body', rec);
    // Profile weight follows the most recent weigh-in by event date, not the last edit.
    if (w && profile) {
      const latest = [...data.body.filter((b) => b.id !== rec.id), rec]
        .filter((b) => b.weightKg)
        .sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
      if (latest?.weightKg && latest.weightKg !== profile.weightKg) await saveProfile({ ...profile, weightKg: latest.weightKg });
    }
    toast(existing ? 'Entry updated' : 'Body metrics logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
      <DateField value={date} onChange={setDate} />
      <Field label="Body weight (kg)">
        <input className="field text-lg" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="69.0" />
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
      <Field label="Progress photo" optional hint="Private. Stored only on this device and never shared or included in posts.">
        <input type="file" accept="image/*" onChange={onPhoto} className="text-sm text-muted" />
        {photo && (
          <div className="relative mt-2">
            <img loading="lazy" decoding="async" src={photo} className="w-full rounded-xl max-h-64 object-cover" alt="Progress photo preview" />
            <button className="absolute top-2 right-2 btn-ghost px-2 py-1 text-xs" onClick={() => setPhoto(undefined)}>Remove</button>
          </div>
        )}
      </Field>
      <button className="btn-primary w-full" onClick={submit}>{existing ? 'Save changes' : 'Save'}</button>
    </div>
  );
}

/** Downscale an image file to a JPEG data URL so photos don't bloat IndexedDB. */
export function downscaleImage(file: File, maxSide: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('bad image'));
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(reader.result as string);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ── Sleep ───────────────────────────────────────────────────────────────────
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function LogSleepForm({ onDone, existing }: { onDone: () => void; existing?: SleepRecord }) {
  const { save, today, profile, data } = useApp();
  const toast = useToast();
  const confirmDup = useConfirmDuplicate();
  // eventDate = the morning you woke up.
  const [date, setDate] = useState(existing?.eventDate ?? today);
  const [bedtime, setBedtime] = useState(existing ? hhmm(existing.bedtime) : profile?.bedtime ?? '23:00');
  const [wake, setWake] = useState(existing ? hhmm(existing.wakeTime) : profile?.wakeTime ?? '06:30');
  const [quality, setQuality] = useState(existing?.quality ?? 3);
  const [rhr, setRhr] = useState(str(existing?.restingHr));
  const [hrv, setHrv] = useState(str(existing?.hrv));

  // Wake time is on the event date. A bedtime later on the clock than the wake
  // time belongs to the previous evening; otherwise it's the same day (e.g. a nap
  // or after-midnight bedtime).
  const wakeISO = combineDateTime(date, wake);
  const bedDay = bedtime > wake ? addDays(date, -1) : date;
  const bedISO = combineDateTime(bedDay, bedtime);
  const mins = sleepMinutes(bedISO, wakeISO);
  const h = Math.floor(mins / 60);
  const m = mins % 60;

  const submit = async () => {
    if (mins <= 0 || mins > 16 * 60) {
      toast('Sleep duration looks wrong');
      return;
    }
    const other = data.sleep.find((s) => s.eventDate === date && s.id !== existing?.id);
    if (other && !(await confirmDup(`Sleep is already logged for the night ending ${date}. Add another record, for example a nap?`))) return;
    const rec = upsert<SleepRecord>(existing, {
      eventDate: date,
      bedtime: bedISO,
      wakeTime: wakeISO,
      durationMin: mins,
      quality,
      restingHr: num(rhr),
      hrv: num(hrv),
    });
    await save('sleep', rec);
    toast(existing ? 'Sleep updated' : 'Sleep logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
      <Field label="Woke up on">
        <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bedtime"><input type="time" className="field" value={bedtime} onChange={(e) => setBedtime(e.target.value)} /></Field>
        <Field label="Wake time"><input type="time" className="field" value={wake} onChange={(e) => setWake(e.target.value)} /></Field>
      </div>
      <div className="card p-3 mb-3 flex items-center justify-between">
        <span className="text-sm text-muted">Duration (handles midnight)</span>
        <span className="text-xl font-semibold text-info tabular-nums">{h}h {m.toString().padStart(2, '0')}m</span>
      </div>
      <Field label="Quality (1–5)">
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setQuality(n)} className={`flex-1 py-3 rounded-md font-semibold border transition-colors ${quality === n ? 'seg-on border-transparent' : 'border-border text-muted hover:text-foreground'}`}>{n}</button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Resting HR" optional><input className="field" inputMode="numeric" value={rhr} onChange={(e) => setRhr(e.target.value)} /></Field>
        <Field label="HRV (ms)" optional hint="From a device only."><input className="field" inputMode="numeric" value={hrv} onChange={(e) => setHrv(e.target.value)} /></Field>
      </div>
      <button className="btn-primary w-full" onClick={submit}>{existing ? 'Save changes' : 'Save sleep'}</button>
    </div>
  );
}

// ── Steps ───────────────────────────────────────────────────────────────────
export function LogStepsForm({ onDone }: { onDone: () => void }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(today);
  const existing = data.steps.find((s) => s.eventDate === date && s.source === 'manual');
  const [steps, setSteps] = useState('');
  const [distance, setDistance] = useState('');
  const [active, setActive] = useState('');

  const submit = async () => {
    const n = num(steps);
    if (n === undefined || n < 0 || n > 150000) {
      toast('Enter a step count (0–150,000)');
      return;
    }
    // One manual record per day: re-entering replaces it (audited) instead of double-counting.
    const rec = upsert<StepRecord>(existing, {
      eventDate: date,
      steps: n,
      distanceKm: num(distance),
      activeMinutes: num(active),
      dedupeKey: `manual:${date}`,
    });
    await save('steps', rec);
    toast(existing ? 'Steps updated' : 'Steps logged');
    onDone();
  };

  return (
    <div>
      <DateField value={date} onChange={setDate} />
      {existing && <div className="mb-3"><InfoNote tone="warn">You already logged {existing.steps.toLocaleString()} steps for this day. Saving replaces that number so the day isn't counted twice.</InfoNote></div>}
      <Field label="Steps">
        <input className="field text-lg" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="8000" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Distance (km)" optional><input className="field" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} /></Field>
        <Field label="Active minutes" optional><input className="field" inputMode="numeric" value={active} onChange={(e) => setActive(e.target.value)} /></Field>
      </div>
      <InfoNote>Source: <b>manual entry</b>. A web app can't read your phone's step sensor without a native integration, so steps are typed in until a device is connected.</InfoNote>
      <div className="h-3" />
      <button className="btn-primary w-full" onClick={submit}>Save steps</button>
    </div>
  );
}

// ── Recovery ────────────────────────────────────────────────────────────────
function Scale({ label, value, set }: { label: string; value: number; set: (n: number) => void }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => set(n)} className={`flex-1 py-3 rounded-md font-semibold border transition-colors ${value === n ? 'seg-on border-transparent' : 'border-border text-muted hover:text-foreground'}`}>{n}</button>
        ))}
      </div>
    </Field>
  );
}

export function LogRecoveryForm({ onDone, existing }: { onDone: () => void; existing?: RecoveryRecord }) {
  const { save, today, data } = useApp();
  const toast = useToast();
  const [date, setDate] = useState(existing?.eventDate ?? today);
  const sameDay = existing ?? data.recovery.find((r) => r.eventDate === date);
  const [fatigue, setFatigue] = useState(existing?.fatigue ?? 3);
  const [soreness, setSoreness] = useState(existing?.soreness ?? 3);
  const [motivation, setMotivation] = useState(existing?.motivation ?? 3);
  const [stress, setStress] = useState(existing?.stress ?? 3);
  const [pain, setPain] = useState(existing?.pain ?? '');

  const submit = async () => {
    // One recovery check-in per day; a second save updates it.
    const rec = upsert<RecoveryRecord>(sameDay, { eventDate: date, fatigue, soreness, motivation, stress, pain: pain || undefined });
    await save('recovery', rec);
    toast(sameDay ? 'Recovery updated' : 'Recovery logged');
    onDone();
  };

  return (
    <div>
      <EditBanner existing={existing} />
      <DateField value={date} onChange={setDate} />
      {!existing && sameDay && <div className="mb-3"><InfoNote>You've already checked in for this day. Saving updates that check-in.</InfoNote></div>}
      <Scale label="Fatigue (1 fresh – 5 exhausted)" value={fatigue} set={setFatigue} />
      <Scale label="Muscle soreness (1 none – 5 severe)" value={soreness} set={setSoreness} />
      <Scale label="Motivation (1 low – 5 high)" value={motivation} set={setMotivation} />
      <Scale label="Stress (1 low – 5 high)" value={stress} set={setStress} />
      <Field label="Pain / discomfort" optional hint="Note anything unusual. If pain persists, see a professional rather than training through it.">
        <input className="field" value={pain} onChange={(e) => setPain(e.target.value)} />
      </Field>
      <button className="btn-primary w-full" onClick={submit}>{sameDay ? 'Update recovery' : 'Save recovery'}</button>
    </div>
  );
}
