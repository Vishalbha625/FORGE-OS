import { useMemo } from 'react';
import { HeartPulse, Plus } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, EmptyState, Highlight, InfoNote, SectionTitle, StatTile } from '../../components/ui';
import { MiniLine } from '../../components/charts';
import { computeDayStatus } from '../../lib/coach';
import { addDays, fmtDate } from '../../lib/dates';
import { mean, round1 } from '../../lib/calc';

export function Recovery() {
  const { data, today, snapshot } = useApp();
  const log = useLog();
  const recs = [...data.recovery].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const status = computeDayStatus(snapshot);

  const series = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
    return {
      fatigue: days.map((d) => ({ label: d.slice(-2), value: data.recovery.find((r) => r.eventDate === d)?.fatigue ?? null })),
      soreness: days.map((d) => ({ label: d.slice(-2), value: data.recovery.find((r) => r.eventDate === d)?.soreness ?? null })),
    };
  }, [data.recovery, today]);

  const avg = (key: 'fatigue' | 'soreness' | 'motivation' | 'stress') => {
    const last7 = data.recovery.filter((r) => r.eventDate >= addDays(today, -6)).map((r) => r[key]).filter((v): v is number => typeof v === 'number');
    return last7.length ? round1(mean(last7) ?? 0) : undefined;
  };

  return (
    <div>
      <AppHeader title="Recovery" subtitle={<>How <Highlight>ready</Highlight> you feel, day by day.</>} right={<button className="btn-outline" onClick={() => log('recovery')}><Plus className="h-4 w-4" aria-hidden /> Log</button>} />

      <Card className="mb-3">
        <div className="text-sm font-semibold mb-1">Today's guidance</div>
        <p className="text-sm text-muted">{status.reasons.join(' ')}</p>
        {status.status === 'recovery' && <div className="mt-2"><InfoNote>Signals suggest reducing today's intensity. Swap in easy aerobic work or extra mobility. This is rule-based guidance, not medical advice.</InfoNote></div>}
      </Card>

      <div className="grid grid-cols-4 gap-2 mb-3">
        <StatTile label="Fatigue" value={avg('fatigue') ?? '–'} sub="7d" tone={(avg('fatigue') ?? 0) >= 4 ? 'bad' : 'default'} />
        <StatTile label="Soreness" value={avg('soreness') ?? '–'} sub="7d" tone={(avg('soreness') ?? 0) >= 4 ? 'bad' : 'default'} />
        <StatTile label="Motivation" value={avg('motivation') ?? '–'} sub="7d" tone="good" />
        <StatTile label="Stress" value={avg('stress') ?? '–'} sub="7d" tone={(avg('stress') ?? 0) >= 4 ? 'warn' : 'default'} />
      </div>

      <SectionTitle>Fatigue (14 days, lower is better)</SectionTitle>
      <Card className="mb-3"><MiniLine data={series.fatigue} /></Card>
      <SectionTitle>Soreness (14 days)</SectionTitle>
      <Card className="mb-3"><MiniLine data={series.soreness} /></Card>

      <SectionTitle>History</SectionTitle>
      {recs.length === 0 ? (
        <EmptyState title="No recovery logs" hint="Log daily fatigue, soreness, motivation and stress." icon={HeartPulse} action={<button className="btn-soft" onClick={() => log('recovery')}>Log recovery</button>} />
      ) : (
        <div className="space-y-2">
          {recs.slice(0, 30).map((r) => (
            <Card key={r.id} className="py-2.5">
              <div className="flex justify-between">
                <span className="text-sm font-semibold">{fmtDate(r.eventDate)}</span>
                <span className="text-xs text-muted">F{r.fatigue ?? '-'} · S{r.soreness ?? '-'} · M{r.motivation ?? '-'} · St{r.stress ?? '-'}</span>
              </div>
              {r.pain && <div className="text-xs text-bad mt-1">Pain: {r.pain}</div>}
            </Card>
          ))}
        </div>
      )}
      <InfoNote>Forge OS won't diagnose conditions or tell you to train through pain. Persistent pain → rest and seek professional advice.</InfoNote>
      <div className="h-6" />
    </div>
  );
}
