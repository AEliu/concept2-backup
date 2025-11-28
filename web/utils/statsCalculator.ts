import { DailyDistances, DerivedStats } from '../types';

export const calculateDerivedStats = (dailyDistances: DailyDistances): DerivedStats => {
  const dates = Object.keys(dailyDistances).sort();
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  let totalDistance = 0;
  let thisYearDistance = 0;
  let thisMonthDistance = 0;
  let currentStreak = 0;
  let maxStreak = 0;
  let tempStreak = 0;

  if (dates.length === 0) {
    return {
      totalDistance: 0,
      totalWorkouts: 0,
      currentStreak: 0,
      maxStreak: 0,
      thisMonthDistance: 0,
      thisYearDistance: 0,
      lastWorkoutDate: null,
    };
  }

  // 1. Calculate Sums
  dates.forEach(dateStr => {
    const meters = dailyDistances[dateStr];
    totalDistance += meters;

    const dateObj = new Date(dateStr);
    if (dateObj.getFullYear() === currentYear) {
      thisYearDistance += meters;
      if (dateObj.getMonth() === currentMonth) {
        thisMonthDistance += meters;
      }
    }
  });

  // 2. Calculate Streaks
  // We need to iterate through sorted dates to find streaks
  for (let i = 0; i < dates.length; i++) {
    const currentDate = new Date(dates[i]);
    const prevDate = i > 0 ? new Date(dates[i - 1]) : null;

    if (prevDate) {
      const diffTime = Math.abs(currentDate.getTime() - prevDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    } else {
      tempStreak = 1;
    }

    if (tempStreak > maxStreak) {
      maxStreak = tempStreak;
    }
  }

  // 3. Calculate Current Streak
  // Check if the last workout was today or yesterday to consider the streak "active"
  const lastDateStr = dates[dates.length - 1];
  const lastDate = new Date(lastDateStr);
  const diffFromToday = Math.ceil((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Note: diffFromToday might be slightly off due to timezones, roughly < 2 days means active
  // If the last entry is today (0) or yesterday (1), the streak is alive.
  // However, we need to count backwards from the end of the array.
  
  if (diffFromToday <= 2) {
      let activeStreak = 1;
      for (let i = dates.length - 1; i > 0; i--) {
          const curr = new Date(dates[i]);
          const prev = new Date(dates[i - 1]);
          const diff = Math.ceil((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
          if (diff === 1) {
              activeStreak++;
          } else {
              break;
          }
      }
      currentStreak = activeStreak;
  } else {
      currentStreak = 0;
  }

  return {
    totalDistance,
    totalWorkouts: dates.length,
    currentStreak,
    maxStreak,
    thisMonthDistance,
    thisYearDistance,
    lastWorkoutDate: lastDateStr,
  };
};
