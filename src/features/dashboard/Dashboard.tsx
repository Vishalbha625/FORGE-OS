import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, Activity, Dumbbell, Flame } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, StatTile, StatusPill, Ring, Bar, SectionTitle, InfoNote, Highlight } from '../../components/ui';
import { LOG_ICONS } from '../../components/icons';
import { computeDayStatus, generateWeeklyReport } from '../../lib/coach';
import { fmtDate, daysBetween, relativeDay } from '../../lib/dates';
import { fmtPace, fmtDuration, round0, fmtHrsMins } from '../../lib/calc';
import type { PlannedWorkout } from '../../db/types';
import type { LogKind } from '../../features/logging/QuickLog';

function SectionLink({ to, children }: { to: string; children: string }) {
  const nav = useNavigate();
  return (
    <button className="link inline-flex items-center gap-1" onClick={() => nav(to)}>
      {children} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

const QUICK: [LogKind, string][] = [
  ['run', 'Run'], ['strength', 'Gym'], ['hyrox', 'HYROX'], ['meal', 'Meal'],
  ['water', 'Water'], ['weight', 'Weight'], ['sleep', 'Sleep'], ['recovery', 'Recovery'],
];

export function Dashboard() {
  const { profile, data, today, snapshot } = useApp();
  const log = useLog();
  const nav = useNavigate();

  const plan = useMemo(() => data.plannedWorkouts.find((w) => w.eventDate === today), [data.plannedWorkouts, today]);
  const status = useMemo(() => computeDayStatus(snapshot), [snapshot]);
  const report = useMemo(() => generateWeeklyReport(snapshot), [snapshot]);

  if (!profile) return null;

  const daysToRace = daysBetween(today, profile.raceDate);
  const daysToStart = daysBetween(today, profile.trainingStartDate);
  const todayRuns = data.runs.filter((r) => r.eventDate === today);
  const todayStrength = data.strength.filter((r) => r.eventDate === today);
  const todayHyrox = data.hyrox.filter((r) => r.eventDate === today);
  const completedToday = todayRuns.length + todayStrength.length + todayHyrox.length;

  const stepsToday = data.steps.find((s) => s.eventDate === today);
  const sleepToday = [...data.sleep].sort((a, b) => b.eventDate.localeCompare(a.eventDate)).find((s) => s.eventDate <= today);
  const sleptLastNight = sleepToday && sleepToday.eventDate >= today;
  const waterToday = round0(data.water.filter((w) => w.eventDate === today).reduce((a, w) => a + w.amountMl, 0));
  const nutToday = data.nutrition.filter((n) => n.eventDate === today && !n.isSupplement);
  const calToday = round0(nutToday.reduce((a, n) => a + (n.calories ?? 0), 0));
  const protToday = round0(nutToday.reduce((a, n) => a + (n.protein ?? 0), 0));
  const weightLast = [...data.body].filter((b) => b.weightKg).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];

  const stepPct = stepsToday ? (stepsToday.steps / profile.stepGoal) * 100 : 0;
  const waterPct = (waterToday / profile.waterTargetMl) * 100;
  const calPct = profile.calorieTarget ? (calToday / profile.calorieTarget) * 100 : 0;
  const protPct = profile.proteinTarget ? (protToday / profile.proteinTarget) * 100 : 0;

  const lead = plan ? (
    <>Week {plan.weekIndex} of your <Highlight>{plan.phase.toLowerCase()} phase</Highlight>, {fmtDate(today, { weekday: 'long', day: 'numeric', month: 'short', year: undefined })}</>
  ) : daysToStart > 0 ? (
    <>Your plan starts on <Highlight>{fmtDate(profile.trainingStartDate, { day: 'numeric', month: 'short', year: undefined })}</Highlight>, in {daysToStart} {daysToStart === 1 ? 'day' : 'days'}</>
  ) : (
    fmtDate(today, { weekday: 'long' })
  );

  return (
    <div>
      <AppHeader title={`Hi, ${profile.displayName.split(' ')[0]}`} subtitle={lead} />

      {/* Status and race countdown: the one central element. */}
      <Card className="mb-2">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <StatusPill status={status.status} />
            <p className="mt-2 text-sm text-muted">{status.reasons[0]}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-montserrat text-4xl font-semibold tabular-nums tracking-tight">{daysToRace >= 0 ? daysToRace : '–'}</div>
            <div className="text-xs text-muted">days to race</div>
          </div>
        </div>
        <div className="mt-3 border-t border-border pt-3 text-xs text-muted">
          {profile.raceDivision} · {fmtDate(profile.raceDate, { weekday: 'short' })}
        </div>
      </Card>

      <SectionTitle action={<SectionLink to="/training">Calendar</SectionLink>}>Today's plan</SectionTitle>
      {plan ? (
        <TodayPlanCard plan={plan} completed={completedToday} onStart={(kind) => log(kind, plan)} />
      ) : (
        <Card className="text-sm text-muted">No session planned for today. Rest, or log any activity with the + button.</Card>
      )}

      {completedToday > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-good">
            <Check className="h-4 w-4" aria-hidden /> Logged today
          </div>
          <ul className="space-y-1.5 text-sm">
            {todayRuns.map((r) => (
              <li key={r.id} className="flex items-center gap-2"><Activity className="h-4 w-4 text-muted" aria-hidden /> <span className="capitalize">{r.kind}</span> {r.distanceKm} km · {fmtDuration(r.durationSec)} · {fmtPace(r.avgPaceSecPerKm)}/km</li>
            ))}
            {todayStrength.map((r) => (
              <li key={r.id} className="flex items-center gap-2"><Dumbbell className="h-4 w-4 text-muted" aria-hidden /> {r.title} · {r.exercises.length} exercises</li>
            ))}
            {todayHyrox.map((r) => (
              <li key={r.id} className="flex items-center gap-2"><Flame className="h-4 w-4 text-muted" aria-hidden /> {r.title} · {r.stations.length} stations</li>
            ))}
          </ul>
        </Card>
      )}

      <SectionTitle>Today</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Card onClick={() => nav('/steps')}>
          <div className="flex items-center gap-3">
            <Ring pct={stepPct} size={52}>{stepsToday ? `${Math.round(stepPct)}%` : '–'}</Ring>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Steps</div>
              <div className="font-montserrat text-lg font-semibold tabular-nums">{stepsToday ? stepsToday.steps.toLocaleString() : '–'}</div>
              <div className="text-[11px] text-muted">goal {profile.stepGoal.toLocaleString()}</div>
            </div>
          </div>
        </Card>
        <Card onClick={() => nav('/hydration')}>
          <div className="flex items-center gap-3">
            <Ring pct={waterPct} size={52}>{Math.round(waterPct)}%</Ring>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Water</div>
              <div className="font-montserrat text-lg font-semibold tabular-nums">{(waterToday / 1000).toFixed(1)} L</div>
              <div className="text-[11px] text-muted">of {(profile.waterTargetMl / 1000).toFixed(1)} L</div>
            </div>
          </div>
        </Card>
        <StatTile onClick={() => nav('/sleep')} label="Sleep" value={sleptLastNight ? fmtHrsMins(sleepToday!.durationMin) : '–'} sub={sleptLastNight ? `quality ${sleepToday!.quality ?? '–'}/5` : 'not logged'} />
        <StatTile onClick={() => nav('/body')} label="Weight" value={weightLast ? `${weightLast.weightKg} kg` : '–'} sub={weightLast ? relativeDay(weightLast.eventDate) : 'not logged'} />
        <Card onClick={() => nav('/nutrition')}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Calories</div>
          <div className="mt-1 font-montserrat text-lg font-semibold tabular-nums">
            {calToday || '–'}
            {profile.calorieTarget ? <span className="font-sans text-xs font-normal text-muted"> / {profile.calorieTarget}</span> : null}
          </div>
          {profile.calorieTarget ? <div className="mt-2"><Bar pct={calPct} label="Calories of target" /></div> : <div className="text-[11px] text-muted">no target set</div>}
        </Card>
        <Card onClick={() => nav('/nutrition')}>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted">Protein</div>
          <div className="mt-1 font-montserrat text-lg font-semibold tabular-nums">
            {protToday ? `${protToday} g` : '–'}
            {profile.proteinTarget ? <span className="font-sans text-xs font-normal text-muted"> / {profile.proteinTarget} g</span> : null}
          </div>
          {profile.proteinTarget ? <div className="mt-2"><Bar pct={protPct} label="Protein of target" /></div> : <div className="text-[11px] text-muted">no target set</div>}
        </Card>
      </div>

      {status.status === 'missing' && (
        <div className="mt-3">
          <InfoNote>Some of today's data isn't logged yet. Forge OS only shows what you log; it never fills in steps, sleep or calories for you.</InfoNote>
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2">
        <SectionLink to="/recovery">Recovery trends</SectionLink>
        <SectionLink to="/sleep">Sleep history</SectionLink>
        <SectionLink to="/body">Body progress</SectionLink>
      </div>

      <SectionTitle action={<SectionLink to="/analytics">Progress</SectionLink>}>Today's focus</SectionTitle>
      <Card>
        <ol className="space-y-3">
          {report.priorities.map((p, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border font-montserrat text-[11px] font-semibold text-foreground/80">{i + 1}</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </Card>

      <SectionTitle>Quick log</SectionTitle>
      <div className="grid grid-cols-4 gap-2">
        {QUICK.map(([k, l]) => {
          const Icon = LOG_ICONS[k];
          return (
            <button key={k} onClick={() => log(k)} className="card card-link flex flex-col items-center gap-1.5 p-3">
              <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden />
              <span className="text-[11px] font-medium text-muted">{l}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TodayPlanCard({ plan, completed, onStart }: { plan: PlannedWorkout; completed: number; onStart: (kind: 'run' | 'strength' | 'hyrox') => void }) {
  const hasRun = plan.runs.length > 0;
  const hasStrength = plan.exercises.length > 0;
  const hasHyrox = plan.hyroxStations.length > 0;
  const actions = [hasRun && 'run', hasStrength && 'strength', hasHyrox && 'hyrox'].filter(Boolean) as ('run' | 'strength' | 'hyrox')[];
  const labels = { run: 'Log run', strength: 'Log sets', hyrox: 'Log HYROX' };
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-montserrat text-base font-semibold leading-snug">{plan.title}</h3>
          <p className="mt-0.5 text-xs text-muted">{plan.focus}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {plan.deload && <span className="pill border-info/40 text-info">Deload</span>}
          {completed > 0 && <span className="pill border-good/40 text-good">Started</span>}
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 text-sm">
        {plan.runs.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted" aria-hidden />
            <span className="capitalize">{r.kind} run</span>
            <span className="text-muted">{r.distanceKm ? `${r.distanceKm} km` : r.durationMin ? `${r.durationMin} min` : ''}</span>
            {r.targetRPE && <span className="pill ml-auto border-border text-muted">RPE {r.targetRPE}</span>}
          </li>
        ))}
        {hasStrength && (
          <li className="flex items-center gap-2">
            <Dumbbell className="h-4 w-4 text-muted" aria-hidden />
            {plan.exercises.length} exercises <span className="text-muted">· {[...new Set(plan.exercises.map((e) => e.group))].join(', ')}</span>
          </li>
        )}
        {hasHyrox && (
          <li className="flex items-start gap-2">
            <Flame className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
            <span>HYROX <span className="text-muted">· {plan.hyroxStations.map((s) => s.station).join(', ')}</span></span>
          </li>
        )}
      </ul>

      <div className="mt-4 flex gap-2">
        {actions.map((k, i) => (
          <button key={k} className={`${i === 0 ? 'btn-soft' : 'btn-ghost'} flex-1`} onClick={() => onStart(k)}>{labels[k]}</button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted">Starting from the plan fills in the targets. Nothing counts as done until you save a log.</p>
    </Card>
  );
}
