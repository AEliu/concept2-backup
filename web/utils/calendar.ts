import type { DailyDistances } from '../types';

const dayMs = 86_400_000;

export function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDate(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

export function isCalendarDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = calendarDate(date);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function addDays(date: string, days: number) {
  return new Date(calendarDate(date).getTime() + days * dayMs).toISOString().slice(0, 10);
}

export function daysBetween(first: string, last: string) {
  return (calendarDate(last).getTime() - calendarDate(first).getTime()) / dayMs;
}

export function startOfWeek(date: string) {
  const weekday = calendarDate(date).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  return calendarDate(date).toLocaleDateString('en', { ...options, timeZone: 'UTC' });
}

export function dailyVolume(data: DailyDistances, today: string, days = 30) {
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(today, index - days + 1);
    return { date, meters: data[date] ?? 0, partial: false };
  });
}

export function weeklyVolume(data: DailyDistances, today: string, weeks = 8) {
  const currentWeek = startOfWeek(today);
  return Array.from({ length: weeks }, (_, index) => {
    const date = addDays(currentWeek, (index - weeks + 1) * 7);
    const days = Math.min(7, daysBetween(date, today) + 1);
    const meters = dailyVolume(data, addDays(date, days - 1), days).reduce((sum, day) => sum + day.meters, 0);
    return { date, meters, partial: days < 7 };
  });
}

export function monthlyVolume(data: DailyDistances, today: string) {
  const year = today.slice(0, 4);
  const totals = new Map<string, number>();
  for (const [date, meters] of Object.entries(data)) {
    if (!date.startsWith(year) || date > today) continue;
    const month = date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + meters);
  }
  return Array.from({ length: Number(today.slice(5, 7)) }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const date = `${month}-01`;
    const partial = month === today.slice(0, 7) && addDays(today, 1).slice(0, 7) === month;
    return { date, meters: totals.get(month) ?? 0, partial };
  });
}
