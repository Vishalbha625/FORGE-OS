import { useMemo } from 'react';
import { Footprints, Plus } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, EmptyState, Highlight, InfoNote, Ring, SectionTitle, StatTile } from '../../components/ui';
import { MiniBars } from '../../components/charts';
import { addDays, fmtDate } from '../../lib/dates';
import { mean, round0 } from '../../lib/calc';

export function Steps() {
  const { data, today, profile } = useApp();
  const log = useLog();

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

  if (!profile) return null;

  const pct = todayRec ? (todayRec.steps / profile.stepGoal) * 100 : 0;

  return (
    <div>
      <AppHeader title="Steps and movement" subtitle={<>Daily movement <Highlight>outside training</Highlight>.</>} right={<button className="btn-outline" onClick={() => log('steps')}><Plus className="h-4 w-4" aria-hidden /> Log</button>} />

      <Card className="mb-3">
        <div className="flex items-center gap-4">
          <Ring pct={pct} size={88} stroke={9}>
            <div className="text-center">
              <div className="text-base font-semibold">{todayRec ? Math.round(pct) : '–'}{todayRec ? '%' : ''}</div>
            </div>
          </Ring>
          <div>
            <div className="text-xs text-muted">Today</div>
            <div className="text-2xl font-semibold tabular-nums">{todayRec ? todayRec.steps.toLocaleString() : '–'}</div>
            <div className="text-xs text-muted">goal {profile.stepGoal.toLocaleString()}{todayRec?.distanceKm ? ` · ${todayRec.distanceKm} km` : ''}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile label="7-day avg" value={avg7 !== undefined ? avg7.toLocaleString() : '–'} sub="steps/day" />
        <StatTile label="Active mins" value={todayRec?.activeMinutes ?? '–'} sub="today" tone="accent" />
      </div>

      <SectionTitle>Last 7 days</SectionTitle>
      <Card className="mb-3"><MiniBars data={last7} target={profile.stepGoal} /></Card>

      <InfoNote tone="warn">All step data is <b>manually entered</b>. A web app can't read phone/device step sensors without a native integration or a connected device. Once a supported source is added, steps will sync automatically and be de-duplicated by source.</InfoNote>
      <div className="h-3" />

      <SectionTitle>History</SectionTitle>
      {recs.length === 0 ? (
        <EmptyState title="No steps logged" icon={Footprints} action={<button className="btn-soft" onClick={() => log('steps')}>Log steps</button>} />
      ) : (
        <div className="space-y-2">
          {recs.slice(0, 30).map((s) => (
            <Card key={s.id} className="flex justify-between items-center py-2.5">
              <div>
                <div className="font-semibold text-sm">{s.steps.toLocaleString()} steps</div>
                <div className="text-xs text-muted">{fmtDate(s.eventDate)}{s.distanceKm ? ` · ${s.distanceKm} km` : ''}{s.activeMinutes ? ` · ${s.activeMinutes} min` : ''}</div>
              </div>
              <span className="pill border-border text-muted">{s.source}</span>
            </Card>
          ))}
        </div>
      )}
      <div className="h-6" />
    </div>
  );
}
