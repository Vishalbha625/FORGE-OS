import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, StatTile, EmptyState, InfoNote } from '../../components/ui';
import { MiniLine } from '../../components/charts';
import { fmtDate, startOfWeek } from '../../lib/dates';
import { mean, round1, cmToFtIn } from '../../lib/calc';

export function Body() {
  const { data, profile } = useApp();
  const log = useLog();
  if (!profile) return null;

  const records = [...data.body].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const withWeight = records.filter((r) => r.weightKg);
  const latest = withWeight[0];

  // weekly average weight series (chronological)
  const series = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const r of data.body) {
      if (!r.weightKg) continue;
      const ws = startOfWeek(r.eventDate);
      if (!map.has(ws)) map.set(ws, []);
      map.get(ws)!.push(r.weightKg);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([ws, vals]) => ({ label: fmtDate(ws, { day: 'numeric', month: 'short' }), value: round1(mean(vals) ?? 0) }));
  }, [data.body]);

  const weekAvg = series.length ? series[series.length - 1].value : undefined;
  const goalDelta = latest?.weightKg && profile.goalWeightKg ? round1(latest.weightKg - profile.goalWeightKg) : undefined;

  return (
    <div>
      <AppHeader title="Body & Progress" right={<button className="btn-primary px-3 py-1.5 text-sm" onClick={() => log('weight')}>+ Log</button>} />

      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile label="Current" value={latest?.weightKg ? `${latest.weightKg} kg` : '—'} sub={latest ? fmtDate(latest.eventDate) : 'not logged'} tone="accent" />
        <StatTile label="Weekly avg" value={weekAvg ? `${weekAvg} kg` : '—'} sub="smoother trend" />
        <StatTile label="Goal" value={profile.goalWeightKg ? `${profile.goalWeightKg} kg` : '—'} sub={goalDelta !== undefined ? `${goalDelta > 0 ? '+' : ''}${goalDelta} kg to go` : 'set in profile'} />
        <StatTile label="Height" value={cmToFtIn(profile.heightCm)} sub={`${profile.heightCm ?? '—'} cm`} />
      </div>

      <SectionTitle>Weight trend (weekly avg)</SectionTitle>
      <Card className="mb-3"><MiniLine data={series} unit=" kg" color="#ff5a1f" /></Card>
      <InfoNote>Weight shifts aren't automatically read as fat or muscle — too many factors (water, glycogen, food). Track the trend over weeks. Body-fat % is shown only if you measure and enter it.</InfoNote>
      <div className="h-3" />

      <SectionTitle>Measurement history</SectionTitle>
      {records.length === 0 ? (
        <EmptyState title="No measurements yet" hint="Log body weight and optional measurements." icon="⚖️" action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => log('weight')}>Log now</button>} />
      ) : (
        <div className="space-y-2">
          {records.slice(0, 40).map((r) => (
            <Card key={r.id} className="py-2.5">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-sm">{r.weightKg ? `${r.weightKg} kg` : 'measurements'}</span>
                <span className="text-xs text-muted">{fmtDate(r.eventDate)}</span>
              </div>
              {(r.waistCm || r.chestCm || r.armCm || r.thighCm || r.bodyFatPct) && (
                <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3">
                  {r.waistCm && <span>waist {r.waistCm}cm</span>}
                  {r.chestCm && <span>chest {r.chestCm}cm</span>}
                  {r.armCm && <span>arm {r.armCm}cm</span>}
                  {r.thighCm && <span>thigh {r.thighCm}cm</span>}
                  {r.bodyFatPct && <span>BF {r.bodyFatPct}%</span>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <div className="h-6" />
    </div>
  );
}
