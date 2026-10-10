import { useMemo } from 'react';
import { useApp } from '../../store/AppContext';
import { useLog } from '../../features/logging/QuickLog';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, StatTile, EmptyState, InfoNote } from '../../components/ui';
import { MiniBars } from '../../components/charts';
import { addDays, fmtDate, fmtDateTimeIST } from '../../lib/dates';
import { fmtHrsMins, mean, round1 } from '../../lib/calc';

export function Sleep() {
  const { data, today } = useApp();
  const log = useLog();
  const sleeps = [...data.sleep].sort((a, b) => b.eventDate.localeCompare(a.eventDate));

  const last7 = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
    return days.map((d) => {
      const rec = data.sleep.find((s) => s.eventDate === d);
      return { label: fmtDate(d, { weekday: 'short' }).slice(0, 2), value: rec ? round1(rec.durationMin / 60) : null };
    });
  }, [data.sleep, today]);

  const avg7 = useMemo(() => {
    const vals = last7.map((d) => d.value).filter((v): v is number => v !== null);
    return vals.length ? round1(mean(vals) ?? 0) : undefined;
  }, [last7]);

  return (
    <div>
      <AppHeader title="Sleep & Recovery" subtitle="Rest drives adaptation" right={<button className="btn-primary px-3 py-1.5 text-sm" onClick={() => log('sleep')}>+ Log</button>} />

      <div className="grid grid-cols-2 gap-3 mb-3">
        <StatTile label="7-day avg" value={avg7 !== undefined ? fmtHrsMins(Math.round(avg7 * 60)) : '—'} sub={avg7 !== undefined && avg7 < 7 ? 'below 7h target' : 'nights logged'} tone={avg7 !== undefined && avg7 < 7 ? 'warn' : 'good'} />
        <StatTile label="Last night" value={sleeps[0] ? fmtHrsMins(sleeps[0].durationMin) : '—'} sub={sleeps[0] ? `quality ${sleeps[0].quality ?? '—'}/5` : 'not logged'} tone="info" />
      </div>

      <SectionTitle>Last 7 nights</SectionTitle>
      <Card className="mb-3"><MiniBars data={last7} color="#5aa9ff" unit="h" target={7} /></Card>
      {avg7 !== undefined && avg7 < 7 && <InfoNote tone="warn">Average sleep is under 7 h. Combined with high fatigue, the coach may suggest easing intensity. Prioritise an earlier bedtime.</InfoNote>}
      <div className="h-3" />

      <SectionTitle>History</SectionTitle>
      {sleeps.length === 0 ? (
        <EmptyState title="No sleep logged" hint="Record bedtime & wake time — duration is calculated correctly even across midnight." icon="😴" action={<button className="btn-primary px-4 py-2 text-sm" onClick={() => log('sleep')}>Log sleep</button>} />
      ) : (
        <div className="space-y-2">
          {sleeps.slice(0, 30).map((s) => (
            <Card key={s.id}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold text-sm">{fmtHrsMins(s.durationMin)} · {fmtDate(s.eventDate, { weekday: 'short' })}</div>
                  <div className="text-xs text-muted">{fmtDateTimeIST(s.bedtime).split(',')[1] ?? ''} → {fmtDateTimeIST(s.wakeTime).split(',')[1] ?? ''} · quality {s.quality ?? '—'}/5</div>
                </div>
                <div className="text-right text-xs text-muted">
                  {s.restingHr ? <div>RHR {s.restingHr}</div> : null}
                  {s.hrv ? <div>HRV {s.hrv}</div> : null}
                  <span className="pill bg-surface-2 text-muted mt-1">{s.source}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <InfoNote>Sleep stages and HRV are only shown when a connected device provides them — never inferred. Current entries are {sleeps[0]?.source ?? 'manual'}.</InfoNote>
      <div className="h-6" />
    </div>
  );
}
