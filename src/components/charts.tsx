import { LineChart, Line, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { NotEnoughData } from './ui';

// ChaiUI charts: neutral marks, hairline grid, no orange. SVG presentation
// attributes can't read CSS variables, so marks use `currentColor` and the
// wrapper sets the colour through Tailwind classes (works in both themes).

const AXIS = { fontSize: 10, fill: 'currentColor', opacity: 0.6 };
const tooltipStyle = {
  background: 'oklch(var(--card))',
  border: '1px solid var(--card-edge-hover)',
  borderRadius: 10,
  fontSize: 12,
  color: 'oklch(var(--foreground))',
};

export interface Point {
  label: string;
  value: number | null;
}

export function MiniLine({ data, unit = '', minPoints = 2 }: { data: Point[]; unit?: string; minPoints?: number }) {
  const valid = data.filter((d) => d.value !== null);
  if (valid.length < minPoints) return <NotEnoughData />;
  return (
    <div className="text-foreground">
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}${unit}`, '']} labelStyle={{ opacity: 0.6 }} cursor={{ stroke: 'currentColor', strokeOpacity: 0.15 }} />
          <Line type="monotone" dataKey="value" stroke="currentColor" strokeOpacity={0.9} strokeWidth={2} dot={{ r: 2.5, fill: 'currentColor' }} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniBars({ data, unit = '', target }: { data: Point[]; unit?: string; target?: number }) {
  const valid = data.filter((d) => d.value !== null && d.value !== 0);
  if (!valid.length) return <NotEnoughData />;
  return (
    <div className="text-foreground">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}${unit}`, '']} labelStyle={{ opacity: 0.6 }} cursor={{ fill: 'currentColor', fillOpacity: 0.05 }} />
          <RBar dataKey="value" fill="currentColor" fillOpacity={0.75} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          {target ? <ReferenceLine y={target} stroke="currentColor" strokeOpacity={0.45} strokeDasharray="4 4" /> : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
