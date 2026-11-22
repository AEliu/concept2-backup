interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
}

export function StatCard({ label, value, unit, accent = false }: StatCardProps) {
  return (
    <div className={`metric${accent ? ' metric-accent' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}{unit && <small> {unit}</small>}</dd>
    </div>
  );
}
