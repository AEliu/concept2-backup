import type { DailyDistances, DerivedStats } from '../types';
import { daysBetween, todayKey } from './calendar';

export const calculateDerivedStats = (dailyDistances: DailyDistances): DerivedStats => {
  const today = todayKey();
  const year = today.slice(0, 4);
  const month = today.slice(0, 7);
  const dates = Object.keys(dailyDistances).filter(date => date <= today).sort();

  let totalDistance = 0;
  let thisYearDistance = 0;
  let thisMonthDistance = 0;
  let streak = 0;
  let maxStreak = 0;
  let lastWorkoutDate: string | null = null;
  let totalWorkouts = 0;
  for (const date of dates) {
    const meters = dailyDistances[date];
    totalDistance += meters;
    if (date.startsWith(year)) thisYearDistance += meters;
    if (date.startsWith(month)) thisMonthDistance += meters;
    if (meters <= 0) continue;
    streak = lastWorkoutDate && daysBetween(lastWorkoutDate, date) === 1 ? streak + 1 : 1;
    maxStreak = Math.max(maxStreak, streak);
    lastWorkoutDate = date;
    totalWorkouts++;
  }

  return {
    totalDistance,
    totalWorkouts,
    currentStreak: lastWorkoutDate && daysBetween(lastWorkoutDate, today) <= 1 ? streak : 0,
    maxStreak,
    thisMonthDistance,
    thisYearDistance,
    lastWorkoutDate,
  };
};
