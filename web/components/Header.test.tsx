import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Header } from './Header';

describe('Header', () => {
  it('should render main heading', () => {
    render(<Header />);

    expect(screen.getByText(/Rowing/i)).toBeInTheDocument();
    expect(screen.getByText(/Dynamics/i)).toBeInTheDocument();
  });

  it('should render subheading with project info', () => {
    render(<Header />);

    expect(screen.getByText(/Concept2/i)).toBeInTheDocument();
    expect(screen.getByText(/Visualization/i)).toBeInTheDocument();
  });

  it('should render GitHub link', () => {
    render(<Header />);

    const githubLink = screen.getByRole('link', { name: /GitHub Source/i });
    expect(githubLink).toBeInTheDocument();
    expect(githubLink).toHaveAttribute('href', 'https://github.com/Aeliu/concept2-backup');
    expect(githubLink).toHaveAttribute('target', '_blank');
    expect(githubLink).toHaveAttribute('rel', 'noreferrer');
  });

  it('should render Data Source label', () => {
    render(<Header />);

    expect(screen.getByText(/Data Source/i)).toBeInTheDocument();
  });

  it('should have correct heading hierarchy', () => {
    const { container } = render(<Header />);

    const h1Element = container.querySelector('h1');
    expect(h1Element).toBeInTheDocument();
    expect(h1Element?.textContent).toContain('Rowing');
  });

  it('should render arrow icon in GitHub link', () => {
    render(<Header />);

    const githubLink = screen.getByRole('link', { name: /GitHub Source/i });
    const svg = githubLink.querySelector('svg');

    expect(svg).toBeInTheDocument();
  });

  it('should have proper CSS classes for styling', () => {
    const { container } = render(<Header />);

    const header = container.querySelector('header');
    expect(header).toHaveClass('border-b', 'border-black', 'bg-[#f3f3f1]');
  });
});
