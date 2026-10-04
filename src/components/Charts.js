'use client';

import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid, LineChart, Line,
} from 'recharts';
import { money0 } from '@/lib/format';
import { useLang } from '@/i18n/LangContext';

// Categorical slots (validated reference palette) – fixed order, never cycled
export const SERIES = {
  donation: '#2a78d6', // slot 1 – blue
  expense: '#eb6834', // slot 2 – orange
  cash: '#1baf7a', // slot 3 – aqua
};
const AXIS = { fontSize: 11, fill: '#52514e' };
const GRID = '#eceae6';
const short = (v) => {
  const n = Math.abs(v);
  if (n >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
};
const tip = { formatter: (v) => money0(v), contentStyle: { borderRadius: 8, fontSize: 12 }, cursor: { fill: 'rgba(0,0,0,0.04)' } };

/** Grouped bars: donation vs expense per month */
export function DonationExpenseChart({ data, height = 280 }) {
  const { t: tr } = useLang();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={AXIS} axisLine={false} tickLine={false} width={48} />
        <Tooltip {...tip} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="donation" name={tr('Donation')} fill={SERIES.donation} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="expense" name={tr('Expense')} fill={SERIES.expense} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Single-series monthly bars */
export function MonthlyBar({ data, dataKey, name, color, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={AXIS} axisLine={false} tickLine={false} width={48} />
        <Tooltip {...tip} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for category breakdown (magnitude, one hue) */
export function CategoryBars({ data, color, height }) {
  const { t: tr } = useLang();
  const rows = data.slice(0, 10);
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(160, rows.length * 30 + 20)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tickFormatter={short} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="key" tick={AXIS} width={130} axisLine={false} tickLine={false} />
        <Tooltip {...tip} />
        <Bar dataKey="amount" name={tr('Amount')} fill={color} radius={[0, 4, 4, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Month-end balance trend */
export function BalanceTrend({ data, series, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={short} tick={AXIS} axisLine={false} tickLine={false} width={48} />
        <Tooltip formatter={(v) => money0(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
        {series.length > 1 ? <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /> : null}
        {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
