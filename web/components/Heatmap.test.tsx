import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Heatmap } from './Heatmap';

const today = '2026-11-22';
const data = { '2026-01-12': 1500, [today]: 5454 };
const dayHref = (date: string) => `?date=${date}`;

function setCompact(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('Heatmap', () => {
  it('keeps weekday labels outside the scrollable year and preserves day links when toggling', () => {
    setCompact(true);
    const { container } = render(<Heatmap data={data} today={today} dayHref={dayHref} />);

    const toggle = screen.getByRole('button', { name: 'Show full year' });
    const scroll = container.querySelector<HTMLDivElement>('.calendar-scroll')!;
    const frame = scroll.parentElement!;
    const weekdays = screen.getByText('Mon').parentElement!;
    Object.defineProperty(scroll, 'scrollWidth', { configurable: true, value: 1500 });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'January 12, 2026 · 1,500 m' })).not.toBeInTheDocument();
    expect(frame).toContainElement(weekdays);
    expect(frame).not.toHaveClass('calendar-expanded');
    expect(scroll).not.toContainElement(weekdays);

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Show 12 weeks' })).toHaveAttribute('aria-expanded', 'true');
    expect(frame).toHaveClass('calendar-expanded');
    expect(scroll.scrollLeft).toBe(1500);
    expect(screen.getByRole('link', { name: 'January 12, 2026 · 1,500 m' }))
      .toHaveAttribute('href', '?date=2026-01-12');
    expect(screen.getByRole('link', { name: 'November 22, 2026 · 5,454 m' }))
      .toHaveAttribute('data-route');

    fireEvent.click(screen.getByRole('button', { name: 'Show 12 weeks' }));
    expect(screen.getByRole('button', { name: 'Show full year' })).toHaveAttribute('aria-expanded', 'false');
    expect(frame).not.toHaveClass('calendar-expanded');
    expect(screen.queryByRole('link', { name: 'January 12, 2026 · 1,500 m' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'November 22, 2026 · 5,454 m' })).toBeInTheDocument();
  });

  it('retains the full-year desktop view and non-navigable demo cells', () => {
    setCompact(false);
    render(<Heatmap data={data} today={today} />);

    expect(screen.getByText('Last 365 days · daily distance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Show/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTitle('January 12, 2026 · 1,500 m')).toBeInTheDocument();
    expect(screen.getByTitle('November 22, 2026 · 5,454 m')).toBeInTheDocument();
  });
});
