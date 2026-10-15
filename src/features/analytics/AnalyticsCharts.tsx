import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  MUSCLE_BUCKETS,
  MUSCLE_LABELS,
  RECOVERY_METRICS,
  type HyroxSummary,
  type MuscleBucket,
  type NutritionSummary,
  type Period,
  type RecoveryMetric,
  type RecoverySummary,
  type RunningSummary,
  type SleepSummary,
  type StrengthSummary,
  type Trend,
} from '../../lib/analytics';
import { fmtDuration, fmtPace } from '../../lib/calc';
import { fmtDate } from '../../lib/dates';
import type { RectangleProps } from 'recharts';
import { AXIS_TICK, BAR_MAX, ChartCard, TOP_RADIUS, dayTick, emptyText, orDash, tooltipFor, useChartColors, type TooltipRow } from './chartKit';

// The six period charts. One y-axis each; every chart also has a table view.

const MARGIN = { top: 8, right: 8, left: -18, bottom: 0 };
const GRID = <CartesianGrid stroke="currentColor" strokeOpacity={0.1} vertical={false} />;
const CURSOR = { fill: 'currentColor', fillOpacity: 0.06 };
const rowDate = (d: { date: string }) => fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short', year: undefined });
const km = (n: number) => `${n} km`;
const kcal = (n: number) => `${n.toLocaleString('en-GB')} kcal`;

/** A stacked segment that rounds its end only when it is the top of that day's stack. */
function stackSegment<T>(isTop: (row: T) => boolean) {
  return function Segment(props: unknown) {
    const p = props as RectangleProps & { payload: T };
    return <Rectangle {...p} radius={isTop(p.payload) ? TOP_RADIUS : 0} />;
  };
}

// Called as a function, not used as <XDays />: recharts only reads axes that
// are its direct children.
function xDays(period: Period) {
  return <XAxis dataKey="date" tickFormatter={dayTick(period)} tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={6} />;
}

export function RunningChart({ data, period, phrase }: { data: RunningSummary; period: Period; phrase: string }) {
  const c = useChartColors();
  const hasPlan = data.plannedKm !== undefined;
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const Content = useMemo(
    () =>
      tooltipFor(byDate, (d): TooltipRow[] => [
        { label: 'Run', color: c.series[0], value: orDash(d.km, km) },
        ...(d.cumulative !== undefined ? [{ label: 'So far', color: c.series[1], value: km(d.cumulative) }] : []),
        ...(d.plannedCumulative !== undefined ? [{ label: 'Plan so far', color: c.neutral, value: km(d.plannedCumulative) }] : []),
      ]),
    [byDate, c],
  );
  return (
    <ChartCard
      title="Running"
      empty={data.runs === 0}
      emptyText={emptyText('running', phrase)}
      summary={
        <>
          <b className="font-medium text-foreground">{data.totalKm} km</b>
          {hasPlan && <> of {data.plannedKm} km planned</>} · {data.runs} {data.runs === 1 ? 'run' : 'runs'} · average pace {fmtPace(data.avgPaceSecPerKm)}/km
        </>
      }
      legend={[
        { label: 'Daily km', color: c.series[0] },
        { label: 'Total so far', color: c.series[1], kind: 'line' },
        ...(hasPlan ? [{ label: 'Plan', color: c.neutral, kind: 'dash' as const }] : []),
      ]}
      rows={data.days}
      rowLabel={rowDate}
      columns={[
        { label: 'Km', value: (d) => orDash(d.km) },
        { label: 'So far', value: (d) => orDash(d.cumulative) },
        ...(hasPlan ? [{ label: 'Plan', value: (d: (typeof data.days)[number]) => orDash(d.plannedCumulative) }] : []),
      ]}
    >
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data.days} margin={MARGIN} barCategoryGap="20%">
          {GRID}
          {xDays(period)}
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip content={Content} cursor={CURSOR} />
          <Bar dataKey="km" name="Daily km" fill={c.series[0]} maxBarSize={BAR_MAX} radius={TOP_RADIUS} isAnimationActive={false} />
          <Line dataKey="cumulative" name="Total so far" stroke={c.series[1]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
          {hasPlan && <Line dataKey="plannedCumulative" name="Plan" stroke={c.neutral} strokeWidth={2} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function StrengthChart({ data, period, phrase }: { data: StrengthSummary; period: Period; phrase: string }) {
  const c = useChartColors();
  // Colour follows the muscle group, whichever groups are present.
  const color = (b: MuscleBucket) => c.series[MUSCLE_BUCKETS.indexOf(b)];
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const Content = useMemo(
    () => tooltipFor(byDate, (d): TooltipRow[] => data.groups.filter((g) => d[g] !== undefined).map((g) => ({ label: MUSCLE_LABELS[g], color: c.series[MUSCLE_BUCKETS.indexOf(g)], value: `${d[g]} sets` }))),
    [byDate, data.groups, c],
  );
  // Only the top segment of each day's stack gets the rounded end.
  const topOf = (d: (typeof data.days)[number]) => [...data.groups].reverse().find((g) => d[g] !== undefined);
  return (
    <ChartCard
      title="Strength"
      empty={data.sessions === 0}
      emptyText={emptyText('strength', phrase)}
      summary={
        <>
          <b className="font-medium text-foreground">{data.totalSets} sets</b> · {data.sessions} {data.sessions === 1 ? 'session' : 'sessions'} · volume {data.volumeKg.toLocaleString('en-GB')} kg
        </>
      }
      legend={data.groups.map((g) => ({ label: MUSCLE_LABELS[g], color: color(g) }))}
      rows={data.days}
      rowLabel={rowDate}
      columns={[...data.groups.map((g) => ({ label: MUSCLE_LABELS[g], value: (d: (typeof data.days)[number]) => orDash(d[g]) })), { label: 'Total', value: (d) => orDash(d.total) }]}
    >
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data.days} margin={MARGIN} barCategoryGap="20%">
          {GRID}
          {xDays(period)}
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip content={Content} cursor={CURSOR} />
          {data.groups.map((g) => (
            <Bar key={g} dataKey={g} name={MUSCLE_LABELS[g]} stackId="sets" fill={color(g)} stroke={c.surface} strokeWidth={2} maxBarSize={BAR_MAX} isAnimationActive={false} shape={stackSegment<(typeof data.days)[number]>((d) => topOf(d) === g)} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function HyroxChart({ data, phrase }: { data: HyroxSummary; phrase: string }) {
  const c = useChartColors();
  const timed = data.stations.length > 0;
  return (
    <ChartCard
      title="HYROX"
      empty={data.sessions === 0}
      emptyText={emptyText('HYROX', phrase)}
      summary={
        <>
          <b className="font-medium text-foreground">{data.sessions} {data.sessions === 1 ? 'session' : 'sessions'}</b> · average circuit {data.avgCircuitSec === undefined ? 'not timed' : fmtDuration(data.avgCircuitSec)}
          {timed && <> · bars show average time per station</>}
        </>
      }
      rows={data.stations}
      rowLabel={(s) => s.station}
      columns={[
        { label: 'Average', value: (s) => fmtDuration(s.avgSec) },
        { label: 'Efforts', value: (s) => String(s.efforts) },
      ]}
    >
      {timed ? (
        <ResponsiveContainer width="100%" height={data.stations.length * 32 + 16}>
          <BarChart data={data.stations} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }} barCategoryGap="25%">
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="station" tick={AXIS_TICK} tickLine={false} axisLine={false} width={104} />
            <Bar dataKey="avgSec" name="Average time" fill={c.series[0]} maxBarSize={BAR_MAX} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              <LabelList dataKey="avgSec" position="right" formatter={(v: number) => fmtDuration(v)} style={{ fontSize: 11, fill: 'currentColor' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="py-4 text-center text-sm">No station times logged. Add a time to a station to compare them here.</p>
      )}
    </ChartCard>
  );
}

const MACROS = [
  { key: 'proteinKcal', label: 'Protein' },
  { key: 'carbsKcal', label: 'Carbs' },
  { key: 'fatKcal', label: 'Fat' },
] as const;

export function NutritionChart({ data, period, phrase }: { data: NutritionSummary; period: Period; phrase: string }) {
  const c = useChartColors();
  const target = data.targetCalories;
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const Content = useMemo(
    () =>
      tooltipFor(byDate, (d): TooltipRow[] => [
        ...MACROS.filter((m) => d[m.key] !== undefined).map((m) => ({ label: m.label, color: c.series[MACROS.indexOf(m)], value: kcal(d[m.key] ?? 0) })),
        ...(d.calories !== undefined ? [{ label: 'Logged', value: kcal(d.calories) }] : []),
      ]),
    [byDate, c],
  );
  const present = MACROS.filter((m) => data.days.some((d) => d[m.key] !== undefined));
  const topOf = (d: (typeof data.days)[number]) => [...present].reverse().find((m) => d[m.key] !== undefined)?.key;
  return (
    <ChartCard
      title="Nutrition"
      empty={data.loggedDays === 0 && present.length === 0}
      emptyText={emptyText('nutrition', phrase)}
      summary={
        <>
          <b className="font-medium text-foreground">{data.avgCalories === undefined ? 'No calories logged' : `${kcal(data.avgCalories)} a day`}</b>
          {target !== undefined && <> · target {kcal(target)}</>}
          {data.macroPct && <> · protein {data.macroPct.protein}%, carbs {data.macroPct.carbs}%, fat {data.macroPct.fat}%</>}
        </>
      }
      legend={[...present.map((m) => ({ label: m.label, color: c.series[MACROS.indexOf(m)] })), ...(target !== undefined ? [{ label: 'Target', color: c.neutral, kind: 'dash' as const }] : [])]}
      rows={data.days}
      rowLabel={rowDate}
      columns={[
        { label: 'Protein', value: (d) => orDash(d.proteinKcal) },
        { label: 'Carbs', value: (d) => orDash(d.carbsKcal) },
        { label: 'Fat', value: (d) => orDash(d.fatKcal) },
        { label: 'Logged kcal', value: (d) => orDash(d.calories) },
      ]}
    >
      {present.length === 0 ? (
        <p className="py-4 text-center text-sm">Calories are logged without macros. Add protein, carbs and fat to see the split.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.days} margin={{ ...MARGIN, left: -8 }} barCategoryGap="20%">
            {GRID}
            {xDays(period)}
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <Tooltip content={Content} cursor={CURSOR} />
            {present.map((m) => (
              <Bar key={m.key} dataKey={m.key} name={m.label} stackId="kcal" fill={c.series[MACROS.indexOf(m)]} stroke={c.surface} strokeWidth={2} maxBarSize={BAR_MAX} isAnimationActive={false} shape={stackSegment<(typeof data.days)[number]>((d) => topOf(d) === m.key)} />
            ))}
            {target !== undefined && <ReferenceLine y={target} stroke={c.neutral} strokeWidth={2} strokeDasharray="4 3" ifOverflow="extendDomain" />}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

const METRIC_LABELS: Record<RecoveryMetric, string> = { fatigue: 'Fatigue', soreness: 'Soreness', motivation: 'Motivation', stress: 'Stress' };
const TREND_WORD: Record<Trend, string> = { up: 'up', down: 'down', flat: 'steady' };

export function RecoveryChart({ data, period, phrase }: { data: RecoverySummary; period: Period; phrase: string }) {
  const c = useChartColors();
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const Content = useMemo(
    () => tooltipFor(byDate, (d): TooltipRow[] => RECOVERY_METRICS.filter((m) => d[m] !== undefined).map((m) => ({ label: METRIC_LABELS[m], color: c.series[RECOVERY_METRICS.indexOf(m)], value: `${d[m]}/5` }))),
    [byDate, c],
  );
  const trends = RECOVERY_METRICS.filter((m) => data.trend[m]).map((m) => `${METRIC_LABELS[m].toLowerCase()} ${TREND_WORD[data.trend[m]!]}`);
  return (
    <ChartCard
      title="Recovery"
      empty={data.loggedDays === 0}
      emptyText={emptyText('recovery', phrase)}
      summary={
        <>
          <b className="font-medium text-foreground">{data.loggedDays} {data.loggedDays === 1 ? 'check-in' : 'check-ins'}</b> · scale 1 to 5 · 7-day trend: {trends.length ? trends.join(', ') : 'needs two weeks of check-ins'}
        </>
      }
      legend={RECOVERY_METRICS.map((m, i) => ({ label: METRIC_LABELS[m], color: c.series[i], kind: 'line' as const }))}
      rows={data.days}
      rowLabel={rowDate}
      columns={RECOVERY_METRICS.map((m) => ({ label: METRIC_LABELS[m], value: (d: (typeof data.days)[number]) => orDash(d[m]) }))}
    >
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data.days} margin={MARGIN}>
          {GRID}
          {xDays(period)}
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
          <Tooltip content={Content} cursor={{ stroke: 'currentColor', strokeOpacity: 0.2 }} />
          {RECOVERY_METRICS.map((m, i) => (
            <Line key={m} dataKey={m} name={METRIC_LABELS[m]} stroke={c.series[i]} strokeWidth={2} connectNulls dot={{ r: 4, fill: c.series[i], stroke: c.surface, strokeWidth: 2 }} activeDot={{ r: 5, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function SleepChart({ data, period, phrase }: { data: SleepSummary; period: Period; phrase: string }) {
  const c = useChartColors();
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const Content = useMemo(
    () =>
      tooltipFor(byDate, (d): TooltipRow[] => [
        ...(d.hours !== undefined ? [{ label: 'Slept', color: c.series[0], value: `${d.hours} h` }] : []),
        ...(d.rolling !== undefined ? [{ label: '7-day average', color: c.series[1], value: `${d.rolling} h` }] : []),
      ]),
    [byDate, c],
  );
  return (
    <ChartCard
      title="Sleep"
      empty={data.nights === 0}
      emptyText={emptyText('sleep', phrase)}
      summary={
        <>
          <b className="font-medium text-foreground">{data.avgHours === undefined ? '–' : `${data.avgHours} h`} average</b> · {data.nights} {data.nights === 1 ? 'night' : 'nights'} logged · goal band 7 to 8 h
        </>
      }
      legend={[
        { label: 'Hours slept', color: c.series[0] },
        { label: '7-day average', color: c.series[1], kind: 'line' },
        { label: '7 to 8 h', color: c.neutral, kind: 'band' },
      ]}
      rows={data.days}
      rowLabel={rowDate}
      columns={[
        { label: 'Hours', value: (d) => orDash(d.hours) },
        { label: '7-day avg', value: (d) => orDash(d.rolling) },
      ]}
    >
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data.days} margin={MARGIN} barCategoryGap="20%">
          {GRID}
          {xDays(period)}
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
          <Tooltip content={Content} cursor={CURSOR} />
          <ReferenceArea y1={7} y2={8} fill={c.neutral} fillOpacity={0.18} stroke="none" ifOverflow="extendDomain" />
          <Bar dataKey="hours" name="Hours slept" fill={c.series[0]} maxBarSize={BAR_MAX} radius={TOP_RADIUS} isAnimationActive={false} />
          <Line dataKey="rolling" name="7-day average" stroke={c.series[1]} strokeWidth={2} dot={false} connectNulls activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
