import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyDistances } from '../types';
import { addDays, dailyVolume, dateLabel, monthlyVolume, weeklyVolume } from '../utils/calendar';
import { distanceKm } from '../utils/format';

type Period = 'daily' | 'weekly' | 'monthly';

const periods: [Period, string][] = [['daily', '30 days'], ['weekly', '8 weeks'], ['monthly', 'This year']];

export function TrainingVolume({ data, today, onDay }: {
  data: DailyDistances;
  today: string;
  onDay?: (date: string) => void;
}) {
  const [period, setPeriod] = useState<Period>('daily');
  const points = period === 'daily' ? dailyVolume(data, today)
    : period === 'weekly' ? weeklyVolume(data, today)
    : monthlyVolume(data, today);
  const label = (date: string) => dateLabel(date, period === 'monthly' ? { month: 'short' } : undefined);
  const tooltipLabel = (date: string) => {
    if (period === 'monthly') return dateLabel(date, { month: 'long', year: 'numeric' });
    if (period === 'weekly') {
      const end = addDays(date, 6);
      return `${dateLabel(date)} – ${dateLabel(end < today ? end : today)}`;
    }
    return dateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const ticks = period === 'daily' ? points.filter((_, index) => index % 7 === 1 || index === 29).map(point => point.date) : undefined;
  const caption = period === 'monthly' ? today.slice(0, 4) : `${dateLabel(points[0].date)} – ${dateLabel(today)}`;
  const total = points.reduce((sum, point) => sum + point.meters, 0);

  return (
    <section className="panel volume-panel" aria-labelledby="volume-heading">
      <div className="panel-header">
        <div>
          <h2 id="volume-heading">Training volume</h2>
          <p className="panel-caption">{distanceKm(total)} km · {caption}</p>
        </div>
        <div className="segmented-control" role="group" aria-label="Training volume period">
          {periods.map(([value, text]) => (
            <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{text}</button>
          ))}
        </div>
      </div>
      <div className="volume-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 7, right: 10, left: 0, bottom: 2 }}>
            <CartesianGrid vertical={false} stroke="#e0dfda" strokeDasharray="3 4" />
            <XAxis dataKey="date" ticks={ticks} tickFormatter={label} minTickGap={13} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#5c5953' }} />
            <YAxis width={42} domain={[0, total > 0 ? 'auto' : 1000]} tickCount={4} tickFormatter={distanceKm} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#5c5953' }} />
            <Tooltip
              cursor={{ fill: '#ece9e2' }}
              labelFormatter={(date, entries) => `${tooltipLabel(String(date))}${entries[0]?.payload.partial ? ' · through today' : ''}`}
              formatter={value => [`${distanceKm(Number(value))} km`, 'Distance']}
            />
            <Bar
              dataKey="meters"
              fill="#872e38"
              radius={[2, 2, 0, 0]}
              maxBarSize={34}
              isAnimationActive={false}
              onClick={period === 'daily' && onDay ? (_, index) => {
                const point = points[index];
                if (point?.meters > 0) onDay(point.date);
              } : undefined}
              className={period === 'daily' && onDay ? 'clickable-bars' : undefined}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-note">{total === 0 ? 'No recorded distance in this period.' : period === 'weekly' ? 'Weeks start on Monday.' : 'Distance in kilometers'}</p>
    </section>
  );
}
