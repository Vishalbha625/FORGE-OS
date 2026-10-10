import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, StatTile, Ring, EmptyState, InfoNote } from '../../components/ui';
import { MiniBars } from '../../components/charts';
import { addDays, fmtDate } from '../../lib/dates';
import { mean, round0 } from '../../lib/calc';

export function Steps() {
  const { data, today, profile } = useApp();
  const log = useLog();
  if (!profile) return null;

  const recs = [...data.steps].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const todayRec = data.steps.find((s) => s.eventDate === today);

  const last7 = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
    return days.map((d) => {
      const rec = data.steps.find((s) => s.eventDate === d);
      return { label: fmtDate(d, { weekday: 'short' }).slice(0, 2), value: rec ? rec.steps : null };
    });
  }, [data.steps, today]);

  const avg7 = useMemo(() => {
    const v = last7.map((d) => d.value).filter((x): x is number => x !== null);
    return v.length ? round0(mean(v) ?? 0) : undefined;
  }, [last7]);

  const pct = todayRec ? (todayRec.steps / profile.stepGoal) * 100 : 0;

  return (
    <div>
      <AppHeader title="Steps & Movement" right={<button className="btn-primary px-3 py-1.5 text-sm" onClick={() => log('steps')}>+ Log</button>} />

      <Card className="mb-3">
        <div className="flex items-center gap-4">
          <Ring pct={pct} size={88} stroke={9}>
            <div className="text-center">
              <div className="text-base font-extrabold">{todayRec ? Math.round(pct) : '—'}{todayRec ? '%' : ''}</div>
            </div>
          </Ring>
          <div>
            <div className="text-xs text-muted">Today</div>
            <div className="text-2xl font-extrabold tabular-nums">{todayRec ? todayRec.steps.toLocaleString() : '—'}</div>
            <div className="text-xs text-muted">goal {profile.stepGoal.toLocaleString()}{todayRec?.distanceKm ? ` · ${todayRec.distanceKm} km` : ''}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile label="7-day avg" value={avg7 !== undefined ? avg7.toLocaleString() : '—'} sub="steps/day" />
        <StatTile label="Active mins" value={todayRec?.activeMinutes ?? '—'} sub="today" tone="accent" />
      </div>

      <SectionTitle>Last 7 days</SectionTitle>
      <Card className="mb-3"><MiniBars data={last7} color="#3ecf8e" target={profile.stepGoal} /></Card>

      <InfoNote tone="warn">All step data is <b>manually entered</b>. A web app can't read phone/device step sensors without native integration or a connected device — once a supported source is added, steps will sync automatically and be de-duplicated by source.</InfoNote>
      <div className="h-3" />

      <SectionTitle>History</SectionTitle>
      {recs.length === 0 ? (
        <EmptyState title="No steps logged" icon="👟" action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => log('steps')}>Log steps</button>} />
      ) : (
        <div className="space-y-2">
          {recs.slice(0, 30).map((s) => (
            <Card key={s.id} className="flex justify-between items-center py-2.5">
              <div>
                <div className="font-semibold text-sm">{s.steps.toLocaleString()} steps</div>
                <div className="text-xs text-muted">{fmtDate(s.eventDate)}{s.distanceKm ? ` · ${s.distanceKm} km` : ''}{s.activeMinutes ? ` · ${s.activeMinutes} min` : ''}</div>
              </div>
              <span className="pill bg-surface-2 text-muted">{s.source}</span>
            </Card>
          ))}
        </div>
      )}
      <div className="h-6" />
    </div>
  );
}
