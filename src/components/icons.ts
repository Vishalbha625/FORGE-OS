import { Activity, Dumbbell, Flame, Utensils, Droplets, Scale, Moon, Footprints, HeartPulse, type LucideIcon } from 'lucide-react';
import type { LogKind } from '../features/logging/QuickLog';

/** One icon per loggable activity, used everywhere quick-log appears. */
export const LOG_ICONS: Record<LogKind, LucideIcon> = {
  run: Activity,
  strength: Dumbbell,
  hyrox: Flame,
  meal: Utensils,
  water: Droplets,
  weight: Scale,
  sleep: Moon,
  steps: Footprints,
  recovery: HeartPulse,
};
