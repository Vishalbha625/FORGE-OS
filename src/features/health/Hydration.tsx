import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Ring, EmptyState, InfoNote } from '../../components/ui';
import { MiniBars } from '../../components/charts';
import { addDays, fmtDate, fmtDateTimeIST } from '../../lib/dates';
import { round0 } from '../../lib/calc';

export function Hydration() {
  const { data, today, profile } = useApp();
  const log = useLog();
  if (!profile) return null;

  const todayEntries = data.water.filter((w) => w.eventDate === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const todayMl = round0(todayEntries.reduce((a, w) => a + w.amountMl, 0));
  const pct = (todayMl / profile.waterTargetMl) * 100;

  const last7 = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
    return days.map((d) => {
      const ml = data.water.filter((w) => w.eventDate === d).reduce((a, w) => a + w.amountMl, 0);
      return { label: fmtDate(d, { weekday: 'short' }).slice(0, 2), value: ml ? round0(ml / 1000 * 10) / 10 : null };
    });
  }, [data.water, today]);

  return (
    <div>
      <AppHeader title="Hydration" right={<button className="btn-primary px-3 py-1.5 text-sm" onClick={() => log('water')}>+ Add</button>} />

      <Card className="mb-3">
        <div className="flex items-center gap-4">
          <Ring pct={pct} size={88} stroke={9} color="#5aa9ff"><div className="text-sm font-extrabold">{Math.round(pct)}%</div></Ring>
          <div>
            <div className="text-xs text-muted">Today</div>
            <div className="text-2xl font-extrabold tabular-nums">{(todayMl / 1000).toFixed(2)} L</div>
            <div className="text-xs text-muted">of {(profile.waterTargetMl / 1000).toFixed(1)} L target</div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 mt-3">
          {[250, 500, 750, 1000].map((ml) => (
            <button key={ml} className="btn-ghost py-2.5 text-sm" onClick={() => log('water')}>+{ml}</button>
          ))}
        </div>
      </Card>

      <SectionTitle>Last 7 days (L)</SectionTitle>
      <Card className="mb-3"><MiniBars data={last7} color="#5aa9ff" unit="L" target={profile.waterTargetMl / 1000} /></Card>

      <SectionTitle>Today's log</SectionTitle>
      {todayEntries.length === 0 ? (
        <EmptyState title="No water logged today" icon="💧" action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => log('water')}>Add water</button>} />
      ) : (
        <div className="space-y-2">
          {todayEntries.map((w) => (
            <Card key={w.id} className="flex justify-between items-center py-2.5">
              <span className="text-sm font-semibold">💧 {w.amountMl} ml</span>
              <span className="text-xs text-muted">{fmtDateTimeIST(w.createdAt).split(',')[1] ?? ''}</span>
            </Card>
          ))}
        </div>
      )}
      <InfoNote>Default serving is {profile ? '250' : ''} ml (change in Profile → Settings). Electrolyte intake can be noted in a meal/supplement entry.</InfoNote>
      <div className="h-6" />
    </div>
  );
}
