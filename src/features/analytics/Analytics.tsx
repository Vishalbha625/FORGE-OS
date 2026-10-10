import { useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { AppHeader } from '../../components/Layout';
import { Card, SectionTitle, Segmented, StatTile, NotEnoughData, InfoNote } from '../../components/ui';
import { MiniBars, MiniLine } from '../../components/charts';
import { generateWeeklyReport } from '../../lib/coach';
import { addDays, startOfWeek, fmtDate } from '../../lib/dates';
import { round1, round0, fmtPace, fmtDuration } from '../../lib/calc';

type Tab = 'running' | 'strength' | 'nutrition' | 'recovery' | 'hyrox';

export function Analytics() {
  const [tab, setTab] = useState<Tab>('running');
  return (
    <div>
      <AppHeader title="Progress" subtitle="Real data, correct formulas" />
      <WeeklyReportCard />
      <div className="my-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'running', label: 'Run' },
            { value: 'strength', label: 'Lift' },
            { value: 'nutrition', label: 'Food' },
            { value: 'recovery', label: 'Recover' },
            { value: 'hyrox', label: 'HYROX' },
          ]}
        />
      </div>
      {tab === 'running' && <RunningAnalytics />}
      {tab === 'strength' && <StrengthAnalytics />}
      {tab === 'nutrition' && <NutritionAnalytics />}
      {tab === 'recovery' && <RecoveryAnalytics />}
      {tab === 'hyrox' && <HyroxAnalytics />}
      <div className="h-6" />
    </div>
  );
}

function WeeklyReportCard() {
  const { snapshot } = useApp();
  const r = useMemo(() => generateWeeklyReport(snapshot), [snapshot]);
  return (
    <Card className="bg-gradient-to-br from-surface to-surface-2">
      <div className="flex justify-between items-center mb-2">
        <span className="font-bold text-sm">Weekly report</span>
        <span className="text-xs text-muted">{fmtDate(r.weekStart)}–{fmtDate(r.weekEnd)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center mb-2">
        <div><div className="text-lg font-extrabold">{r.planned.completed}/{r.planned.total}</div><div className="text-[10px] text-muted">sessions</div></div>
        <div><div className="text-lg font-extrabold text-accent">{r.running.actualKm}</div><div className="text-[10px] text-muted">km run</div></div>
        <div><div className="text-lg font-extrabold">{r.avgSleepHours ?? '—'}</div><div className="text-[10px] text-muted">h sleep</div></div>
      </div>
      <div className="text-xs text-muted">🎯 {r.priorities[0]}</div>
    </Card>
  );
}

function weekSeries<T extends { eventDate: string }>(items: T[], weeks: number, today: string, reducer: (group: T[]) => number | null) {
  const out: { label: string; value: number | null }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = startOfWeek(addDays(today, -i * 7));
    const we = addDays(ws, 6);
    const group = items.filter((x) => x.eventDate >= ws && x.eventDate <= we);
    out.push({ label: fmtDate(ws, { day: 'numeric', month: 'short' }), value: reducer(group) });
  }
  return out;
}

function RunningAnalytics() {
  const { data, today } = useApp();
  const runs = data.runs;
  const weekly = useMemo(() => weekSeries(runs, 10, today, (g) => (g.length ? round1(g.reduce((a, r) => a + r.distanceKm, 0)) : null)), [runs, today]);
  const easyPace = useMemo(() => [...runs].filter((r) => r.kind === 'easy' && r.avgPaceSecPerKm).sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(-12).map((r) => ({ label: fmtDate(r.eventDate, { day: 'numeric', month: 'short' }), value: round1((r.avgPaceSecPerKm ?? 0) / 60 * 10) / 10 })), [runs]);
  const tempoPace = useMemo(() => [...runs].filter((r) => r.kind === 'tempo' && r.avgPaceSecPerKm).sort((a, b) => a.eventDate.localeCompare(b.eventDate)).slice(-12).map((r) => ({ label: fmtDate(r.eventDate, { day: 'numeric', month: 'short' }), value: round1((r.avgPaceSecPerKm ?? 0) / 60 * 10) / 10 })), [runs]);
  const longest = runs.length ? Math.max(...runs.map((r) => r.distanceKm)) : 0;
  const totalKm = round1(runs.reduce((a, r) => a + r.distanceKm, 0));
  const pb5k = [...runs].filter((r) => r.distanceKm >= 4.9 && r.distanceKm <= 5.2).sort((a, b) => a.durationSec - b.durationSec)[0];

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatTile label="Total" value={`${totalKm}`} sub="km logged" tone="accent" />
        <StatTile label="Longest" value={longest ? `${round1(longest)}` : '—'} sub="km" />
        <StatTile label="Runs" value={runs.length} sub="sessions" />
      </div>
      <SectionTitle>Weekly volume (km)</SectionTitle>
      <Card className="mb-3"><MiniBars data={weekly} unit=" km" /></Card>
      <SectionTitle>Easy pace trend (min/km)</SectionTitle>
      <Card className="mb-3">{easyPace.length >= 2 ? <MiniLine data={easyPace} unit=" min/km" color="#3ecf8e" /> : <NotEnoughData what="easy pace" />}</Card>
      <SectionTitle>Tempo pace trend (min/km)</SectionTitle>
      <Card className="mb-3">{tempoPace.length >= 2 ? <MiniLine data={tempoPace} unit=" min/km" color="#f5b945" /> : <NotEnoughData what="tempo pace" />}</Card>
      {pb5k && <InfoNote>Best ~5k effort: {fmtDuration(pb5k.durationSec)} ({fmtPace(pb5k.avgPaceSecPerKm)}/km) on {fmtDate(pb5k.eventDate)}.</InfoNote>}
    </div>
  );
}

function StrengthAnalytics() {
  const { data, today } = useApp();
  const s = data.strength;
  const weeklySessions = useMemo(() => weekSeries(s, 10, today, (g) => (g.length ? g.length : null)), [s, today]);
  const volume = useMemo(() => weekSeries(s, 10, today, (g) => {
    if (!g.length) return null;
    return round0(g.reduce((a, x) => a + x.exercises.reduce((v, e) => v + e.sets.reduce((y, st) => y + (st.weightKg ?? 0) * (st.reps ?? 0), 0), 0), 0));
  }), [s, today]);

  // muscle group distribution
  const dist = useMemo(() => {
    const map = new Map<string, number>();
    for (const sess of s) for (const e of sess.exercises) map.set(e.group, (map.get(e.group) ?? 0) + e.sets.length);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [s]);
  const totalSets = dist.reduce((a, [, n]) => a + n, 0);

  if (!s.length) return <NotEnoughData what="strength analytics" />;

  return (
    <div>
      <SectionTitle>Sessions per week</SectionTitle>
      <Card className="mb-3"><MiniBars data={weeklySessions} /></Card>
      <SectionTitle>Weekly volume (kg)</SectionTitle>
      <Card className="mb-3"><MiniBars data={volume} unit=" kg" color="#3ecf8e" /></Card>
      <SectionTitle>Muscle-group distribution (sets)</SectionTitle>
      <Card>
        {dist.map(([g, n]) => (
          <div key={g} className="mb-2 last:mb-0">
            <div className="flex justify-between text-xs mb-0.5"><span className="capitalize">{g}</span><span className="text-muted">{n} ({Math.round((n / totalSets) * 100)}%)</span></div>
            <div className="w-full bg-surface-2 rounded-full h-2"><div className="h-2 rounded-full bg-accent" style={{ width: `${(n / totalSets) * 100}%` }} /></div>
          </div>
        ))}
      </Card>
    </div>
  );
}

function NutritionAnalytics() {
  const { data, today, profile } = useApp();
  const cals = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
    return days.map((d) => {
      const v = data.nutrition.filter((n) => n.eventDate === d).reduce((a, n) => a + (n.calories ?? 0), 0);
      return { label: d.slice(-2), value: v ? round0(v) : null };
    });
  }, [data.nutrition, today]);
  const prot = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
    return days.map((d) => {
      const v = data.nutrition.filter((n) => n.eventDate === d).reduce((a, n) => a + (n.protein ?? 0), 0);
      return { label: d.slice(-2), value: v ? round0(v) : null };
    });
  }, [data.nutrition, today]);

  if (!data.nutrition.length) return <NotEnoughData what="nutrition analytics" />;
  return (
    <div>
      <SectionTitle>Daily calories (14 days)</SectionTitle>
      <Card className="mb-3"><MiniBars data={cals} unit=" kcal" target={profile?.calorieTarget} /></Card>
      <SectionTitle>Daily protein (14 days)</SectionTitle>
      <Card className="mb-3"><MiniBars data={prot} unit=" g" color="#3ecf8e" target={profile?.proteinTarget} /></Card>
      <InfoNote>Dashed line is your target. Blank days mean nothing logged — not zero intake.</InfoNote>
    </div>
  );
}

function RecoveryAnalytics() {
  const { data, today } = useApp();
  const sleep = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
    return days.map((d) => {
      const rec = data.sleep.find((s) => s.eventDate === d);
      return { label: d.slice(-2), value: rec ? round1(rec.durationMin / 60) : null };
    });
  }, [data.sleep, today]);
  const fatigue = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => addDays(today, -13 + i));
    return days.map((d) => ({ label: d.slice(-2), value: data.recovery.find((r) => r.eventDate === d)?.fatigue ?? null }));
  }, [data.recovery, today]);

  return (
    <div>
      <SectionTitle>Sleep duration (14 days, h)</SectionTitle>
      <Card className="mb-3"><MiniBars data={sleep} unit="h" color="#5aa9ff" target={7} /></Card>
      <SectionTitle>Fatigue (14 days)</SectionTitle>
      <Card className="mb-3"><MiniLine data={fatigue} color="#ef5e6b" /></Card>
    </div>
  );
}

function HyroxAnalytics() {
  const { data } = useApp();
  const h = data.hyrox;
  if (!h.length) return <NotEnoughData what="HYROX analytics" />;

  // Per-station time trend (pick stations that have data)
  const stationNames = [...new Set(h.flatMap((x) => x.stations.map((s) => s.station)))];
  const sims = h.filter((x) => x.mode === 'simulation' || x.mode === 'race');

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <StatTile label="Sessions" value={h.length} sub="logged" tone="accent" />
        <StatTile label="Sims/Races" value={sims.length} sub="full runs" />
        <StatTile label="Stations" value={stationNames.length} sub="tracked" />
      </div>
      {stationNames.map((name) => {
        const pts = [...h].sort((a, b) => a.eventDate.localeCompare(b.eventDate)).map((x) => {
          const st = x.stations.find((s) => s.station === name);
          return { label: fmtDate(x.eventDate, { day: 'numeric', month: 'short' }), value: st?.timeSec ? round1(st.timeSec / 60 * 10) / 10 : null };
        }).filter((p) => p.value !== null);
        if (pts.length < 2) return null;
        return (
          <div key={name}>
            <SectionTitle>{name} time trend (min)</SectionTitle>
            <Card className="mb-3"><MiniLine data={pts} unit=" min" /></Card>
          </div>
        );
      })}
      <InfoNote>Station time trends appear once you log the same station at least twice. Comparable results use your own history.</InfoNote>
    </div>
  );
}
