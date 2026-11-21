const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const paceSeconds = new Intl.NumberFormat('en', { minimumIntegerDigits: 2, minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function distanceKm(meters: number) {
  return number.format(meters / 1000);
}

export function distanceMeters(meters: number) {
  return number.format(meters);
}

export function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function formatPace(seconds: number | null) {
  if (seconds === null) return '—';
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${paceSeconds.format((tenths % 600) / 10)}`;
}

export function calculatePace(meters: number, seconds: number) {
  return meters > 0 && seconds > 0 ? (seconds * 500) / meters : null;
}
