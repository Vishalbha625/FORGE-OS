import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, StatTile, StatusPill, Ring, Bar, SectionTitle, InfoNote } from '../../components/ui';
import { computeDayStatus, generateWeeklyReport } from '../../lib/coach';
import { fmtDate, daysBetween, relativeDay } from '../../lib/dates';
import { fmtPace, fmtDuration, round0, fmtHrsMins } from '../../lib/calc';
import type { PlannedWorkout } from '../../db/types';

export function Dashboard() {
  const { profile, data, today, snapshot } = useApp();
  const log = useLog();
  const nav = useNavigate();

  const plan = useMemo(() => data.plannedWorkouts.find((w) => w.eventDate === today), [data.plannedWorkouts, today]);
  const status = useMemo(() => computeDayStatus(snapshot), [snapshot]);
  const report = useMemo(() => generateWeeklyReport(snapshot), [snapshot]);

  if (!profile) return null;

  const daysToRace = daysBetween(today, profile.raceDate);
  const todayRuns = data.runs.filter((r) => r.eventDate === today);
  const todayStrength = data.strength.filter((r) => r.eventDate === today);
  const todayHyrox = data.hyrox.filter((r) => r.eventDate === today);
  const completedToday = todayRuns.length + todayStrength.length + todayHyrox.length;

  const stepsToday = data.steps.find((s) => s.eventDate === today);
  const sleepToday = [...data.sleep].sort((a, b) => b.eventDate.localeCompare(a.eventDate)).find((s) => s.eventDate <= today);
  const waterToday = round0(data.water.filter((w) => w.eventDate === today).reduce((a, w) => a + w.amountMl, 0));
  const nutToday = data.nutrition.filter((n) => n.eventDate === today);
  const calToday = round0(nutToday.reduce((a, n) => a + (n.calories ?? 0), 0));
  const protToday = round0(nutToday.reduce((a, n) => a + (n.protein ?? 0), 0));
  const weightLast = [...data.body].filter((b) => b.weightKg).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];

  const stepPct = stepsToday ? (stepsToday.steps / profile.stepGoal) * 100 : 0;
  const waterPct = (waterToday / profile.waterTargetMl) * 100;
  const calPct = profile.calorieTarget ? (calToday / profile.calorieTarget) * 100 : 0;
  const protPct = profile.proteinTarget ? (protToday / profile.proteinTarget) * 100 : 0;

  return (
    <div>
      <AppHeader title={`Hi, ${profile.displayName.split(' ')[0]}`} subtitle={`${fmtDate(today, { weekday: 'long' })}`} />

      {/* Status + race */}
      <Card className="mb-3 bg-gradient-to-br from-surface to-surface-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted">{plan ? `Week ${plan.weekIndex} · ${plan.phase}` : 'Outside plan window'}</div>
            <div className="mt-1"><StatusPill status={status.status} /></div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold text-accent tabular-nums">{daysToRace >= 0 ? daysToRace : '—'}</div>
            <div className="text-[11px] text-muted">days to race</div>
          </div>
        </div>
        <div className="text-xs text-muted mt-2">{status.reasons[0]} · Race {fmtDate(profile.raceDate)}</div>
      </Card>

      {/* Today's plan */}
      <SectionTitle action={<button className="text-xs text-accent font-semibold" onClick={() => nav('/training')}>Calendar →</button>}>Today's plan</SectionTitle>
      {plan ? (
        <TodayPlanCard plan={plan} completed={completedToday} onStart={(kind) => log(kind, plan)} />
      ) : (
        <Card className="mb-3 text-sm text-muted">No session planned for today. Enjoy the rest, or log any activity with the + button.</Card>
      )}

      {/* Completed today */}
      {completedToday > 0 && (
        <Card className="mb-3">
          <div className="text-xs font-semibold text-good mb-1">✓ Logged today</div>
          <div className="text-sm space-y-1">
            {todayRuns.map((r) => <div key={r.id}>🏃 {r.kind} {r.distanceKm} km · {fmtDuration(r.durationSec)} · {fmtPace(r.avgPaceSecPerKm)}/km</div>)}
            {todayStrength.map((r) => <div key={r.id}>🏋️ {r.title} · {r.exercises.length} exercises</div>)}
            {todayHyrox.map((r) => <div key={r.id}>🔥 {r.title} · {r.stations.length} stations</div>)}
          </div>
        </Card>
      )}

      {/* Daily metrics */}
      <SectionTitle>Today</SectionTitle>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Card onClick={() => nav('/steps')}>
          <div className="flex items-center gap-3">
            <Ring pct={stepPct} size={54}>{stepsToday ? `${Math.round(stepPct)}%` : '—'}</Ring>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Steps</div>
              <div className="text-lg font-extrabold tabular-nums">{stepsToday ? stepsToday.steps.toLocaleString() : '—'}</div>
              <div className="text-[11px] text-muted">goal {profile.stepGoal.toLocaleString()}</div>
            </div>
          </div>
        </Card>
        <Card onClick={() => nav('/hydration')}>
          <div className="flex items-center gap-3">
            <Ring pct={waterPct} size={54} color="#5aa9ff">{Math.round(waterPct)}%</Ring>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">Water</div>
              <div className="text-lg font-extrabold tabular-nums">{(waterToday / 1000).toFixed(1)}L</div>
              <div className="text-[11px] text-muted">of {(profile.waterTargetMl / 1000).toFixed(1)}L</div>
            </div>
          </div>
        </Card>
        <StatTile label="Sleep" value={sleepToday && sleepToday.eventDate >= today ? fmtHrsMins(sleepToday.durationMin) : '—'} sub={sleepToday && sleepToday.eventDate >= today ? `quality ${sleepToday.quality ?? '—'}/5` : 'not logged'} tone="info" />
        <StatTile label="Weight" value={weightLast ? `${weightLast.weightKg} kg` : '—'} sub={weightLast ? relativeDay(weightLast.eventDate) : 'not logged'} />
        <Card onClick={() => nav('/nutrition')}>
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Calories</div>
          <div className="text-lg font-extrabold tabular-nums">{calToday || '—'}{profile.calorieTarget ? <span className="text-xs text-muted font-medium"> / {profile.calorieTarget}</span> : ''}</div>
          {profile.calorieTarget ? <div className="mt-1.5"><Bar pct={calPct} /></div> : <div className="text-[11px] text-muted">no target set</div>}
        </Card>
        <Card onClick={() => nav('/nutrition')}>
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold mb-1">Protein</div>
          <div className="text-lg font-extrabold tabular-nums">{protToday || '—'}{profile.proteinTarget ? <span className="text-xs text-muted font-medium"> / {profile.proteinTarget}g</span> : 'g'}</div>
          {profile.proteinTarget ? <div className="mt-1.5"><Bar pct={protPct} color="#3ecf8e" /></div> : <div className="text-[11px] text-muted">no target set</div>}
        </Card>
      </div>

      {status.status === 'missing' && (
        <InfoNote>Some of today's data isn't logged yet. Forge OS shows real logs only — it won't display fake steps, sleep or calorie data.</InfoNote>
      )}

      {/* Priorities */}
      <SectionTitle action={<button className="text-xs text-accent font-semibold" onClick={() => nav('/analytics')}>Progress →</button>}>Today's focus</SectionTitle>
      <Card className="mb-3">
        <ol className="space-y-2">
          {report.priorities.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-sm">
              <span className="w-5 h-5 shrink-0 rounded-full bg-accent/15 text-accent text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </Card>

      {/* Quick actions */}
      <SectionTitle>Quick log</SectionTitle>
      <div className="grid grid-cols-4 gap-2 mb-6">
        {([
          ['run', '🏃', 'Run'], ['strength', '🏋️', 'Gym'], ['hyrox', '🔥', 'HYROX'], ['meal', '🍽️', 'Meal'],
          ['water', '💧', 'Water'], ['weight', '⚖️', 'Weight'], ['sleep', '😴', 'Sleep'], ['recovery', '🧘', 'Recover'],
        ] as const).map(([k, e, l]) => (
          <button key={k} onClick={() => log(k)} className="card p-3 flex flex-col items-center gap-1 active:scale-95 transition">
            <span className="text-xl">{e}</span>
            <span className="text-[10px] font-semibold text-muted">{l}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TodayPlanCard({ plan, completed, onStart }: { plan: PlannedWorkout; completed: number; onStart: (kind: 'run' | 'strength' | 'hyrox') => void }) {
  const hasRun = plan.runs.length > 0;
  const hasStrength = plan.exercises.length > 0;
  const hasHyrox = plan.hyroxStations.length > 0;
  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-bold text-base">{plan.title}</div>
          <div className="text-xs text-muted mt-0.5">{plan.focus}{plan.deload ? ' · Deload' : ''}</div>
        </div>
        {completed > 0 && <span className="pill bg-good/15 text-good">Started</span>}
      </div>

      {hasRun && (
        <div className="mt-3 text-sm space-y-1">
          {plan.runs.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span>🏃</span>
              <span className="capitalize">{r.kind}</span>
              <span className="text-muted">·</span>
              <span>{r.distanceKm ? `${r.distanceKm} km` : r.durationMin ? `${r.durationMin} min` : ''}</span>
              {r.targetRPE && <span className="pill bg-surface-2 text-muted ml-auto">RPE {r.targetRPE}</span>}
            </div>
          ))}
        </div>
      )}
      {hasStrength && (
        <div className="mt-2 text-sm">
          <span>🏋️</span> {plan.exercises.length} exercises · {[...new Set(plan.exercises.map((e) => e.group))].join(', ')}
        </div>
      )}
      {hasHyrox && (
        <div className="mt-2 text-sm">
          <span>🔥</span> HYROX: {plan.hyroxStations.map((s) => s.station).join(', ')}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        {hasRun && <button className="btn-primary flex-1 py-2.5 text-sm" onClick={() => onStart('run')}>Log run</button>}
        {hasStrength && <button className="btn-ghost flex-1 py-2.5 text-sm" onClick={() => onStart('strength')}>Log sets</button>}
        {hasHyrox && <button className="btn-ghost flex-1 py-2.5 text-sm" onClick={() => onStart('hyrox')}>Log HYROX</button>}
      </div>
      <div className="text-[11px] text-muted mt-2">Starting from the plan prefills targets. Nothing is marked complete until you save a log.</div>
    </Card>
  );
}
