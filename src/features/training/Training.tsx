import { useMemo, useState } from 'react';
import { Activity, BedDouble, ChevronLeft, ChevronRight, Dumbbell, Flame } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { useToast } from '../../store/toast';
import { useConfirm, useConfirmDelete } from '../../store/confirm';
import { AppHeader } from '../../components/Layout';
import { Card, EmptyState, Field, Highlight, IconButton, InfoNote, SectionTitle, Segmented, Sheet } from '../../components/ui';
import { addDays, startOfWeek, startOfMonth, fmtDate, fmtDayShort, weekday } from '../../lib/dates';
import { fmtPace, fmtDuration, round1 } from '../../lib/calc';
import { plannedWeeklyKm, weeklyTargetKm } from '../../lib/plan';
import type { PlannedWorkout, PlannedExercise, PlannedRun, MuscleGroup } from '../../db/types';

type Tab = 'calendar' | 'strength' | 'hyrox' | 'runs';

export function Training() {
  const { today, profile } = useApp();
  const [tab, setTab] = useState<Tab>('calendar');
  // If today is before the plan starts, open the calendar on the first plan week.
  const anchor = profile && today < profile.trainingStartDate ? profile.trainingStartDate : today;
  const [weekStart, setWeekStart] = useState(startOfWeek(anchor));
  const [view, setView] = useState<'week' | 'month'>('week');
  const [month, setMonth] = useState(startOfMonth(anchor));

  return (
    <div>
      <AppHeader title="Training" subtitle={<>Your <Highlight>15-week plan</Highlight>, logs and history.</>} />
      <div className="mb-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'calendar', label: 'Plan' },
            { value: 'strength', label: 'Strength' },
            { value: 'hyrox', label: 'HYROX' },
            { value: 'runs', label: 'Runs' },
          ]}
        />
      </div>
      {tab === 'calendar' && (
        <>
          <div className="mb-3">
            <Segmented value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
          </div>
          {view === 'week'
            ? <WeekCalendar weekStart={weekStart} setWeekStart={setWeekStart} />
            : <MonthCalendar month={month} setMonth={setMonth} onPickWeek={(d) => { setWeekStart(startOfWeek(d)); setView('week'); }} />}
        </>
      )}
      {tab === 'strength' && <StrengthHistory />}
      {tab === 'hyrox' && <HyroxHistory />}
      {tab === 'runs' && <RunHistory />}
    </div>
  );
}

// ── Shared day status ─────────────────────────────────────────────────────────
type DayState = 'done' | 'missed' | 'deload' | 'planned' | 'rest' | 'race';

function useDayState() {
  const { data, today } = useApp();
  const loggedDays = useMemo(
    () => new Set([...data.runs, ...data.strength, ...data.hyrox].map((r) => r.eventDate)),
    [data.runs, data.strength, data.hyrox],
  );
  return (date: string, plans: PlannedWorkout[]): DayState => {
    if (loggedDays.has(date)) return 'done';
    const training = plans.filter((p) => !p.types.includes('rest'));
    if (training.some((p) => /race day/i.test(p.title))) return 'race';
    if (!training.length) return 'rest';
    if (date < today) return 'missed';
    if (training.some((p) => p.deload)) return 'deload';
    return 'planned';
  };
}

const STATE_PILL: Record<DayState, [string, string]> = {
  done: ['Done', 'border-good/40 text-good'],
  missed: ['Missed', 'border-bad/40 text-bad'],
  deload: ['Deload', 'border-info/40 text-info'],
  planned: ['Planned', 'border-border text-muted'],
  rest: ['Rest', 'border-border text-muted'],
  race: ['Race', 'border-accent/40 text-accent'],
};

// ── Week view ─────────────────────────────────────────────────────────────────
function WeekCalendar({ weekStart, setWeekStart }: { weekStart: string; setWeekStart: (s: string) => void }) {
  const { data, today } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const dayState = useDayState();

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekWorkouts = data.plannedWorkouts.filter((w) => days.includes(w.eventDate));
  const weekNum = weekWorkouts.find((w) => w.source === 'seed')?.weekIndex ?? weekWorkouts[0]?.weekIndex;
  const phase = weekWorkouts[0]?.phase;
  const plannedKm = plannedWeeklyKm(weekWorkouts);
  const targetKm = weekNum ? weeklyTargetKm(weekNum) : 0;
  const actualKm = round1(data.runs.filter((r) => days.includes(r.eventDate)).reduce((a, r) => a + r.distanceKm, 0));
  const kmMismatch = targetKm > 0 && Math.abs(plannedKm - targetKm) > 2;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <IconButton label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" aria-hidden /></IconButton>
        <div className="text-center">
          <div className="font-semibold text-sm">{weekNum ? `Week ${weekNum} · ${phase}` : fmtDate(weekStart)}</div>
          <div className="text-xs text-muted">{fmtDate(weekStart, { month: 'short' })} – {fmtDate(addDays(weekStart, 6), { month: 'short' })}</div>
        </div>
        <IconButton label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" aria-hidden /></IconButton>
      </div>

      {weekNum ? (
        <Card className="mb-3">
          <div className="grid grid-cols-3 text-center">
            <div><div className="text-xs text-muted">Planned</div><div className="font-semibold tabular-nums">{plannedKm} km</div></div>
            <div><div className="text-xs text-muted">Target</div><div className="font-semibold tabular-nums">{targetKm} km</div></div>
            <div><div className="text-xs text-muted">Actual</div><div className="font-montserrat font-semibold tabular-nums">{actualKm} km</div></div>
          </div>
          {kmMismatch && <div className="mt-2"><InfoNote tone="warn">The planned daily runs add up to {plannedKm} km, but this week's target is {targetKm} km. Adjust the sessions if you want them to match. No runs are added automatically.</InfoNote></div>}
        </Card>
      ) : (
        <Card className="mb-3 text-sm text-muted">No planned sessions this week: it's outside your plan window.</Card>
      )}

      <div className="space-y-2">
        {days.map((date) => {
          const plans = data.plannedWorkouts.filter((x) => x.eventDate === date);
          const st = dayState(date, plans);
          const isToday = date === today;
          return (
            <button key={date} onClick={() => setSelected(date)} className={`card p-3 w-full text-left flex items-center gap-3 active:scale-[0.99] transition ${isToday ? 'border-accent/60' : ''}`}>
              <div className="w-11 text-center shrink-0">
                <div className="text-[10px] uppercase text-muted font-semibold">{fmtDayShort(date)}</div>
                <div className={`text-lg font-semibold ${isToday ? 'text-accent' : ''}`}>{Number(date.slice(-2))}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{plans[0]?.title ?? 'No session'}{plans.length > 1 ? ` +${plans.length - 1}` : ''}</div>
                <div className="text-xs text-muted truncate">{plans[0]?.focus ?? '–'}{plans.some((p) => p.source === 'manual') ? ' · edited' : ''}</div>
              </div>
              <span className={`pill shrink-0 ${STATE_PILL[st][1]}`}>{STATE_PILL[st][0]}</span>
            </button>
          );
        })}
      </div>

      <DaySheet date={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────
function MonthCalendar({ month, setMonth, onPickWeek }: { month: string; setMonth: (m: string) => void; onPickWeek: (d: string) => void }) {
  const { data, today } = useApp();
  const dayState = useDayState();
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = weekday(month) - 1; // Monday-first grid
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => addDays(month, i)),
  ];
  const shiftMonth = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
  };

  const monthDays = cells.filter((c): c is string => !!c);
  const plannedKm = round1(data.plannedWorkouts.filter((w) => monthDays.includes(w.eventDate)).reduce((a, w) => a + w.runs.reduce((s, r) => s + (r.distanceKm ?? 0), 0), 0));
  const actualKm = round1(data.runs.filter((r) => monthDays.includes(r.eventDate)).reduce((a, r) => a + r.distanceKm, 0));
  const counts = monthDays.reduce<Record<DayState, number>>((acc, d) => {
    const s = dayState(d, data.plannedWorkouts.filter((p) => p.eventDate === d));
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, { done: 0, missed: 0, deload: 0, planned: 0, rest: 0, race: 0 });

  const dot: Record<DayState, string> = {
    done: 'bg-good', missed: 'bg-bad', deload: 'bg-info', planned: 'bg-muted/60', rest: 'bg-transparent', race: 'bg-highlight',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <IconButton label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" aria-hidden /></IconButton>
        <div className="font-semibold text-sm">{fmtDate(month, { day: undefined, month: 'long', year: 'numeric' })}</div>
        <IconButton label="Next month" onClick={() => shiftMonth(1)}><ChevronRight className="h-4 w-4" aria-hidden /></IconButton>
      </div>
      <Card className="mb-3">
        <div className="grid grid-cols-7 text-center text-[10px] text-muted font-semibold mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const st = dayState(d, data.plannedWorkouts.filter((p) => p.eventDate === d));
            return (
              <button key={d} onClick={() => onPickWeek(d)} className={`aspect-square rounded-lg flex flex-col items-center justify-center text-xs ${d === today ? 'border border-highlight/50 text-highlight font-semibold' : 'border border-transparent bg-secondary/60'}`}>
                <span>{Number(d.slice(-2))}</span>
                <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${dot[st]}`} />
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 text-[10px] text-muted">
          <span><span className="inline-block w-2 h-2 rounded-full bg-good mr-1" />done {counts.done}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-bad mr-1" />missed {counts.missed}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-muted/60 mr-1" />planned {counts.planned}</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-info mr-1" />deload {counts.deload}</span>
          {counts.race > 0 && <span><span className="inline-block w-2 h-2 rounded-full bg-highlight mr-1" />race</span>}
        </div>
      </Card>
      <Card className="mb-3">
        <div className="grid grid-cols-2 text-center">
          <div><div className="text-xs text-muted">Planned this month</div><div className="font-semibold tabular-nums">{plannedKm} km</div></div>
          <div><div className="text-xs text-muted">Actual this month</div><div className="font-montserrat font-semibold tabular-nums">{actualKm} km</div></div>
        </div>
      </Card>
      <p className="text-xs text-muted text-center">Tap a day to open its week.</p>
    </div>
  );
}

// ── Day sheet (one or more planned sessions) ──────────────────────────────────
function DaySheet({ date, onClose }: { date: string | null; onClose: () => void }) {
  const { data } = useApp();
  const plans = date ? data.plannedWorkouts.filter((w) => w.eventDate === date) : [];
  return (
    <Sheet open={!!date} onClose={onClose} title={date ? fmtDate(date, { weekday: 'long' }) : ''}>
      {plans.length === 0
        ? <EmptyState title="No planned session" hint="This is a rest day or outside the plan. You can still log any activity with the + button." icon={BedDouble} />
        : plans.map((p, i) => (
          <div key={p.id} className={i > 0 ? 'mt-6 pt-6 border-t border-line' : ''}>
            <PlanDetail plan={p} onClose={onClose} />
          </div>
        ))}
    </Sheet>
  );
}

function PlanDetail({ plan, onClose }: { plan: PlannedWorkout; onClose: () => void }) {
  const log = useLog();
  const { save, remove, data } = useApp();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState<'view' | 'reschedule' | 'edit'>('view');
  const [newDate, setNewDate] = useState(plan.eventDate);

  const logged =
    data.runs.filter((r) => r.eventDate === plan.eventDate).length +
    data.strength.filter((r) => r.eventDate === plan.eventDate).length +
    data.hyrox.filter((r) => r.eventDate === plan.eventDate).length;

  const doReschedule = async () => {
    if (newDate === plan.eventDate) { setMode('view'); return; }
    const clash = data.plannedWorkouts.find((w) => w.eventDate === newDate && w.id !== plan.id && !w.types.includes('rest'));
    if (clash && !(await confirm({ title: 'That day already has a session', description: `${fmtDate(newDate)} already has "${clash.title}". Both sessions will be planned on that day.`, confirmLabel: 'Move anyway', cancelLabel: 'Pick another day' }))) return;
    await save('plannedWorkouts', { ...plan, eventDate: newDate, source: 'manual' });
    toast(`Moved to ${fmtDate(newDate)}`);
    onClose();
  };
  const removeSession = async () => {
    if (!(await confirm({ title: 'Remove this planned session?', description: `"${plan.title}" will be taken off ${fmtDate(plan.eventDate)}. Workouts you've already logged are not affected.`, confirmLabel: 'Remove session', tone: 'danger' }))) return;
    await remove('plannedWorkouts', plan.id);
    toast('Session removed');
    onClose();
  };

  if (mode === 'edit') return <EditPrescription plan={plan} onDone={() => setMode('view')} />;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="pill border-accent/40 text-accent">Week {plan.weekIndex}</span>
        <span className="pill border-border text-muted">{plan.phase}</span>
        {plan.deload && <span className="pill border-info/40 text-info">Deload</span>}
        {plan.source === 'manual' && <span className="pill border-warn/40 text-warn">Edited by you</span>}
        {logged > 0 && <span className="pill border-good/40 text-good">Logged</span>}
      </div>
      <h3 className="text-lg font-semibold">{plan.title}</h3>
      <p className="text-sm text-muted">{plan.focus}</p>
      {plan.description && <p className="text-sm mt-2">{plan.description}</p>}

      {plan.warmup && <Block title="Warm-up">{plan.warmup}</Block>}

      {plan.runs.length > 0 && (
        <div className="mt-4">
          <div className="label">Running</div>
          {plan.runs.map((r, i) => (
            <Card key={i} className="mb-2">
              <div className="flex justify-between">
                <span className="font-semibold capitalize">{r.kind} run</span>
                {r.targetRPE && <span className="pill border-border text-muted">RPE {r.targetRPE}</span>}
              </div>
              <div className="text-sm text-muted mt-0.5">{r.distanceKm ? `${r.distanceKm} km` : ''}{r.durationMin ? ` · ${r.durationMin} min` : ''}</div>
              {r.description && <div className="text-xs text-muted mt-1">{r.description}</div>}
            </Card>
          ))}
        </div>
      )}

      {plan.exercises.length > 0 && (
        <div className="mt-4">
          <div className="label">Strength</div>
          {plan.exercises.map((e, i) => (
            <div key={i} className="card p-3 mb-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm">{e.name}</span>
                <span className="text-sm tabular-nums">{e.sets} × {e.reps}</span>
              </div>
              <div className="text-xs text-muted mt-0.5">{e.group} · RPE {e.targetRPE ?? '-'} · rest {e.restSec ?? '-'}s</div>
              {e.instructions && <div className="text-xs text-muted mt-1">{e.instructions}</div>}
            </div>
          ))}
        </div>
      )}

      {plan.hyroxStations.length > 0 && (
        <div className="mt-4">
          <div className="label">HYROX conditioning</div>
          {plan.hyroxStations.map((s, i) => (
            <div key={i} className="card p-3 mb-2">
              <div className="flex justify-between">
                <span className="font-semibold text-sm">{s.station}</span>
                <span className="text-sm">{s.target}{s.loadKg ? ` · ${s.loadKg} kg` : ''}</span>
              </div>
              {s.notes && <div className="text-xs text-muted mt-1">{s.notes}</div>}
            </div>
          ))}
        </div>
      )}

      {plan.cooldown && <Block title="Cool-down">{plan.cooldown}</Block>}

      <div className="grid grid-cols-2 gap-2 mt-5">
        {plan.runs.length > 0 && <button className="btn-soft" onClick={() => log('run', plan)}>Log run</button>}
        {plan.exercises.length > 0 && <button className="btn-ghost py-2.5 text-sm" onClick={() => log('strength', plan)}>Log sets</button>}
        {plan.hyroxStations.length > 0 && <button className="btn-ghost py-2.5 text-sm" onClick={() => log('hyrox', plan)}>Log HYROX</button>}
      </div>

      {mode === 'reschedule' ? (
        <Card className="mt-2">
          <Field label="Move session to"><input type="date" className="field" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></Field>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 py-2" onClick={() => setMode('view')}>Cancel</button>
            <button className="btn-soft flex-1" onClick={doReschedule}>Confirm move</button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-2 mt-2">
          <button className="btn-ghost py-2.5 text-sm" onClick={() => setMode('edit')}>Edit</button>
          <button className="btn-ghost py-2.5 text-sm" onClick={() => setMode('reschedule')}>Move</button>
          <button className="btn-ghost py-2.5 text-sm text-bad" onClick={removeSession}>Remove</button>
        </div>
      )}
      <div className="text-[11px] text-muted mt-3">Planned and logged workouts are stored separately. Editing, moving or removing a plan never changes a workout you've already logged.</div>
    </div>
  );
}

const GROUPS: MuscleGroup[] = ['legs', 'abs', 'chest', 'triceps', 'back', 'biceps', 'delts', 'core', 'fullbody'];

function EditPrescription({ plan, onDone }: { plan: PlannedWorkout; onDone: () => void }) {
  const { save } = useApp();
  const toast = useToast();
  const [title, setTitle] = useState(plan.title);
  const [runs, setRuns] = useState<PlannedRun[]>(plan.runs.map((r) => ({ ...r })));
  const [exs, setExs] = useState<PlannedExercise[]>(plan.exercises.map((e) => ({ ...e })));

  const updRun = (i: number, patch: Partial<PlannedRun>) => setRuns((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updEx = (i: number, patch: Partial<PlannedExercise>) => setExs((p) => p.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const n = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? undefined : Number(v));

  const submit = async () => {
    const cleanEx = exs.filter((e) => e.name.trim());
    if (cleanEx.some((e) => !e.sets || e.sets < 1 || e.sets > 20)) { toast('Sets must be 1–20'); return; }
    if (runs.some((r) => r.distanceKm !== undefined && (r.distanceKm <= 0 || r.distanceKm > 100))) { toast('Run distance must be 0–100 km'); return; }
    await save('plannedWorkouts', {
      ...plan,
      title: title.trim() || plan.title,
      runs: runs.map((r) => ({ ...r, distanceKm: r.distanceKm !== undefined ? round1(r.distanceKm) : undefined })),
      exercises: cleanEx,
      source: 'manual',
    });
    toast('Prescription updated');
    onDone();
  };

  return (
    <div>
      <InfoNote>Edits apply to this day only. "Regenerate plan" keeps days you've edited.</InfoNote>
      <div className="h-3" />
      <Field label="Session title"><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      {runs.length > 0 && <div className="label">Runs</div>}
      {runs.map((r, i) => (
        <div key={i} className="card p-3 mb-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <span className="text-sm capitalize">{r.kind}</span>
          <input className="field py-2 text-sm" inputMode="decimal" placeholder="km" value={r.distanceKm ?? ''} onChange={(e) => updRun(i, { distanceKm: n(e.target.value) })} />
          <input className="field py-2 text-sm" inputMode="numeric" placeholder="RPE" value={r.targetRPE ?? ''} onChange={(e) => updRun(i, { targetRPE: n(e.target.value) })} />
          <button className="text-muted" onClick={() => setRuns((p) => p.filter((_, j) => j !== i))} aria-label="Remove run">×</button>
        </div>
      ))}
      <div className="label mt-3">Exercises</div>
      {exs.map((e, i) => (
        <div key={i} className="card p-3 mb-2">
          <div className="flex gap-2 mb-2">
            <input className="field py-2 text-sm flex-1" value={e.name} placeholder="Exercise" onChange={(ev) => updEx(i, { name: ev.target.value })} />
            <button className="text-muted px-2" onClick={() => setExs((p) => p.filter((_, j) => j !== i))} aria-label="Remove exercise">×</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className="field py-2 text-sm" inputMode="numeric" placeholder="sets" value={e.sets} onChange={(ev) => updEx(i, { sets: n(ev.target.value) ?? 0 })} />
            <input className="field py-2 text-sm" placeholder="reps" value={e.reps} onChange={(ev) => updEx(i, { reps: ev.target.value })} />
            <input className="field py-2 text-sm" inputMode="numeric" placeholder="RPE" value={e.targetRPE ?? ''} onChange={(ev) => updEx(i, { targetRPE: n(ev.target.value) })} />
          </div>
          <select className="field py-2 text-sm mt-2" value={e.group} onChange={(ev) => updEx(i, { group: ev.target.value as MuscleGroup })}>
            {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      ))}
      <button className="btn-ghost w-full mb-3 py-2 text-sm" onClick={() => setExs((p) => [...p, { name: '', group: 'fullbody', sets: 3, reps: '8-10', targetRPE: 7, restSec: 90 }])}>+ Add exercise</button>
      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onDone}>Cancel</button>
        <button className="btn-primary flex-1" onClick={submit}>Save prescription</button>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 card p-3">
      <div className="mb-1 text-sm font-medium text-foreground/80">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-3 shrink-0">
      <button className="link" onClick={onEdit}>Edit</button>
      <button className="text-muted text-xs" onClick={onDelete}>Delete</button>
    </div>
  );
}

// ── Strength history ──────────────────────────────────────────────────────────
function StrengthHistory() {
  const { data, remove } = useApp();
  const log = useLog();
  const confirmDelete = useConfirmDelete();
  const sessions = [...data.strength].sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  // Heaviest set per exercise (ties broken by reps).
  const prs = useMemo(() => {
    const map = new Map<string, { weight: number; reps: number; date: string }>();
    for (const s of data.strength) {
      for (const e of s.exercises) {
        for (const st of e.sets) {
          if (!st.weightKg) continue;
          const cur = map.get(e.name);
          if (!cur || st.weightKg > cur.weight || (st.weightKg === cur.weight && (st.reps ?? 0) > cur.reps)) {
            map.set(e.name, { weight: st.weightKg, reps: st.reps ?? 0, date: s.eventDate });
          }
        }
      }
    }
    return [...map.entries()].sort((a, b) => b[1].weight - a[1].weight);
  }, [data.strength]);

  if (!sessions.length) return <EmptyState title="No strength sessions yet" hint="Log gym sets from the + button or from a planned day." icon={Dumbbell} />;

  return (
    <div>
      {prs.length > 0 && (
        <>
          <SectionTitle>Personal records (heaviest set)</SectionTitle>
          <Card className="mb-3 divide-y divide-line">
            {prs.slice(0, 8).map(([name, pr]) => (
              <div key={name} className="flex justify-between py-2 text-sm first:pt-0 last:pb-0">
                <span>{name}</span>
                <span className="font-semibold tabular-nums">{pr.weight} kg × {pr.reps} <span className="text-muted font-normal">· {fmtDate(pr.date)}</span></span>
              </div>
            ))}
          </Card>
        </>
      )}
      <SectionTitle>History</SectionTitle>
      <div className="space-y-2">
        {sessions.map((s) => {
          const vol = s.exercises.reduce((a, e) => a + e.sets.reduce((x, st) => x + (st.weightKg ?? 0) * (st.reps ?? 0), 0), 0);
          return (
            <Card key={s.id}>
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold text-sm">{s.title}</div>
                  <div className="text-xs text-muted">{fmtDate(s.eventDate)} · {s.exercises.length} exercises · volume {Math.round(vol).toLocaleString()} kg</div>
                </div>
                <RowActions onEdit={() => log('strength', { existing: s })} onDelete={async () => { if (await confirmDelete(`"${s.title}" from ${fmtDate(s.eventDate)}`)) remove('strength', s.id); }} />
              </div>
              <div className="mt-2 space-y-1">
                {s.exercises.map((e, i) => (
                  <div key={i} className="text-xs text-muted">
                    <span className="text-text font-medium">{e.name}</span>: {e.sets.map((st) => `${st.reps ?? '-'}×${st.weightKg ?? '-'}kg`).join(', ')}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── HYROX history ─────────────────────────────────────────────────────────────
function HyroxHistory() {
  const { data, remove } = useApp();
  const log = useLog();
  const confirmDelete = useConfirmDelete();
  const sessions = [...data.hyrox].sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  const bests = useMemo(() => {
    const map = new Map<string, { timeSec: number; date: string; loadKg?: number; amount?: string }>();
    for (const h of data.hyrox) for (const st of h.stations) {
      if (st.timeSec === undefined) continue;
      const cur = map.get(st.station);
      if (!cur || st.timeSec < cur.timeSec) {
        map.set(st.station, {
          timeSec: st.timeSec,
          date: h.eventDate,
          loadKg: st.loadKg,
          amount: st.reps !== undefined ? `${st.reps} reps` : st.distanceM !== undefined ? `${st.distanceM} m` : undefined,
        });
      }
    }
    return [...map.entries()];
  }, [data.hyrox]);

  if (!sessions.length) return <EmptyState title="No HYROX sessions yet" hint="Log a station circuit, combo or simulation from the + button." icon={Flame} />;

  return (
    <div>
      {bests.length > 0 && (
        <>
          <SectionTitle>Best station times</SectionTitle>
          <Card className="mb-3 divide-y divide-line">
            {bests.map(([station, b]) => (
              <div key={station} className="py-2 text-sm first:pt-0 last:pb-0">
                <div className="flex justify-between">
                  <span>{station}</span>
                  <span className="font-semibold tabular-nums">{fmtDuration(b.timeSec)}</span>
                </div>
                <div className="text-xs text-muted">{[b.amount, b.loadKg ? `${b.loadKg} kg` : undefined, fmtDate(b.date)].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </Card>
          <InfoNote>Times are only comparable when distance or reps and load match. Check the detail line under each best.</InfoNote>
          <div className="h-3" />
        </>
      )}
      <SectionTitle>Sessions</SectionTitle>
      <div className="space-y-2">
        {sessions.map((h) => (
          <Card key={h.id}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="font-semibold text-sm">{h.title} <span className="pill border-border text-muted ml-1">{h.mode}</span></div>
                <div className="text-xs text-muted">{fmtDate(h.eventDate)} · {h.stations.length} stations</div>
              </div>
              <RowActions onEdit={() => log('hyrox', { existing: h })} onDelete={async () => { if (await confirmDelete(`"${h.title}" from ${fmtDate(h.eventDate)}`)) remove('hyrox', h.id); }} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {h.stations.map((s, i) => (
                <div key={i} className="text-xs text-muted">
                  <span className="text-text">{s.station}</span>: {s.timeSec !== undefined ? fmtDuration(s.timeSec) : '–'}{s.reps ? ` · ${s.reps} reps` : ''}{s.distanceM ? ` · ${s.distanceM} m` : ''}{s.loadKg ? ` · ${s.loadKg} kg` : ''}{s.breaks ? ` · ${s.breaks} breaks` : ''}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Run history ───────────────────────────────────────────────────────────────
function RunHistory() {
  const { data, remove } = useApp();
  const log = useLog();
  const confirmDelete = useConfirmDelete();
  const runs = [...data.runs].sort((a, b) => b.eventDate.localeCompare(a.eventDate) || b.createdAt.localeCompare(a.createdAt));

  const weeks = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data.runs) {
      const ws = startOfWeek(r.eventDate);
      map.set(ws, (map.get(ws) ?? 0) + r.distanceKm);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [data.runs]);

  if (!runs.length) return <EmptyState title="No runs logged yet" hint="Log your first run from the + button." icon={Activity} />;

  return (
    <div>
      <SectionTitle>Weekly distance</SectionTitle>
      <Card className="mb-3 divide-y divide-line">
        {weeks.map(([ws, km]) => (
          <div key={ws} className="flex justify-between py-2 text-sm first:pt-0 last:pb-0">
            <span className="text-muted">Week of {fmtDate(ws)}</span>
            <span className="font-semibold tabular-nums">{round1(km)} km</span>
          </div>
        ))}
      </Card>
      <SectionTitle>All runs</SectionTitle>
      <div className="space-y-2">
        {runs.map((r) => (
          <Card key={r.id}>
            <div className="flex justify-between items-center gap-2">
              <div>
                <div className="font-semibold text-sm capitalize">{r.kind} run · {r.distanceKm} km</div>
                <div className="text-xs text-muted">{fmtDate(r.eventDate)} · {fmtDuration(r.durationSec)} · {fmtPace(r.avgPaceSecPerKm)}/km{r.rpe ? ` · RPE ${r.rpe}` : ''}</div>
              </div>
              <RowActions onEdit={() => log('run', { existing: r })} onDelete={async () => { if (await confirmDelete(`the ${r.distanceKm} km ${r.kind} run from ${fmtDate(r.eventDate)}`)) remove('runs', r.id); }} />
            </div>
            {r.notes && <div className="text-xs text-muted mt-1">{r.notes}</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}
