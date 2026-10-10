import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '../../components/ui';
import type {
  PlannedWorkout, RunRecord, StrengthRecord, HyroxRecord, NutritionEntry,
  BodyRecord, SleepRecord, RecoveryRecord,
} from '../../db/types';
import {
  LogRunForm, LogStrengthForm, LogHyroxForm, LogMealForm, LogWaterForm,
  LogWeightForm, LogSleepForm, LogStepsForm, LogRecoveryForm,
} from './forms';

export type LogKind =
  | 'run' | 'strength' | 'hyrox' | 'meal' | 'water'
  | 'weight' | 'sleep' | 'steps' | 'recovery';

export interface LogOptions {
  plan?: PlannedWorkout;
  /** A record to edit instead of creating a new one. */
  existing?: RunRecord | StrengthRecord | HyroxRecord | NutritionEntry | BodyRecord | SleepRecord | RecoveryRecord;
  /** Default event date for new entries (e.g. the day being viewed). */
  date?: string;
}

interface LogReq extends LogOptions {
  kind: LogKind;
}

const TITLES: Record<LogKind, [string, string]> = {
  run: ['Log a run', 'Edit run'],
  strength: ['Log strength sets', 'Edit strength session'],
  hyrox: ['Log HYROX', 'Edit HYROX session'],
  meal: ['Log a meal', 'Edit meal entry'],
  water: ['Add water', 'Add water'],
  weight: ['Log body metrics', 'Edit body metrics'],
  sleep: ['Record sleep', 'Edit sleep'],
  steps: ['Record steps', 'Record steps'],
  recovery: ['Log recovery', 'Edit recovery'],
};

type OpenFn = (kind: LogKind, planOrOpts?: PlannedWorkout | LogOptions) => void;
const LogCtx = createContext<OpenFn>(() => {});

export function LogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<LogReq | null>(null);
  const open: OpenFn = (kind, planOrOpts) => {
    // Accept either a planned workout (legacy call sites) or an options object.
    const opts: LogOptions = planOrOpts && 'weekIndex' in planOrOpts ? { plan: planOrOpts } : (planOrOpts as LogOptions) ?? {};
    setReq({ kind, ...opts });
  };
  const close = () => setReq(null);

  const render = () => {
    if (!req) return null;
    const { kind, plan, existing, date } = req;
    switch (kind) {
      case 'run': return <LogRunForm onDone={close} plan={plan} existing={existing as RunRecord | undefined} />;
      case 'strength': return <LogStrengthForm onDone={close} plan={plan} existing={existing as StrengthRecord | undefined} />;
      case 'hyrox': return <LogHyroxForm onDone={close} plan={plan} existing={existing as HyroxRecord | undefined} />;
      case 'meal': return <LogMealForm onDone={close} existing={existing as NutritionEntry | undefined} date={date} />;
      case 'water': return <LogWaterForm onDone={close} />;
      case 'weight': return <LogWeightForm onDone={close} existing={existing as BodyRecord | undefined} />;
      case 'sleep': return <LogSleepForm onDone={close} existing={existing as SleepRecord | undefined} />;
      case 'steps': return <LogStepsForm onDone={close} />;
      case 'recovery': return <LogRecoveryForm onDone={close} existing={existing as RecoveryRecord | undefined} />;
    }
  };

  return (
    <LogCtx.Provider value={open}>
      {children}
      <Sheet open={!!req} onClose={close} title={req ? TITLES[req.kind][req.existing ? 1 : 0] : ''}>
        {/* key forces a fresh form when switching between records */}
        <div key={req ? `${req.kind}-${req.existing?.id ?? 'new'}` : 'none'}>{render()}</div>
      </Sheet>
    </LogCtx.Provider>
  );
}

export function useLog() {
  return useContext(LogCtx);
}
