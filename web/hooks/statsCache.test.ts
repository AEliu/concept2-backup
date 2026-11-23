import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureOfflineStats, loadStats } from './statsCache';

const savedStats = { daily_distances: { '2024-02-29': 4000, '2026-11-21': 5000 } };
const validResponse = () => new Response(JSON.stringify(savedStats), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('offline statistics cache', () => {
  let entries: Map<string, Response>;
  let fetchStats: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    entries = new Map();
    fetchStats = vi.fn();
    vi.stubGlobal('fetch', fetchStats);
    vi.stubGlobal('caches', {
      open: vi.fn(async (name: string) => {
        expect(name).toBe('stats-data-cache');
        return {
          match: async (url: string) => entries.get(url)?.clone(),
          put: async (url: string, response: Response) => {
            entries.set(url, response.clone());
          },
        };
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a first visit response and loads it when the network fails', async () => {
    fetchStats.mockResolvedValueOnce(validResponse());
    expect(await loadStats()).toEqual(savedStats);
    expect(await ensureOfflineStats()).toBe(true);
    expect(fetchStats).toHaveBeenCalledTimes(1);

    fetchStats.mockRejectedValueOnce(new TypeError('offline'));
    expect(await loadStats()).toEqual(savedStats);
  });

  it('fetches valid data for a service worker installed on a detail page', async () => {
    fetchStats.mockResolvedValueOnce(validResponse());
    expect(await ensureOfflineStats()).toBe(true);
    expect(entries.size).toBe(1);
  });

  it('rejects HTML and invalid statistics without reporting offline readiness', async () => {
    fetchStats.mockResolvedValueOnce(new Response('<html>Not Found</html>', { status: 200 }));
    await expect(loadStats()).rejects.toThrow();
    expect(entries.size).toBe(0);

    fetchStats.mockResolvedValueOnce(new Response(JSON.stringify({ daily_distances: { '2026-11-21': -1 } }), { status: 200 }));
    expect(await ensureOfflineStats()).toBe(false);
    expect(entries.size).toBe(0);
  });

  it('keeps the last valid statistics when the server returns HTML later', async () => {
    fetchStats.mockResolvedValueOnce(validResponse());
    expect(await loadStats()).toEqual(savedStats);

    fetchStats.mockResolvedValueOnce(new Response('<html>Not Found</html>', { status: 200 }));
    expect(await loadStats()).toEqual(savedStats);
    expect(await ensureOfflineStats()).toBe(true);
    expect(entries.size).toBe(1);
  });

  it.each(['2026-11-00', '2026-02-29', '2026-04-31'])(
    'keeps the last valid statistics when the server returns the invalid date %s',
    async date => {
      fetchStats.mockResolvedValueOnce(validResponse());
      expect(await loadStats()).toEqual(savedStats);

      fetchStats.mockResolvedValueOnce(Response.json({
        daily_distances: { ...savedStats.daily_distances, [date]: 8000 },
      }));
      expect(await loadStats()).toEqual(savedStats);

      fetchStats.mockRejectedValueOnce(new TypeError('offline'));
      expect(await loadStats()).toEqual(savedStats);
    },
  );
});
