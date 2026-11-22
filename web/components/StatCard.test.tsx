import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('keeps the unit alongside the statistic', () => {
    render(<dl><StatCard label="Distance" value={24.56} unit="km" /></dl>);
    expect(screen.getByText('Distance').tagName).toBe('DT');
    expect(screen.getByRole('definition')).toHaveTextContent('24.56 km');
  });

  it('renders statistics without a distance or duration unit', () => {
    render(<dl><StatCard label="Last training day" value="Nov 21" /></dl>);
    expect(screen.getByRole('definition')).toHaveTextContent('Nov 21');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('can emphasize the value without highlighting the whole card or the unit', () => {
    render(<dl><StatCard label="Distance" value="24.56" unit="km" valueAccent /></dl>);
    expect(screen.getByText('24.56')).toHaveClass('metric-value-accent');
    expect(screen.getByText('km')).not.toHaveClass('metric-value-accent');
    expect(screen.getByRole('definition').parentElement).not.toHaveClass('metric-accent');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers a named day link and a decorative arrow when a route is available', () => {
    const href = '/concept2-backup/?date=2026-11-21';
    render(<dl><StatCard label="Last training day" value="Nov 21" href={href} /></dl>);
    const link = screen.getByRole('link', { name: 'Last training day, Nov 21' });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAttribute('data-route');
    expect(screen.getByText('→')).toHaveAttribute('aria-hidden', 'true');
  });
});
