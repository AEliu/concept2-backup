import { dayHref } from './ActivityPages';
import { dateLabel } from '../utils/calendar';
import { distanceMeters } from '../utils/format';

export function RecentRecords({ records, demo }: { records: [string, number][]; demo: boolean }) {
  return (
    <section className="panel recent-panel" aria-labelledby="recent-heading">
      <div className="panel-header">
        <div>
          <h2 id="recent-heading">Recent records</h2>
          <p className="panel-caption">Distance by training day</p>
        </div>
      </div>
      {records.length ? (
        <ul className="record-list">
          {records.map(([date, meters]) => {
            const distance = distanceMeters(meters);
            const summary = (
              <>
                <time className="recent-record-date" dateTime={date}>
                  <span className="recent-record-weekday">{dateLabel(date, { weekday: 'short' })}</span>{' '}
                  <span>{dateLabel(date, { month: 'short' })}</span>{' '}
                  <span className="recent-record-day">{dateLabel(date, { day: 'numeric' })}</span>
                </time>{' '}
                <span className="recent-record-distance">
                  <span className="recent-record-value">{distance}</span>{' '}
                  <span className="recent-record-unit">m</span>
                </span>
              </>
            );

            return (
              <li key={date}>
                {demo ? <div className="recent-record-row">{summary}</div> : (
                  <a className="recent-record-row" href={dayHref(date)} data-route
                    aria-label={`${dateLabel(date, { month: 'long', day: 'numeric', year: 'numeric' })}, ${distance} meters`}>
                    {summary}{' '}
                    <span className="recent-record-arrow" aria-hidden="true">→</span>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : <p className="page-message">No training records yet.</p>}
    </section>
  );
}
