import { useState, type ReactNode } from 'react';
import type { TooltipProps } from 'recharts';
import { useTheme } from '../../store/theme';
import { fmtDate } from '../../lib/dates';
import type { Period } from '../../lib/analytics';

// Shared pieces for the analytics charts. Series colours are a validated
// categorical palette (adjacent pairs stay apart under colour blindness in
// both themes), assigned in this fixed order and never cycled. Plan and
// target lines are neutral grey. SVG attributes can't read CSS variables,
// so the hexes are picked here per theme. Text always uses text tokens.

const SERIES = {
  light: ['#1baf7a', '#2a78d6', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#199e70', '#3987e5', '#d55181', '#008300', '#9085e9', '#e66767'],
} as const;

export interface ChartColors {
  series: readonly string[];
  /** Plan, target and reference marks. */
  neutral: string;
  /** The chart surface, used for the 2 px gaps between stacked segments. */
  surface: string;
}

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  return theme === 'dark'
    ? { series: SERIES.dark, neutral: '#a3a3a3', surface: '#0a0a0a' }
    : { series: SERIES.light, neutral: '#737373', surface: '#ffffff' };
}

export const AXIS_TICK = { fontSize: 10, fill: 'currentColor' };
export const BAR_MAX = 24;
/** Rounded data end for a bar that grows upward from the baseline. */
export const TOP_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

/** Axis label for a day: weekday in a week, day of month otherwise. */
export function dayTick(period: Period) {
  return (iso: string) => (period === 'week' ? fmtDate(iso, { weekday: 'short', day: undefined, month: undefined, year: undefined }) : fmtDate(iso, { day: 'numeric', month: undefined, year: undefined }));
}
export const dayLong = (iso: string) => fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short', year: undefined });

export interface LegendItem {
  label: string;
  color: string;
  /** Line series show as a short stroke, dashed for plans and targets. */
  kind?: 'box' | 'line' | 'dash' | 'band';
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.kind === 'line' || i.kind === 'dash' ? (
            <svg width="14" height="6" aria-hidden>
              <line x1="0" y1="3" x2="14" y2="3" stroke={i.color} strokeWidth="2" strokeDasharray={i.kind === 'dash' ? '3 2' : undefined} />
            </svg>
          ) : (
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color, opacity: i.kind === 'band' ? 0.35 : 1 }} aria-hidden />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  label: string;
  color?: string;
  value: string;
}

/** Hover card in the card style, rows in text tokens next to a colour key. */
export function ChartTooltip({ active, label, rows }: { active?: boolean; label?: string; rows: TooltipRow[] }) {
  if (!active || !label) return null;
  return (
    <div className="rounded-lg border px-2.5 py-2 text-xs" style={{ background: 'oklch(var(--card))', borderColor: 'var(--card-edge-hover)' }}>
      <div className="mb-1 text-muted">{dayLong(label)}</div>
      {rows.length === 0 ? (
        <div className="text-muted">Nothing logged</div>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-1.5 text-foreground">
              {r.color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.color }} aria-hidden />}
              <span className="text-muted">{r.label}</span>
              <span className="ml-auto pl-3 font-medium tabular-nums">{r.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Adapts recharts' tooltip props to rows built from the hovered day. */
export function tooltipFor<T>(byDate: Map<string, T>, rows: (d: T) => TooltipRow[]) {
  return function Content(props: TooltipProps<number, string>) {
    const label = typeof props.label === 'string' ? props.label : undefined;
    const d = label ? byDate.get(label) : undefined;
    return <ChartTooltip active={props.active} label={label} rows={d ? rows(d) : []} />;
  };
}

export interface TableColumn<T> {
  label: string;
  value: (row: T) => string;
}

/** A chart card: title, summary, the chart, and a table view of the same numbers. */
export function ChartCard<T>({
  title,
  summary,
  empty,
  emptyText,
  legend,
  children,
  rows,
  columns,
  rowLabel,
}: {
  title: string;
  summary?: ReactNode;
  empty: boolean;
  emptyText: string;
  legend?: LegendItem[];
  children: ReactNode;
  rows: T[];
  columns: TableColumn<T>[];
  rowLabel: (row: T) => string;
}) {
  const [table, setTable] = useState(false);
  return (
    <section className="card mb-3 p-4" aria-label={title}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {!empty && (
          <button className="link text-xs" onClick={() => setTable((t) => !t)} aria-pressed={table}>
            {table ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
      {empty ? (
        <p className="py-8 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <>
          {summary && <div className="mb-3 text-xs text-muted">{summary}</div>}
          {table ? (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="text-muted">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Day</th>
                    {columns.map((c) => (
                      <th key={c.label} className="py-1 pr-2 text-right font-medium">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={rowLabel(r)} className="border-t border-border">
                      <td className="py-1 pr-2 text-muted">{rowLabel(r)}</td>
                      {columns.map((c) => (
                        <td key={c.label} className="py-1 pr-2 text-right">{c.value(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              {legend && legend.length > 1 && <ChartLegend items={legend} />}
              <div className="text-muted">{children}</div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** "–" for a value that wasn't logged (R2: missing is not zero). */
export const orDash = (v: number | undefined, fmt: (n: number) => string = String) => (v === undefined ? '–' : fmt(v));

export const emptyText = (type: string, phrase: string) => `No ${type} data ${phrase}. Start logging to see trends.`;
