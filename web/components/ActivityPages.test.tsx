import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityDetail } from '../types';
import { ActivityPage } from './ActivityPages';

type ChartPoint = { time: number; value: number | null };
const chart = vi.hoisted(() => ({ data: [] as ChartPoint[] }));
const resource = vi.hoisted(() => ({ detail: null as ActivityDetail | null }));

vi.mock('../hooks/useJson', () => ({
  useJson: () => ({ status: 'ready', data: resource.detail }),
}));

vi.mock('recharts', () => {
  const passThrough = ({ children }: { children: React.ReactNode }) => children;
  const empty = () => null;
  return {
    CartesianGrid: empty,
    Line: empty,
    LineChart: ({ data, children }: { data: ChartPoint[]; children: React.ReactNode }) => {
      chart.data = data;
      return children;
    },
    ReferenceArea: empty,
    ResponsiveContainer: passThrough,
    Tooltip: empty,
    XAxis: empty,
    YAxis: empty,
  };
});

const tcx: ActivityDetail = {
  id: '123',
  date: '2026-11-12',
  startedAt: '2026-11-12T07:00:00Z',
  distance: 200,
  duration: 90,
  restSeconds: 10,
  workDistance: 200,
  segments: [
    { start: 0, seconds: 40, distance: 100, resting: false, points: [[10, 110, 25, 150, 120]] },
    { start: 40, seconds: 10, distance: 0, resting: true, points: [] },
    { start: 50, seconds: 40, distance: 100, resting: false, points: [[60, 115, 26, 160, 130]] },
  ],
};

describe('ActivityPage', () => {
  it('uses official split rows and per-stroke pace while keeping other metrics on TCX', () => {
    resource.detail = {
      ...tcx,
      official: {
        paceMeters: 1000,
        segments: [
          { seconds: 25.1, distance: 100, resting: false },
          { seconds: 10, distance: null, resting: true },
          { seconds: 25, distance: 100, resting: false },
        ],
        pace: {
          duration: 60,
          segments: [
            { start: 0, seconds: 25, resting: false, points: [[5, 200]] },
            { start: 25, seconds: 10, resting: true, points: [] },
            { start: 35, seconds: 25, resting: false, points: [[40, 210]] },
          ],
        },
      },
    };

    render(<ActivityPage id="123" />);

    expect(screen.getByRole('columnheader', { name: 'Pace /1000 m' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /1\. Work 100 m 0:25\.1 4:11\.0/ })).toBeInTheDocument();
    expect(screen.getByText('Elapsed time · per-stroke pace')).toBeInTheDocument();
    expect(chart.data).toEqual([
      { time: 5, value: 200 },
      { time: 25, value: null },
      { time: 35, value: null },
      { time: 40, value: 210 },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Power' }));
    expect(chart.data).toEqual([
      { time: 10, value: 150 },
      { time: 40, value: null },
      { time: 50, value: null },
      { time: 60, value: 160 },
    ]);
  });

  it('keeps TCX pace when official strokes are missing and shows one official split', () => {
    resource.detail = {
      ...tcx,
      official: {
        segments: [{ seconds: 80, distance: 200, resting: false }],
      },
    };

    render(<ActivityPage id="123" />);

    expect(screen.getByRole('row', { name: '1. Work 200 m 1:20.0' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /Pace/ })).not.toBeInTheDocument();
    expect(screen.getByText('Elapsed time · pace averaged over about 10 s')).toBeInTheDocument();
    expect(chart.data[0]).toEqual({ time: 10, value: 110 });
  });

  it('keeps the original TCX segment table when no official data exists', () => {
    resource.detail = tcx;

    render(<ActivityPage id="123" />);

    expect(screen.getByRole('columnheader', { name: 'Pace /500 m' })).toBeInTheDocument();
    expect(screen.queryByText('Concept2 Logbook')).not.toBeInTheDocument();
    expect(chart.data[0]).toEqual({ time: 10, value: 110 });
  });
});
