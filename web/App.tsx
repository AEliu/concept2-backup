import { useEffect, useState, type MouseEvent } from 'react';
import { ActivityDay, ActivityPage, dayHref } from './components/ActivityPages';
import { Header } from './components/Header';
import { Heatmap } from './components/Heatmap';
import { PWAToast } from './components/PWAToast';
import { StatCard } from './components/StatCard';
import { TrainingVolume } from './components/TrainingVolume';
import { useJson } from './hooks/useJson';
import { usePWA } from './hooks/usePWA';
import type { DailyDistances, StatsData } from './types';
import { addDays, dailyVolume, dateLabel, todayKey } from './utils/calendar';
import { distanceKm, distanceMeters } from './utils/format';
import { calculateDerivedStats } from './utils/statsCalculator';

type Route = { page: 'dashboard' } | { page: 'day'; date: string } | { page: 'activity'; id: string };

function readRoute(search: string): Route {
  const query = new URLSearchParams(search);
  const id = query.get('activity');
  if (id && /^[1-9]\d{0,15}$/.test(id)) return { page: 'activity', id };
  const date = query.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) {
      return { page: 'day', date };
    }
  }
  return { page: 'dashboard' };
}

function demoDistances(today: string): DailyDistances {
  return Object.fromEntries([5000, 5200, 4047, 4328, 2000, 5900, 6000, 2000, 8000]
    .map((meters, index) => [addDays(today, -((8 - index) * 3)), meters]));
}

function Dashboard({ onDay }: { onDay: (date: string) => void }) {
  const resource = useJson<StatsData>('stats.json');
  const today = todayKey();

  if (resource.status === 'loading') return <p className="panel page-message" role="status">Loading training data…</p>;

  const demo = resource.status === 'error';
  const data = resource.status === 'ready' ? resource.data.daily_distances : demoDistances(today);
  const stats = calculateDerivedStats(data, today);
  const recent = dailyVolume(data, today);
  const recentTotal = recent.reduce((sum, day) => sum + day.meters, 0);
  const daysLogged = recent.filter(day => day.meters > 0).length;
  const lastRecords = Object.entries(data).filter(([date, meters]) => date <= today && meters > 0)
    .sort(([first], [second]) => second.localeCompare(first)).slice(0, 5);

  return (
    <>
      {demo && <p className="demo-banner" role="status">Demo data · live training data is unavailable.</p>}
      <dl className="metric-strip dashboard-metrics" aria-label="Training overview">
        <StatCard label="Distance · 30 days" value={distanceKm(recentTotal)} unit="km" accent />
        <StatCard label="Training days · 30 days" value={daysLogged} unit="/ 30" />
        <StatCard label="This month" value={distanceKm(stats.thisMonthDistance)} unit="km" />
        <StatCard label="Last training day" value={lastRecords[0] ? dateLabel(lastRecords[0][0]) : '—'} />
      </dl>
      <div className="dashboard-panels">
        <TrainingVolume data={data} today={today} onDay={demo ? undefined : onDay} />
        <section className="panel recent-panel" aria-labelledby="recent-heading">
          <div className="panel-header">
            <div>
              <h2 id="recent-heading">Recent records</h2>
              <p className="panel-caption">Distance by training day</p>
            </div>
          </div>
          {lastRecords.length ? (
            <ul className="record-list">
              {lastRecords.map(([date, meters]) => (
                <li key={date}>
                  {demo ? <div className="demo-record"><time dateTime={date}>{dateLabel(date)}</time><span>{distanceMeters(meters)} m</span></div>
                    : <a href={dayHref(date)} data-route aria-label={`${dateLabel(date, { month: 'long', day: 'numeric', year: 'numeric' })}, ${distanceMeters(meters)} meters`}>
                    <time dateTime={date}>{dateLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}</time>
                    <span>{distanceMeters(meters)} m <span aria-hidden="true">→</span></span>
                  </a>}
                </li>
              ))}
            </ul>
          ) : <p className="page-message">No training records yet.</p>}
        </section>
        <Heatmap data={data} today={today} dayHref={demo ? undefined : dayHref} />
      </div>
      <section className="long-term" aria-labelledby="history-heading">
        <h2 id="history-heading">Training history</h2>
        <dl className="metric-strip history-metrics">
          <StatCard label="This year" value={distanceKm(stats.thisYearDistance)} unit="km" />
          <StatCard label="All time" value={distanceKm(stats.totalDistance)} unit="km" />
          <StatCard label="Current streak" value={stats.currentStreak} unit="days" />
          <StatCard label="Longest streak" value={stats.maxStreak} unit="days" />
        </dl>
      </section>
    </>
  );
}

function DayRoute({ date }: { date: string }) {
  const resource = useJson<StatsData>('stats.json');
  return <ActivityDay date={date} distance={resource.status === 'ready' ? resource.data.daily_distances[date] : undefined} />;
}

function App() {
  const [search, setSearch] = useState(() => window.location.search);
  const route = readRoute(search);
  const { needRefresh, offlineReady, updateServiceWorker } = usePWA();

  useEffect(() => {
    const onPopState = () => setSearch(window.location.search);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(href: string) {
    const url = new URL(href, window.location.href);
    if (url.search === window.location.search) return;
    window.history.pushState(null, '', url);
    setSearch(url.search);
    window.scrollTo(0, 0);
    document.getElementById('page-content')?.focus({ preventScroll: true });
  }

  function handleLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-route]');
    if (!link) return;
    event.preventDefault();
    navigate(link.href);
  }

  return (
    <div className="site-shell" onClick={handleLink}>
      {route.page === 'dashboard' && <Header />}
      <main id="page-content" tabIndex={-1} className={`site-width ${route.page === 'dashboard' ? 'dashboard' : 'activity-page'}`}>
        {route.page === 'dashboard' && <Dashboard onDay={date => navigate(dayHref(date))} />}
        {route.page === 'day' && <DayRoute date={route.date} />}
        {route.page === 'activity' && <ActivityPage key={route.id} id={route.id} />}
      </main>
      <footer className="site-width site-footer">
        <span>Concept2 Logbook</span>
        <a href="https://github.com/Aeliu/concept2-backup" target="_blank" rel="noreferrer">GitHub source ↗︎</a>
      </footer>
      {needRefresh && <PWAToast message="New version available" actionLabel="Update" onAction={() => updateServiceWorker(true)} />}
      {offlineReady && !needRefresh && <PWAToast message="App ready to work offline" onClose={() => {}} />}
    </div>
  );
}

export default App;
