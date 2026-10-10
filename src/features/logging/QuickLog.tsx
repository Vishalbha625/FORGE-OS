import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { Sheet } from '../../components/ui';
import type { PlannedWorkout } from '../../db/types';
import {
  LogRunForm, LogStrengthForm, LogHyroxForm, LogMealForm, LogWaterForm,
  LogWeightForm, LogSleepForm, LogStepsForm, LogRecoveryForm,
} from './forms';

export type LogKind =
  | 'run' | 'strength' | 'hyrox' | 'meal' | 'water'
  | 'weight' | 'sleep' | 'steps' | 'recovery';

interface LogReq {
  kind: LogKind;
  plan?: PlannedWorkout;
}

const TITLES: Record<LogKind, string> = {
  run: 'Log a run',
  strength: 'Log strength sets',
  hyrox: 'Log HYROX',
  meal: 'Log a meal',
  water: 'Add water',
  weight: 'Log body metrics',
  sleep: 'Record sleep',
  steps: 'Record steps',
  recovery: 'Log recovery',
};

const LogCtx = createContext<(kind: LogKind, plan?: PlannedWorkout) => void>(() => {});

export function LogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<LogReq | null>(null);
  const open = (kind: LogKind, plan?: PlannedWorkout) => setReq({ kind, plan });
  const close = () => setReq(null);

  const render = () => {
    if (!req) return null;
    const p = { onDone: close, plan: req.plan };
    switch (req.kind) {
      case 'run': return <LogRunForm {...p} />;
      case 'strength': return <LogStrengthForm {...p} />;
      case 'hyrox': return <LogHyroxForm {...p} />;
      case 'meal': return <LogMealForm onDone={close} />;
      case 'water': return <LogWaterForm onDone={close} />;
      case 'weight': return <LogWeightForm onDone={close} />;
      case 'sleep': return <LogSleepForm onDone={close} />;
      case 'steps': return <LogStepsForm onDone={close} />;
      case 'recovery': return <LogRecoveryForm onDone={close} />;
    }
  };

  return (
    <LogCtx.Provider value={open}>
      {children}
      <Sheet open={!!req} onClose={close} title={req ? TITLES[req.kind] : ''}>
        {render()}
      </Sheet>
    </LogCtx.Provider>
  );
}

export function useLog() {
  return useContext(LogCtx);
}
