interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  valueAccent?: boolean;
  href?: string;
}

export function StatCard({ label, value, unit, accent, valueAccent, href }: StatCardProps) {
  const statistic = <>
    {valueAccent ? <span className="metric-value-accent">{value}</span> : value}
    {unit && <small> {unit}</small>}
  </>;
  return (
    <div className={`metric${accent ? ' metric-accent' : ''}${href ? ' metric-linked' : ''}`}>
      <dt>{label}</dt>
      <dd>{href ? (
        <a className="metric-link" href={href} data-route aria-label={`${label}, ${value}`}>
          <span>{statistic}</span>
          <span className="metric-link-arrow" aria-hidden="true">→</span>
        </a>
      ) : statistic}</dd>
    </div>
  );
}
