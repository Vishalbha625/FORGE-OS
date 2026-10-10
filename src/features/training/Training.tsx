import { useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { useToast } from '../../store/toast';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Segmented, Sheet, EmptyState, InfoNote, Field } from '../../components/ui';
import { addDays, startOfWeek, fmtDate, fmtDayShort } from '../../lib/dates';
import { fmtPace, fmtDuration, round1 } from '../../lib/calc';
import { plannedWeeklyKm, weeklyTargetKm } from '../../lib/plan';
import type { PlannedWorkout } from '../../db/types';

type Tab = 'calendar' | 'strength' | 'hyrox' | 'runs';

export function Training() {
  const { today, profile } = useApp();
  const [tab, setTab] = useState<Tab>('calendar');
  // If today is before the plan starts, open the calendar on the first plan week.
  const initialWeek = profile && today < profile.trainingStartDate
    ? startOfWeek(profile.trainingStartDate)
    : startOfWeek(today);
  const [weekStart, setWeekStart] = useState(initialWeek);

  return (
    <div>
      <AppHeader title="Training" subtitle="Plan, log and review" />
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
      {tab === 'calendar' && <Calendar weekStart={weekStart} setWeekStart={setWeekStart} />}
      {tab === 'strength' && <StrengthHistory />}
      {tab === 'hyrox' && <HyroxHistory />}
      {tab === 'runs' && <RunHistory />}
    </div>
  );
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function Calendar({ weekStart, setWeekStart }: { weekStart: string; setWeekStart: (s: string) => void }) {
  const { data, today } = useApp();
  const [selected, setSelected] = useState<string | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekWorkouts = useMemo(
    () => data.plannedWorkouts.filter((w) => days.includes(w.eventDate)),
    [data.plannedWorkouts, weekStart],
  );
  const weekNum = weekWorkouts[0]?.weekIndex;
  const phase = weekWorkouts[0]?.phase;
  const plannedKm = plannedWeeklyKm(weekWorkouts);
  const targetKm = weekNum ? weeklyTargetKm(weekNum) : 0;
  const actualKm = round1(data.runs.filter((r) => days.includes(r.eventDate)).reduce((a, r) => a + r.distanceKm, 0));
  const kmMismatch = targetKm > 0 && Math.abs(plannedKm - targetKm) > 2;

  const logged = (date: string) =>
    data.runs.some((r) => r.eventDate === date) ||
    data.strength.some((r) => r.eventDate === date) ||
    data.hyrox.some((r) => r.eventDate === date);

  const selectedPlan = selected ? data.plannedWorkouts.find((w) => w.eventDate === selected) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button className="btn-ghost px-3 py-2" onClick={() => setWeekStart(addDays(weekStart, -7))}>‹</button>
        <div className="text-center">
          <div className="font-bold text-sm">{weekNum ? `Week ${weekNum} · ${phase}` : fmtDate(weekStart)}</div>
          <div className="text-xs text-muted">{fmtDate(weekStart, { month: 'short' })} – {fmtDate(addDays(weekStart, 6), { month: 'short' })}</div>
        </div>
        <button className="btn-ghost px-3 py-2" onClick={() => setWeekStart(addDays(weekStart, 7))}>›</button>
      </div>

      {weekNum ? (
        <Card className="mb-3">
          <div className="grid grid-cols-3 text-center">
            <div><div className="text-xs text-muted">Planned</div><div className="font-extrabold tabular-nums">{plannedKm} km</div></div>
            <div><div className="text-xs text-muted">Target</div><div className="font-extrabold tabular-nums">{targetKm} km</div></div>
            <div><div className="text-xs text-muted">Actual</div><div className="font-extrabold tabular-nums text-accent">{actualKm} km</div></div>
          </div>
          {kmMismatch && <div className="mt-2"><InfoNote tone="warn">Planned daily runs ({plannedKm} km) differ from the weekly target ({targetKm} km). Adjust prescriptions if needed — nothing is auto-invented.</InfoNote></div>}
        </Card>
      ) : (
        <Card className="mb-3 text-sm text-muted">No planned sessions this week (outside your plan window). Use Profile → Regenerate plan if needed.</Card>
      )}

      <div className="space-y-2">
        {days.map((date) => {
          const w = data.plannedWorkouts.find((x) => x.eventDate === date);
          const isToday = date === today;
          const done = logged(date);
          const past = date < today;
          const missed = past && w && !w.types.includes('rest') && !done;
          return (
            <button key={date} onClick={() => setSelected(date)} className={`card p-3 w-full text-left flex items-center gap-3 active:scale-[0.99] transition ${isToday ? 'border-accent/60' : ''}`}>
              <div className="w-11 text-center shrink-0">
                <div className="text-[10px] uppercase text-muted font-semibold">{fmtDayShort(date)}</div>
                <div className={`text-lg font-extrabold ${isToday ? 'text-accent' : ''}`}>{Number(date.slice(-2))}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{w ? w.title : 'No session'}</div>
                <div className="text-xs text-muted truncate">{w ? w.focus : '—'}</div>
              </div>
              <div className="shrink-0">
                {done ? <span className="pill bg-good/15 text-good">Done</span>
                  : missed ? <span className="pill bg-bad/15 text-bad">Missed</span>
                  : w?.deload ? <span className="pill bg-info/15 text-info">Deload</span>
                  : w && !w.types.includes('rest') ? <span className="pill bg-surface-2 text-muted">Planned</span>
                  : <span className="pill bg-surface-2 text-muted">Rest</span>}
              </div>
            </button>
          );
        })}
      </div>

      <Sheet open={!!selected} onClose={() => setSelected(null)} title={selectedPlan ? fmtDate(selected!, { weekday: 'long' }) : fmtDate(selected ?? today)}>
        {selectedPlan ? <PlanDetail plan={selectedPlan} onClose={() => setSelected(null)} /> : <EmptyState title="No planned session" hint="This is a rest day or outside the plan. You can still log any activity." icon="🛌" />}
      </Sheet>
    </div>
  );
}

function PlanDetail({ plan, onClose }: { plan: PlannedWorkout; onClose: () => void }) {
  const log = useLog();
  const { save, remove, data } = useApp();
  const toast = useToast();
  const [reschedule, setReschedule] = useState(false);
  const [newDate, setNewDate] = useState(plan.eventDate);

  const logged =
    data.runs.filter((r) => r.eventDate === plan.eventDate).length +
    data.strength.filter((r) => r.eventDate === plan.eventDate).length +
    data.hyrox.filter((r) => r.eventDate === plan.eventDate).length;

  const doReschedule = async () => {
    if (newDate === plan.eventDate) { setReschedule(false); return; }
    await save('plannedWorkouts', { ...plan, eventDate: newDate, source: 'manual' });
    toast(`Moved to ${fmtDate(newDate)}`);
    onClose();
  };
  const skipDay = async () => {
    if (!confirm('Mark this day as rest / remove the planned session?')) return;
    await remove('plannedWorkouts', plan.id);
    toast('Session removed');
    onClose();
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="pill bg-accent/15 text-accent">Week {plan.weekIndex}</span>
        <span className="pill bg-surface-2 text-muted">{plan.phase}</span>
        {plan.deload && <span className="pill bg-info/15 text-info">Deload</span>}
        {logged > 0 && <span className="pill bg-good/15 text-good">Logged</span>}
      </div>
      <h3 className="text-lg font-extrabold">{plan.title}</h3>
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
                {r.targetRPE && <span className="pill bg-surface-2 text-muted">RPE {r.targetRPE}</span>}
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
              {e.instructions && <div className="text-xs text-muted mt-1">💡 {e.instructions}</div>}
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

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 mt-5">
        {plan.runs.length > 0 && <button className="btn-primary py-2.5 text-sm" onClick={() => log('run', plan)}>Log run</button>}
        {plan.exercises.length > 0 && <button className="btn-ghost py-2.5 text-sm" onClick={() => log('strength', plan)}>Log sets</button>}
        {plan.hyroxStations.length > 0 && <button className="btn-ghost py-2.5 text-sm" onClick={() => log('hyrox', plan)}>Log HYROX</button>}
      </div>

      {!reschedule ? (
        <div className="flex gap-2 mt-2">
          <button className="btn-ghost flex-1 py-2.5 text-sm" onClick={() => setReschedule(true)}>Reschedule</button>
          <button className="btn-ghost flex-1 py-2.5 text-sm text-bad" onClick={skipDay}>Remove</button>
        </div>
      ) : (
        <Card className="mt-2">
          <Field label="Move session to"><input type="date" className="field" value={newDate} onChange={(e) => setNewDate(e.target.value)} /></Field>
          <div className="flex gap-2">
            <button className="btn-ghost flex-1 py-2" onClick={() => setReschedule(false)}>Cancel</button>
            <button className="btn-primary flex-1 py-2" onClick={doReschedule}>Confirm move</button>
          </div>
        </Card>
      )}
      <div className="text-[11px] text-muted mt-3">Logging keeps planned and actual data separate. Rescheduling or removing never deletes past completed workouts.</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 card p-3">
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">{title}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

// ── Strength history ──────────────────────────────────────────────────────────
function StrengthHistory() {
  const { data, remove } = useApp();
  const sessions = [...data.strength].sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  // PRs per exercise
  const prs = useMemo(() => {
    const map = new Map<string, { weight: number; reps: number; date: string }>();
    for (const s of data.strength) {
      for (const e of s.exercises) {
        for (const st of e.sets) {
          if (!st.weightKg) continue;
          const cur = map.get(e.name);
          if (!cur || st.weightKg > cur.weight) map.set(e.name, { weight: st.weightKg, reps: st.reps ?? 0, date: s.eventDate });
        }
      }
    }
    return [...map.entries()].sort((a, b) => b[1].weight - a[1].weight);
  }, [data.strength]);

  if (!sessions.length) return <EmptyState title="No strength sessions yet" hint="Log gym sets from the + button or a planned day." icon="🏋️" />;

  return (
    <div>
      {prs.length > 0 && (
        <>
          <SectionTitle>Personal records</SectionTitle>
          <Card className="mb-3 divide-y divide-line">
            {prs.slice(0, 8).map(([name, pr]) => (
              <div key={name} className="flex justify-between py-2 text-sm first:pt-0 last:pb-0">
                <span>{name}</span>
                <span className="font-bold tabular-nums">{pr.weight} kg × {pr.reps} <span className="text-muted font-normal">· {fmtDate(pr.date)}</span></span>
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
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-semibold text-sm">{s.title}</div>
                  <div className="text-xs text-muted">{fmtDate(s.eventDate)} · {s.exercises.length} exercises · vol {Math.round(vol).toLocaleString()} kg</div>
                </div>
                <button className="text-muted text-xs" onClick={() => { if (confirm('Delete this session?')) remove('strength', s.id); }}>Delete</button>
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
  const sessions = [...data.hyrox].sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  const bests = useMemo(() => {
    const map = new Map<string, { timeSec: number; date: string }>();
    for (const h of data.hyrox) for (const st of h.stations) {
      if (st.timeSec === undefined) continue;
      const cur = map.get(st.station);
      if (!cur || st.timeSec < cur.timeSec) map.set(st.station, { timeSec: st.timeSec, date: h.eventDate });
    }
    return [...map.entries()];
  }, [data.hyrox]);

  if (!sessions.length) return <EmptyState title="No HYROX sessions yet" hint="Log a station circuit, combo or simulation from the + button." icon="🔥" />;

  return (
    <div>
      {bests.length > 0 && (
        <>
          <SectionTitle>Best station times</SectionTitle>
          <Card className="mb-3 divide-y divide-line">
            {bests.map(([station, b]) => (
              <div key={station} className="flex justify-between py-2 text-sm first:pt-0 last:pb-0">
                <span>{station}</span>
                <span className="font-bold tabular-nums">{fmtDuration(b.timeSec)} <span className="text-muted font-normal">· {fmtDate(b.date)}</span></span>
              </div>
            ))}
          </Card>
        </>
      )}
      <SectionTitle>Sessions</SectionTitle>
      <div className="space-y-2">
        {sessions.map((h) => (
          <Card key={h.id}>
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold text-sm">{h.title} <span className="pill bg-surface-2 text-muted ml-1">{h.mode}</span></div>
                <div className="text-xs text-muted">{fmtDate(h.eventDate)} · {h.stations.length} stations</div>
              </div>
              <button className="text-muted text-xs" onClick={() => { if (confirm('Delete this session?')) remove('hyrox', h.id); }}>Delete</button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              {h.stations.map((s, i) => (
                <div key={i} className="text-xs text-muted">
                  <span className="text-text">{s.station}</span>: {s.timeSec ? fmtDuration(s.timeSec) : '—'}{s.reps ? ` ${s.reps}r` : ''}{s.loadKg ? ` ${s.loadKg}kg` : ''}
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
  const runs = [...data.runs].sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  // Group by ISO week for weekly totals
  const weeks = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data.runs) {
      const ws = startOfWeek(r.eventDate);
      map.set(ws, (map.get(ws) ?? 0) + r.distanceKm);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [data.runs]);

  if (!runs.length) return <EmptyState title="No runs logged yet" hint="Log your first run from the + button." icon="🏃" />;

  return (
    <div>
      <SectionTitle>Weekly mileage</SectionTitle>
      <Card className="mb-3 divide-y divide-line">
        {weeks.map(([ws, km]) => (
          <div key={ws} className="flex justify-between py-2 text-sm first:pt-0 last:pb-0">
            <span className="text-muted">Week of {fmtDate(ws)}</span>
            <span className="font-bold tabular-nums">{round1(km)} km</span>
          </div>
        ))}
      </Card>
      <SectionTitle>All runs</SectionTitle>
      <div className="space-y-2">
        {runs.map((r) => (
          <Card key={r.id}>
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold text-sm capitalize">{r.kind} run · {r.distanceKm} km</div>
                <div className="text-xs text-muted">{fmtDate(r.eventDate)} · {fmtDuration(r.durationSec)} · {fmtPace(r.avgPaceSecPerKm)}/km{r.rpe ? ` · RPE ${r.rpe}` : ''}</div>
              </div>
              <button className="text-muted text-xs" onClick={() => { if (confirm('Delete this run?')) remove('runs', r.id); }}>Delete</button>
            </div>
            {r.notes && <div className="text-xs text-muted mt-1">{r.notes}</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}
