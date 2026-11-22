import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';

describe('Header', () => {
  it('names the dashboard and its data source', () => {
    render(<Header />);

    expect(screen.getByRole('heading', { level: 1, name: 'Rowing Dynamics' })).toBeInTheDocument();
    expect(screen.getByText('Concept2 Logbook')).toBeInTheDocument();
  });
});
