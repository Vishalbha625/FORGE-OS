import { useMemo, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { AppHeader } from '../../components/Layout';
import { Highlight, SectionTitle, Segmented } from '../../components/ui';
import { SkeletonCard, SkeletonChart } from '../../components/Skeleton';
import {
  PERIOD_LABELS,
  PERIOD_PHRASE,
  hyroxSummary,
  nutritionSeries,
  periodRange,
  recoverySeries,
  runningSeries,
  sleepSeries,
  strengthSeries,
  type Period,
} from '../../lib/analytics';
import { WeeklyReview } from './WeeklyReview';
import { HyroxChart, NutritionChart, RecoveryChart, RunningChart, SleepChart, StrengthChart } from './AnalyticsCharts';
import { LongTermTrends } from './Analytics';

// Progress: this week's review, six charts for the chosen period, then the
// all-time trends. Every number comes from records on this device (R1).

const PERIODS: Period[] = ['week', 'month', 'last4'];

export function AnalyticsPage() {
  const { data, profile, today, loading } = useApp();
  const [period, setPeriod] = useState<Period>('week');
  const range = useMemo(() => periodRange(period, today), [period, today]);

  const running = useMemo(() => runningSeries(data.runs, data.plannedWorkouts, range, today), [data.runs, data.plannedWorkouts, range, today]);
  const strength = useMemo(() => strengthSeries(data.strength, range), [data.strength, range]);
  const hyrox = useMemo(() => hyroxSummary(data.hyrox, range), [data.hyrox, range]);
  const nutrition = useMemo(() => nutritionSeries(data.nutrition, range, profile), [data.nutrition, range, profile]);
  const recovery = useMemo(() => recoverySeries(data.recovery, range, today), [data.recovery, range, today]);
  const sleep = useMemo(() => sleepSeries(data.sleep, range, today), [data.sleep, range, today]);

  const phrase = PERIOD_PHRASE[period];

  return (
    <div className="pb-6">
      <AppHeader title="Progress" subtitle={<>Trends from <Highlight>your real records</Highlight>, never filled in.</>} />
      {loading ? (
        <AnalyticsSkeleton />
      ) : (
        <>
          <WeeklyReview />
          <div className="my-4">
            <Segmented label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))} />
          </div>
          <RunningChart data={running} period={period} phrase={phrase} />
          <StrengthChart data={strength} period={period} phrase={phrase} />
          <HyroxChart data={hyrox} phrase={phrase} />
          <NutritionChart data={nutrition} period={period} phrase={phrase} />
          <RecoveryChart data={recovery} period={period} phrase={phrase} />
          <SleepChart data={sleep} period={period} phrase={phrase} />
          <SectionTitle lead="Everything you have logged, week by week.">Long-term trends</SectionTitle>
          <LongTermTrends />
        </>
      )}
    </div>
  );
}

/** Placeholder in the page's shape while data or the chart code loads. */
export function AnalyticsSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading progress">
      <SkeletonCard />
      <SkeletonChart />
      <SkeletonChart />
    </div>
  );
}
