import { describe, expect, it } from 'vitest';
import { dailyVolume, monthlyVolume, weeklyVolume } from './calendar';

describe('training volume periods', () => {
  it('puts the last 30 consecutive calendar days on the chart, including rest days', () => {
    const points = dailyVolume({ '2026-10-22': 9000, '2026-10-23': 3000, '2026-11-21': 500, '2026-11-22': 7000 }, '2026-11-21');

    expect(points).toHaveLength(30);
    expect(points[0]).toMatchObject({ date: '2026-10-23', meters: 3000 });
    expect(points[1]).toMatchObject({ date: '2026-10-24', meters: 0 });
    expect(points.at(-1)).toMatchObject({ date: '2026-11-21', meters: 500 });
  });

  it('starts weeks on Monday and marks an unfinished week', () => {
    const points = weeklyVolume({ '2026-11-15': 1000, '2026-11-16': 3000, '2026-11-21': 500, '2026-11-22': 7000 }, '2026-11-21');

    expect(points.slice(-2)).toEqual([
      { date: '2026-11-09', meters: 1000, partial: false },
      { date: '2026-11-16', meters: 3500, partial: true },
    ]);
  });

  it('retains quiet months but does not include future months', () => {
    const points = monthlyVolume({ '2025-12-21': 1000, '2026-02-01': 2500, '2026-03-12': 3000, '2026-03-14': 500 }, '2026-03-13');

    expect(points).toEqual([
      { date: '2026-01-01', meters: 0, partial: false },
      { date: '2026-02-01', meters: 2500, partial: false },
      { date: '2026-03-01', meters: 3000, partial: true },
    ]);
  });
});
