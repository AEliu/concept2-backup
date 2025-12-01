import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatCard } from './StatCard';

describe('StatCard', () => {
  it('should render index and label', () => {
    const { container } = render(
      <StatCard index="01" label="Test Label" value="100" />
    );

    expect(container.textContent).toContain('01');
    expect(container.textContent).toContain('Test Label');
  });

  it('should render value', () => {
    const { container } = render(
      <StatCard index="01" label="Test" value="999" />
    );

    expect(container.textContent).toContain('999');
  });

  it('should render subValue when provided', () => {
    const { container } = render(
      <StatCard
        index="01"
        label="Test"
        value="100"
        subValue="Kilometers"
      />
    );

    expect(container.textContent).toContain('Kilometers');
  });

  it('should not render subValue when not provided', () => {
    const { container } = render(
      <StatCard index="01" label="Test" value="100" />
    );

    // Should not have the subValue div
    const subValueElement = container.querySelector('.border-l-2');
    expect(subValueElement).not.toBeInTheDocument();
  });

  it('should apply large class when large prop is true', () => {
    const { container } = render(
      <StatCard
        index="01"
        label="Test"
        value="100"
        large={true}
      />
    );

    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('h-full');
  });

  it('should have default height when large is false', () => {
    const { container } = render(
      <StatCard
        index="01"
        label="Test"
        value="100"
        large={false}
      />
    );

    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('h-48');
  });

  it('should handle numeric values', () => {
    const { container } = render(
      <StatCard index="01" label="Test" value={12345} />
    );

    expect(container.textContent).toContain('12345');
  });

  it('should render correct structure', () => {
    const { container } = render(
      <StatCard
        index="01"
        label="Streak"
        value="15"
        subValue="Days"
      />
    );

    // Should have the main container
    const card = container.firstChild;
    expect(card).toBeInTheDocument();

    // Should have the label section with index and label
    expect(container.textContent).toContain('01');
    expect(container.textContent).toContain('Streak');

    // Should have the value
    expect(container.textContent).toContain('15');

    // Should have the subValue
    expect(container.textContent).toContain('Days');
  });
});
