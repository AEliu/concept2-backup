import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActivityDetail } from '../types';
import { ActivityPage } from './ActivityPages';

type ChartPoint = { time: number; value: number | null };
type TooltipFormatter = (value: number) => [string, string];
const chart = vi.hoisted(() => ({
  data: [] as ChartPoint[],
  formatTooltip: null as TooltipFormatter | null,
}));
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
    ReferenceDot: ({ x, y }: { x: number; y: number }) => <span data-testid="isolated-pace-point">{x}, {y}</span>,
    ResponsiveContainer: passThrough,
    Tooltip: ({ formatter }: { formatter: TooltipFormatter }) => {
      chart.formatTooltip = formatter;
      return null;
    },
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
  it('selects the first recorded metric and changes the trace and units on click only', () => {
    resource.detail = {
      ...tcx,
      segments: tcx.segments.map(segment => ({
        ...segment,
        points: segment.points.map(([time, , cadence, watts, heartRate]) => [time, null, cadence, watts, heartRate]),
      })),
    };

    render(<ActivityPage id="123" />);

    const cadence = screen.getByRole('button', { name: 'Cadence' });
    const power = screen.getByRole('button', { name: 'Power' });
    expect(screen.queryByRole('button', { name: 'Pace' })).not.toBeInTheDocument();
    expect(cadence).toHaveAttribute('aria-pressed', 'true');
    expect(chart.data[0]).toEqual({ time: 10, value: 25 });
    expect(chart.formatTooltip?.(25)).toEqual(['25 spm', 'Cadence']);

    fireEvent.mouseOver(power);
    expect(cadence).toHaveAttribute('aria-pressed', 'true');
    expect(power).toHaveAttribute('aria-pressed', 'false');
    expect(chart.data[0]).toEqual({ time: 10, value: 25 });
    expect(chart.formatTooltip?.(25)).toEqual(['25 spm', 'Cadence']);

    fireEvent.click(power);
    expect(cadence).toHaveAttribute('aria-pressed', 'false');
    expect(power).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Power in watts/)).toBeInTheDocument();
    expect(chart.data[0]).toEqual({ time: 10, value: 150 });
    expect(chart.formatTooltip?.(150)).toEqual(['150 W', 'Power']);
  });

  it('uses official split rows and per-stroke pace while keeping other metrics on TCX', () => {
    resource.detail = {
      ...tcx,
      official: {
        paceMeters: 1000,
        segments: [
          { seconds: 25.1, distance: 100, resting: false },
          { seconds: 10, distance: null, resting: true },
          { seconds: 25, distance: 100, resting: false },
          { seconds: 40, distance: null, resting: true },
        ],
        pace: {
          duration: 100.1,
          segments: [
            { start: 0, seconds: 25.1, resting: false, points: [[5, 200]] },
            { start: 25.1, seconds: 10, resting: true, points: [] },
            { start: 35.1, seconds: 25, resting: false, points: [[40, 210]] },
            { start: 60.1, seconds: 40, resting: true, points: [] },
          ],
        },
      },
    };

    render(<ActivityPage id="123" />);

    expect(screen.getByRole('columnheader', { name: 'Pace /1000 m' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /1\. Work 100 m 0:25\.1 4:11\.0/ })).toBeInTheDocument();
    expect(screen.getByText('Work time').parentElement).toHaveTextContent('0:50');
    expect(screen.getByText('Recovery time').parentElement).toHaveTextContent('0:50');
    expect(screen.getByText('Average work pace').parentElement).toHaveTextContent('/1000 m');
    expect(screen.getByText('Work and recovery use Concept2 Logbook intervals. Total distance uses TCX.')).toBeInTheDocument();
    const trace = within(screen.getByRole('region', { name: 'Training trace' }));
    const officialNote = 'Elapsed time · per-stroke pace · Concept2 Logbook';
    expect(trace.getByText('Pace per 1000 m')).toHaveClass('panel-caption');
    expect(trace.getByText(officialNote)).toHaveClass('chart-note');
    expect(trace.getByText('Shaded bands mark recovery.')).toHaveClass('chart-note');
    expect(chart.data).toEqual([
      { time: 5, value: 200 },
      { time: 25.1, value: null },
      { time: 35.1, value: null },
      { time: 40, value: 210 },
      { time: 60.1, value: null },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Power' }));
    expect(trace.getByText('Power in watts')).toHaveClass('panel-caption');
    expect(trace.getByText('TCX trace ends at 1:30. Concept2 Logbook intervals total 1:40.')).toHaveClass('chart-note');
    expect(trace.queryByText(officialNote)).not.toBeInTheDocument();
    expect(chart.data).toEqual([
      { time: 10, value: 150 },
      { time: 40, value: null },
      { time: 50, value: null },
      { time: 60, value: 160 },
    ]);
  });

  it('marks a single recorded TCX pace point without filling the gaps', () => {
    resource.detail = {
      ...tcx,
      segments: [{
        start: 0, seconds: 90, distance: 200, resting: false,
        points: [[1, null, 25, 150, 120], [11, 268.8, 26, 160, 130], [21, null, 25, 150, 120]],
      }],
    };

    render(<ActivityPage id="123" />);

    expect(chart.data.map(point => point.value)).toEqual([null, 268.8, null]);
    expect(screen.getByTestId('isolated-pace-point')).toHaveTextContent('11, 268.8');
    fireEvent.click(screen.getByRole('button', { name: 'Power' }));
    expect(screen.queryByTestId('isolated-pace-point')).not.toBeInTheDocument();
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
