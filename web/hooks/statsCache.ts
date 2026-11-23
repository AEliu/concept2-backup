import type { StatsData } from '../types';

const cacheName = 'stats-data-cache';
const statsUrl = `${import.meta.env.BASE_URL}stats.json`;

function isStatsData(value: unknown): value is StatsData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const distances = (value as Record<string, unknown>).daily_distances;
  if (distances === null || typeof distances !== 'object' || Array.isArray(distances)) return false;

  return Object.entries(distances).every(([date, meters]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date)
    && typeof meters === 'number'
    && Number.isFinite(meters)
    && meters >= 0,
  );
}

async function readCachedStats(): Promise<StatsData | null> {
  if (!('caches' in window)) return null;
  try {
    const response = await (await caches.open(cacheName)).match(statsUrl);
    if (!response) return null;
    const data: unknown = await response.json();
    return isStatsData(data) ? data : null;
  } catch {
    return null;
  }
}

async function fetchAndCacheStats(signal?: AbortSignal): Promise<StatsData> {
  const response = await fetch(statsUrl, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const data: unknown = await response.clone().json();
  if (!isStatsData(data)) throw new Error('Invalid training statistics');

  if ('caches' in window && !signal?.aborted) {
    try {
      await (await caches.open(cacheName)).put(statsUrl, response);
    } catch {
      // The current response remains usable when persistent storage is unavailable.
    }
  }
  return data;
}

export async function loadStats(signal?: AbortSignal): Promise<StatsData> {
  try {
    return await fetchAndCacheStats(signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await readCachedStats();
    if (cached) return cached;
    throw error;
  }
}

export async function ensureOfflineStats(): Promise<boolean> {
  if (await readCachedStats()) return true;
  try {
    await fetchAndCacheStats();
  } catch {
    return false;
  }
  return (await readCachedStats()) !== null;
}
