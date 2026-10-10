import { LineChart, Line, BarChart, Bar as RBar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { NotEnoughData } from './ui';

const AXIS = { fontSize: 10, fill: '#8b93a3' };
const tooltipStyle = {
  background: '#1f232d',
  border: '1px solid #2a2f3a',
  borderRadius: 12,
  fontSize: 12,
  color: '#e7eaf0',
};

export interface Point {
  label: string;
  value: number | null;
}

export function MiniLine({ data, color = '#ff5a1f', unit = '', minPoints = 2 }: { data: Point[]; color?: string; unit?: string; minPoints?: number }) {
  const valid = data.filter((d) => d.value !== null);
  if (valid.length < minPoints) return <NotEnoughData />;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}${unit}`, '']} labelStyle={{ color: '#8b93a3' }} />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 2.5, fill: color }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MiniBars({ data, color = '#ff5a1f', unit = '', target }: { data: Point[]; color?: string; unit?: string; target?: number }) {
  const valid = data.filter((d) => d.value !== null && d.value !== 0);
  if (!valid.length) return <NotEnoughData />;
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="#2a2f3a" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={36} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v}${unit}`, '']} labelStyle={{ color: '#8b93a3' }} cursor={{ fill: '#ffffff08' }} />
        <RBar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
        {target ? <ReferenceLine y={target} stroke="#8b93a3" strokeDasharray="4 4" /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
}
