import { useMemo, useState } from 'react';
import { Plus, Scale } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { useConfirmDelete } from '../../store/confirm';
import { AppHeader } from '../../components/Layout';
import { Card, EmptyState, Highlight, InfoNote, SectionTitle, Sheet, StatTile } from '../../components/ui';
import { MiniLine } from '../../components/charts';
import { fmtDate, startOfWeek } from '../../lib/dates';
import { mean, round1, cmToFtIn } from '../../lib/calc';

export function Body() {
  const { data, profile, remove } = useApp();
  const log = useLog();
  const confirmDelete = useConfirmDelete();
  const [viewPhoto, setViewPhoto] = useState<{ src: string; date: string } | null>(null);

  const records = [...data.body].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const withWeight = records.filter((r) => r.weightKg);
  const latest = withWeight[0];
  const photos = records.filter((r) => r.photo);

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

  if (!profile) return null;

  const weekAvg = series.length ? series[series.length - 1].value : undefined;
  const goalDelta = latest?.weightKg && profile.goalWeightKg ? round1(latest.weightKg - profile.goalWeightKg) : undefined;
  const goalSub = goalDelta === undefined ? 'set in profile' : goalDelta === 0 ? 'at goal' : `${Math.abs(goalDelta)} kg ${goalDelta > 0 ? 'above' : 'below'} goal`;

  return (
    <div>
      <AppHeader title="Body and progress" subtitle={<>Weight and measurements as a <Highlight>trend over time</Highlight>.</>} right={<button className="btn-outline" onClick={() => log('weight')}><Plus className="h-4 w-4" aria-hidden /> Log</button>} />

      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile label="Current" value={latest?.weightKg ? `${latest.weightKg} kg` : '–'} sub={latest ? fmtDate(latest.eventDate) : 'not logged'} tone="accent" />
        <StatTile label="Weekly avg" value={weekAvg ? `${weekAvg} kg` : '–'} sub="smoother trend" />
        <StatTile label="Goal" value={profile.goalWeightKg ? `${profile.goalWeightKg} kg` : '–'} sub={goalSub} />
        <StatTile label="Height" value={cmToFtIn(profile.heightCm)} sub={`${profile.heightCm ?? '–'} cm`} />
      </div>

      <SectionTitle>Weight trend (weekly avg)</SectionTitle>
      <Card className="mb-3"><MiniLine data={series} unit=" kg" /></Card>
      <InfoNote>Weight shifts aren't read as fat or muscle: water, glycogen and food all move the scale. Track the trend over weeks. Body-fat % is shown only if you measure and enter it.</InfoNote>
      <div className="h-3" />

      {photos.length > 0 && (
        <>
          <SectionTitle lead="Private. Stored only on this device.">Progress photos</SectionTitle>
          <div className="grid grid-cols-3 gap-2 mb-1">
            {photos.slice(0, 12).map((r) => (
              <button key={r.id} onClick={() => setViewPhoto({ src: r.photo!, date: r.eventDate })} className="relative aspect-[3/4] rounded-xl overflow-hidden border border-line">
                <img src={r.photo} className="w-full h-full object-cover" alt={`Progress photo ${r.eventDate}`} />
                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] py-0.5 text-center">{fmtDate(r.eventDate, { year: undefined })}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted mb-3">Stored only on this device. Never posted or shared. Included in your backup file, so keep that file private too.</p>
        </>
      )}

      <SectionTitle>Measurement history</SectionTitle>
      {records.length === 0 ? (
        <EmptyState title="No measurements yet" hint="Log body weight and optional measurements." icon={Scale} action={<button className="btn-soft" onClick={() => log('weight')}>Log now</button>} />
      ) : (
        <div className="space-y-2">
          {records.slice(0, 40).map((r) => {
            const parts = [
              r.waistCm ? `waist ${r.waistCm} cm` : null,
              r.chestCm ? `chest ${r.chestCm} cm` : null,
              r.armCm ? `arm ${r.armCm} cm` : null,
              r.thighCm ? `thigh ${r.thighCm} cm` : null,
              r.bodyFatPct ? `body fat ${r.bodyFatPct}% (measured)` : null,
            ].filter(Boolean);
            return (
              <Card key={r.id} className="py-2.5">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-sm">{r.weightKg ? `${r.weightKg} kg` : 'Measurements'}{r.photo ? ' · photo' : ''}</span>
                  <span className="text-xs text-muted">{fmtDate(r.eventDate)}</span>
                </div>
                {parts.length > 0 && <div className="text-xs text-muted mt-1">{parts.join(' · ')}</div>}
                <div className="flex gap-3 mt-2">
                  <button className="link" onClick={() => log('weight', { existing: r })}>Edit</button>
                  <button className="text-muted text-xs" onClick={async () => { if (await confirmDelete(`the entry from ${fmtDate(r.eventDate)}`, r.photo ? 'The measurements and the progress photo will be removed from this device.' : undefined)) remove('body', r.id); }}>Delete</button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <div className="h-6" />
      <Sheet open={!!viewPhoto} onClose={() => setViewPhoto(null)} title={viewPhoto ? fmtDate(viewPhoto.date) : ''}>
        {viewPhoto && <img src={viewPhoto.src} className="w-full rounded-xl" alt={`Progress photo ${viewPhoto.date}`} />}
      </Sheet>
    </div>
  );
}
