export interface DailyDistances {
  [date: string]: number;
}

export interface StatsData {
  daily_distances: DailyDistances;
}

export interface DerivedStats {
  totalDistance: number;
  totalWorkouts: number;
  currentStreak: number;
  maxStreak: number;
  thisMonthDistance: number;
  thisYearDistance: number;
  lastWorkoutDate: string | null;
}
