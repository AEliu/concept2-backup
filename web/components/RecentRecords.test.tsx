import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RecentRecords } from './RecentRecords';

const records: [string, number][] = [['2026-11-22', 5454], ['2026-10-07', 335]];

describe('RecentRecords', () => {
  it('renders aligned date parts and a separately formatted distance in the day link', () => {
    render(<RecentRecords records={records} demo={false} />);

    const link = screen.getByRole('link', { name: 'November 22, 2026, 5,454 meters' });
    expect(link.getAttribute('href')).toMatch(/\?date=2026-11-22$/);
    expect(link).toHaveAttribute('data-route');
    const date = link.querySelector('time');
    expect(date).toHaveAttribute('datetime', '2026-11-22');
    expect(Array.from(date?.children ?? [], part => part.textContent)).toEqual(['Sun', 'Nov', '22']);
    expect(within(link).getByText('5,454')).toHaveClass('recent-record-value');
    expect(within(link).getByText('m')).toHaveClass('recent-record-unit');
    expect(within(link).getByText('→')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: 'October 7, 2026, 335 meters' }))
      .toHaveTextContent('Wed Oct 7 335 m');
  });

  it('shows the same date and distance layout for demo rows without navigation', () => {
    render(<RecentRecords records={records} demo />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Sun Nov 22 5,454 m');
    expect(screen.queryByText('→')).not.toBeInTheDocument();
  });
});
