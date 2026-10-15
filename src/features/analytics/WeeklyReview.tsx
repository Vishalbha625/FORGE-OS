import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { weeklyReview, type ReviewStatus } from '../../lib/analytics';
import { fmtDate } from '../../lib/dates';
import { fmtHrsMins } from '../../lib/calc';

const STATUS: Record<ReviewStatus, [string, string]> = {
  on_track: ['On track', 'border-good/40 text-good'],
  needs_attention: ['Needs attention', 'border-warn/40 text-warn'],
  behind: ['Behind', 'border-bad/40 text-bad'],
};

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-montserrat text-lg font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="truncate text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** This week at a glance, judged on running distance against the plan so far. */
export function WeeklyReview() {
  const { snapshot } = useApp();
  const r = useMemo(() => weeklyReview(snapshot), [snapshot]);
  const heading = r.weekIndex !== undefined ? `Week ${r.weekIndex} of ${r.totalWeeks}` : `Week of ${fmtDate(r.weekStart, { day: 'numeric', month: 'short', year: undefined })}`;
  return (
    <section className="card p-4" aria-label="Weekly review">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">{heading}</h2>
          <p className="text-xs text-muted">
            {fmtDate(r.weekStart, { day: 'numeric', month: 'short', year: undefined })} to {fmtDate(r.weekEnd, { day: 'numeric', month: 'short', year: undefined })}
          </p>
        </div>
        {r.status && <span className={`pill ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>}
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Metric label="Run" value={`${r.km} km`} sub={r.plannedKmToDate !== undefined ? `plan ${r.plannedKmToDate} km so far` : undefined} />
        <Metric label="Sets" value={String(r.strengthSets)} sub={`${r.strengthSessions} ${r.strengthSessions === 1 ? 'session' : 'sessions'}`} />
        <Metric label="Calories" value={r.avgCalories === undefined ? '–' : r.avgCalories.toLocaleString('en-GB')} sub="daily average" />
        <Metric label="Sleep" value={r.avgSleepHours === undefined ? '–' : fmtHrsMins(Math.round(r.avgSleepHours * 60))} sub="nightly average" />
        <Metric label="Recovery" value={r.avgRecovery === undefined ? '–' : `${r.avgRecovery}/5`} sub="readiness" />
      </div>
    </section>
  );
}
