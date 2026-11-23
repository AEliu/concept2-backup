import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useJson } from '../hooks/useJson';
import type { DailyDistances, StatsData } from '../types';
import { addMonths, dateLabel, daysInMonth, weekdayIndex } from '../utils/calendar';
import { distanceKm, distanceMeters } from '../utils/format';
import { dayHref, monthHref } from './ActivityPages';
import { StatCard } from './StatCard';

const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthLabel = (month: string) => dateLabel(`${month}-01`, { month: 'long', year: 'numeric' });
const monthNumbers = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

function Chevron({ direction }: { direction: 'left' | 'right' | 'down' }) {
  return <span className="month-chevron" data-direction={direction} aria-hidden="true" />;
}

function MonthNavigation({ month, today, data, onMonth }: {
  month: string;
  today: string;
  data: DailyDistances;
  onMonth: (month: string) => void;
}) {
  const [year, setYear] = useState<number | null>(null);
  const navigation = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const open = year !== null;

  useEffect(() => {
    if (!open) return;

    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !navigation.current?.contains(event.target)) setYear(null);
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setYear(null);
      trigger.current?.focus();
    }

    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  const current = today.slice(0, 7);
  const first = Object.entries(data).reduce((earliest, [date, meters]) => {
    const candidate = date.slice(0, 7);
    return meters > 0 && date <= today && candidate < earliest ? candidate : earliest;
  }, current);
  const previous = month > current ? current : month > first ? addMonths(month, -1) : undefined;
  const next = month < first ? first : month < current ? addMonths(month, 1) : undefined;
  const firstYear = Number(first.slice(0, 4));
  const currentYear = Number(current.slice(0, 4));
  const viewedYear = Number(month.slice(0, 4));
  const initialYear = Math.min(currentYear, Math.max(firstYear, viewedYear));

  return (
    <nav className="month-navigation" aria-label="Browse training months" ref={navigation}
      onBlur={event => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setYear(null);
      }}>
      {previous
        ? <a className="month-step" href={monthHref(previous)} data-route onClick={() => setYear(null)}
          aria-label={`Previous month, ${monthLabel(previous)}`}><Chevron direction="left" /></a>
        : <span className="month-step month-step-muted" aria-hidden="true"><Chevron direction="left" /></span>}
      <button className="month-picker-trigger" type="button" ref={trigger} aria-expanded={open}
        aria-controls={open ? 'month-picker' : undefined} onClick={() => setYear(open ? null : initialYear)}>
        Choose month <Chevron direction="down" />
      </button>
      {year !== null && (
        <section className="month-picker" id="month-picker" aria-label="Choose training month">
          <div className="month-picker-heading">
            <button className="month-step" type="button" aria-label="Previous year" aria-disabled={year === firstYear}
              onClick={() => setYear(Math.max(year - 1, firstYear))}><Chevron direction="left" /></button>
            <span className="month-picker-year" aria-live="polite">{year}</span>
            <button className="month-step" type="button" aria-label="Next year" aria-disabled={year === currentYear}
              onClick={() => setYear(Math.min(year + 1, currentYear))}><Chevron direction="right" /></button>
          </div>
          <div className="month-picker-grid">
            {monthNumbers.map(number => {
              const option = `${String(year).padStart(4, '0')}-${number}`;
              return (
                <button type="button" key={number} aria-label={monthLabel(option)}
                  aria-current={option === month ? 'true' : undefined} disabled={option < first || option > current}
                  onClick={() => {
                    setYear(null);
                    onMonth(option);
                    trigger.current?.focus();
                  }}>
                  {dateLabel(`${option}-01`, { month: 'short' })}
                </button>
              );
            })}
          </div>
        </section>
      )}
      {next
        ? <a className="month-step" href={monthHref(next)} data-route onClick={() => setYear(null)}
          aria-label={`Next month, ${monthLabel(next)}`}><Chevron direction="right" /></a>
        : <span className="month-step month-step-muted" aria-hidden="true"><Chevron direction="right" /></span>}
    </nav>
  );
}

function MonthCalendar({ month, today, data }: { month: string; today: string; data: DailyDistances }) {
  const days = Array.from({ length: daysInMonth(month) }, (_, index) => {
    const day = index + 1;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    return { day, date, meters: date <= today ? data[date] ?? 0 : 0 };
  });
  const total = days.reduce((sum, day) => sum + day.meters, 0);
  const activeDays = days.filter(day => day.meters > 0).length;
  const firstWeekday = weekdayIndex(days[0].date) + 1;

  return (
    <>
      <dl className="metric-strip month-metrics" aria-label="Monthly training totals">
        <StatCard label="Total distance" value={distanceKm(total)} unit="km" valueAccent />
        <StatCard label="Training days" value={activeDays} />
        <StatCard label="Average per training day" value={activeDays ? distanceKm(total / activeDays) : '—'} unit={activeDays ? 'km' : undefined} />
      </dl>
      <section className="panel month-calendar" aria-labelledby="month-calendar-heading">
        <div className="panel-header">
          <div>
            <h2 id="month-calendar-heading">Training calendar</h2>
            <p className="panel-caption">{month > today.slice(0, 7) ? 'This month hasn’t started.'
              : !activeDays ? 'No distance recorded this month.'
              : 'Daily distance in kilometers'}</p>
          </div>
        </div>
        <div className="month-weekdays" aria-hidden="true">
          {weekdays.map(weekday => <span key={weekday}>{weekday}</span>)}
        </div>
        <ol className="month-days" role="list" style={{ '--first-weekday': firstWeekday } as CSSProperties}>
          {days.map(({ day, date, meters }) => {
            const label = dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            const dayNumber = <time dateTime={date} aria-current={date === today ? 'date' : undefined}>{day}</time>;

            return (
              <li key={date}>
                {meters > 0 ? (
                  <a className="month-day month-day-recorded" href={dayHref(date)} data-route
                    aria-label={`${label}, ${distanceMeters(meters)} meters`}>
                    {dayNumber}
                    <span className="month-day-distance">{meters < 10 ? '<0.01' : distanceKm(meters)}</span>
                  </a>
                ) : (
                  <div className={`month-day${date > today ? ' month-day-upcoming' : ''}`}>
                    <span className="sr-only">{label}</span>
                    {dayNumber}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

export function TrainingMonth({ month, today, onMonth }: { month: string; today: string; onMonth: (month: string) => void }) {
  const resource = useJson<StatsData>('stats.json');

  return (
    <>
      <header className="detail-header">
        <a href={import.meta.env.BASE_URL} data-route className="back-link">← Dashboard</a>
        <div className="month-heading">
          <h1>{monthLabel(month)}</h1>
          {resource.status === 'ready' && <MonthNavigation month={month} today={today} data={resource.data.daily_distances} onMonth={onMonth} />}
        </div>
      </header>
      {resource.status === 'loading' && <p className="panel page-message" role="status">Loading training data…</p>}
      {resource.status === 'error' && <p className="panel page-message" role="alert">Could not load monthly training data. Refresh to try again.</p>}
      {resource.status === 'ready' && <MonthCalendar month={month} today={today} data={resource.data.daily_distances} />}
    </>
  );
}
