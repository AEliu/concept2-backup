import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useJson } from '../hooks/useJson';
import { StatCard } from './StatCard';
import type { ActivityDetail, ActivitySummary } from '../types';
import { dateLabel } from '../utils/calendar';
import { calculatePace, distanceMeters, formatDuration, formatPace } from '../utils/format';

const fullDate = (date: string) => dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const localTime = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const base = import.meta.env.BASE_URL;
export const dayHref = (date: string) => `${base}?date=${date}`;
export const activityHref = (id: string) => `${base}?activity=${id}`;

export function ActivityDay({ date, distance }: { date: string; distance?: number }) {
  return (
    <>
      <div className="detail-header">
        <a href={base} data-route className="back-link">← Dashboard</a>
        <h1>{fullDate(date)}</h1>
        {distance !== undefined && <p className="panel-caption">{distanceMeters(distance)} m for the day</p>}
      </div>
      <DayRecords date={date} distance={distance} />
    </>
  );
}

function DayRecords({ date, distance }: { date: string; distance?: number }) {
  const index = useJson<ActivitySummary[]>('activities/index.json');
  const records = index.status === 'ready' ? index.data.filter(activity => activity.date === date) : [];
  const total = records.reduce((sum, activity) => sum + activity.distance, 0);

  return (
    <section className="panel" aria-labelledby="day-records">
      <h2 id="day-records">Recorded activities</h2>
      {index.status === 'loading' && <p className="page-message" role="status">Loading activities…</p>}
      {index.status === 'error' && <p className="page-message" role="alert">Could not load the activity list. Refresh to try again.</p>}
      {index.status === 'ready' && records.length === 0 && <p className="page-message">No individual activity files are available for this date.</p>}
      {records.length > 0 && <>
        <ul className="record-list day-records">
          {records.map((activity, index) => (
            <li key={activity.id}>
              <a href={activityHref(activity.id)} data-route>
                <span>
                  {activity.startedAt ? localTime.format(new Date(activity.startedAt)) : `Activity ${index + 1}`}
                  <small>{activity.duration === null ? 'Duration unavailable' : `${formatDuration(activity.duration)} total`}</small>
                </span>
                <span>{distanceMeters(activity.distance)} m <span aria-hidden="true">→</span></span>
              </a>
            </li>
          ))}
        </ul>
        {distance !== undefined && total !== distance && (
          <p className="chart-note">Tracked activities total {distanceMeters(total)} m. The dashboard uses the recorded daily total.</p>
        )}
      </>}
    </section>
  );
}

const metrics = [
  { label: 'Pace', unit: '/500 m', axis: 'Pace per 500 m', index: 1 },
  { label: 'Cadence', unit: 'spm', axis: 'Strokes per minute', index: 2 },
  { label: 'Power', unit: 'W', axis: 'Power in watts', index: 3 },
  { label: 'Heart rate', unit: 'bpm', axis: 'Heart rate in beats per minute', index: 4 },
] as const;

type MetricIndex = typeof metrics[number]['index'];

function ActivityChart({ activity }: { activity: ActivityDetail }) {
  const available = metrics.filter(metric => activity.segments.some(segment => segment.points.some(point => point[metric.index] !== null)));
  const [requestedMetric, setMetric] = useState<MetricIndex>(1);
  const metric = available.find(option => option.index === requestedMetric) ?? available[0];
  if (!metric || activity.duration === null) return (
    <section className="panel">
      <h2>Training trace</h2>
      <p className="page-message">This activity has no recorded chart samples.</p>
    </section>
  );
  const duration = activity.duration;
  const points = activity.segments.flatMap((segment, index) => {
    const samples = segment.points.map(point => ({ time: point[0], value: point[metric.index] }));
    if (index > 0) samples.unshift({ time: segment.start, value: null });
    return samples;
  });
  const formatValue = (value: number) => metric.index === 1 ? formatPace(value) : String(Math.round(value));

  return (
    <section className="panel trace-panel" aria-labelledby="trace-heading">
      <div className="panel-header">
        <div>
          <h2 id="trace-heading">Training trace</h2>
          <p className="panel-caption">{metric.axis}{activity.restSeconds > 0 ? ' · shaded bands mark recovery' : ''}</p>
        </div>
        {available.length > 1 && <div className="segmented-control" role="group" aria-label="Training trace metric">
          {available.map(option => <button key={option.index} type="button" aria-pressed={metric.index === option.index}
            onClick={() => setMetric(option.index)}>{option.label}</button>)}
        </div>}
      </div>
      <div className="trace-chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="#e0dfda" strokeDasharray="3 4" />
            <XAxis type="number" dataKey="time" domain={[0, duration]} tickFormatter={formatDuration} tickCount={5}
              tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#5c5953' }} />
            <YAxis width={46} domain={['auto', 'auto']} tickCount={5} reversed={metric.index === 1}
              tickFormatter={formatValue} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#5c5953' }} />
            <Tooltip labelFormatter={value => formatDuration(Number(value))}
              formatter={value => [`${formatValue(Number(value))} ${metric.unit}`, metric.label]} />
            {activity.segments.filter(segment => segment.resting).map((segment, index) => (
              <ReferenceArea key={index} x1={segment.start} x2={Math.min(segment.start + (segment.seconds ?? 0), duration)}
                fill="#b9b3a8" fillOpacity={0.24} />
            ))}
            <Line dataKey="value" stroke="#872e38" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-note">Elapsed time{metric.index === 1 ? ' · pace averaged over about 10 s' : ''}</p>
    </section>
  );
}

export function ActivityPage({ id }: { id: string }) {
  const detail = useJson<ActivityDetail>(`activities/details/${id}.json`);
  if (detail.status !== 'ready') return (
    <>
      <div className="detail-header">
        <a href={base} data-route className="back-link">← Dashboard</a>
        <h1>Activity details</h1>
      </div>
      {detail.status === 'loading' ? <p className="panel page-message" role="status">Loading activity…</p>
        : <p className="panel page-message" role="alert">This activity could not be loaded. Refresh to try again.</p>}
    </>
  );

  const activity = detail.data;
  const workTime = activity.duration === null ? null : activity.duration - activity.restSeconds;
  const hasRecovery = workTime !== null && activity.restSeconds > 0;
  const averagePace = workTime === null ? null : calculatePace(activity.workDistance, workTime);

  return (
    <>
      <div className="detail-header">
        <a href={dayHref(activity.date)} data-route className="back-link">← {dateLabel(activity.date)} activities</a>
        <p className="eyebrow">{fullDate(activity.date)}</p>
        <h1>Activity <em>details</em></h1>
      </div>
      <dl className="metric-strip detail-metrics">
        <StatCard label={hasRecovery ? 'Total distance' : 'Distance'} value={distanceMeters(activity.distance)} unit="m" />
        <StatCard label={hasRecovery ? 'Work time' : 'Duration'} value={workTime === null ? '—' : formatDuration(workTime)} />
        <StatCard label={hasRecovery ? 'Average work pace' : 'Average pace'} value={formatPace(averagePace)} unit="/500 m" accent />
        {hasRecovery && <StatCard label="Recovery time" value={formatDuration(activity.restSeconds)} />}
      </dl>
      <ActivityChart activity={activity} />
      {activity.segments.length > 1 && <section className="panel">
        <h2>Workout segments</h2>
        <table className="segment-table">
          <thead><tr><th scope="col">Segment</th><th scope="col">Distance</th><th scope="col">Time</th><th scope="col">Pace /500 m</th></tr></thead>
          <tbody>{activity.segments.map((segment, index) => (
            <tr key={index} className={segment.resting ? 'recovery-row' : undefined}>
              <th scope="row">{index + 1}. {segment.resting ? 'Recovery' : 'Work'}</th>
              <td>{distanceMeters(segment.distance)} m</td>
              <td>{segment.seconds === null ? '—' : formatDuration(segment.seconds)}</td>
              <td>{segment.resting || segment.seconds === null ? '—' : formatPace(calculatePace(segment.distance, segment.seconds))}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>}
    </>
  );
}
