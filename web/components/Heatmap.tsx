import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { DailyDistances } from '../types';
import { addDays, dateLabel, daysBetween, startOfWeek } from '../utils/calendar';
import { distanceMeters } from '../utils/format';

const levels = ['0', '< 2', '2–<5', '5–<10', '10+'];

function level(meters: number) {
  if (meters <= 0) return 0;
  if (meters < 2000) return 1;
  if (meters < 5000) return 2;
  if (meters < 10000) return 3;
  return 4;
}

export function Heatmap({ data, today, dayHref }: {
  data: DailyDistances;
  today: string;
  dayHref?: (date: string) => string;
}) {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 699px)').matches);
  const [expanded, setExpanded] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 699px)');
    const resize = () => setCompact(query.matches);
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    if (compact && expanded && scroll.current) scroll.current.scrollLeft = scroll.current.scrollWidth;
  }, [compact, expanded]);

  const showYear = !compact || expanded;
  const first = showYear ? addDays(today, -364) : addDays(startOfWeek(today), -77);
  const start = startOfWeek(first);
  const weeks = Math.ceil((daysBetween(start, today) + 1) / 7);
  const dates = Array.from({ length: weeks * 7 }, (_, index) => addDays(start, index));
  const monthLabels: { month: string; column: number }[] = [];
  let lastMonth = '';
  dates.forEach((date, index) => {
    if (date < first || date > today || date.slice(0, 7) === lastMonth) return;
    const column = Math.floor(index / 7) + 1;
    lastMonth = date.slice(0, 7);
    const previous = monthLabels.at(-1);
    const label = { month: dateLabel(date, { month: 'short' }), column };
    if (!previous || column - previous.column >= 2) monthLabels.push(label);
    else if (monthLabels.length === 1) monthLabels[0] = label;
  });

  return (
    <section className="panel heatmap-panel" aria-labelledby="heatmap-heading">
      <div className="panel-header">
        <div>
          <h2 id="heatmap-heading">Training calendar</h2>
          <p className="panel-caption">{showYear ? 'Last 365 days' : 'Recent 12 weeks'} · daily distance</p>
        </div>
        {compact && <button className="text-button" type="button" aria-expanded={showYear} onClick={() => setExpanded(value => !value)}>
          {showYear ? 'Show 12 weeks' : 'Show full year'}
        </button>}
      </div>
      <div className={`calendar-frame${compact && showYear ? ' calendar-expanded' : ''}`}>
        <div className="calendar-weekdays" aria-hidden="true"><span>Mon</span><span>Wed</span><span>Fri</span></div>
        <div ref={scroll} className="calendar-scroll">
          <div className="calendar-layout" style={{ '--weeks': weeks } as CSSProperties}>
            <div className="calendar-months" aria-hidden="true">
              {monthLabels.map(({ month, column }) => <span key={column} style={{ gridColumn: column }}>{month}</span>)}
            </div>
            <div className="calendar-cells">
              {dates.map(date => {
                if (date < first || date > today) return <span key={date} aria-hidden="true" />;
                const meters = data[date] ?? 0;
                const title = `${dateLabel(date, { month: 'long', day: 'numeric', year: 'numeric' })} · ${distanceMeters(meters)} m`;
                return meters > 0 && dayHref
                  ? <a key={date} className={`calendar-cell level-${level(meters)}`} href={dayHref(date)} data-route aria-label={title} title={title} />
                  : <span key={date} className={`calendar-cell level-${level(meters)}`} title={title} />;
              })}
            </div>
          </div>
        </div>
      </div>
      <ul className="calendar-legend" aria-label="Daily distance in kilometers">
        {levels.map((text, index) => <li key={text}><span className={`level-${index}`} />{text}{index === 4 ? ' km' : ''}</li>)}
      </ul>
    </section>
  );
}
