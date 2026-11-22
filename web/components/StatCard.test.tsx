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
  });
});
