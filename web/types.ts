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

export interface ActivitySummary {
  id: string;
  date: string;
  startedAt: string | null;
  distance: number;
  duration: number | null;
  restSeconds: number;
  workDistance: number;
}

export type ActivityPoint = [
  elapsed: number,
  pace: number | null,
  cadence: number | null,
  watts: number | null,
  heartRate: number | null,
];

export interface ActivitySegment {
  start: number;
  seconds: number | null;
  distance: number;
  resting: boolean;
  points: ActivityPoint[];
}

export interface OfficialSegment {
  seconds: number;
  distance: number | null;
  resting: boolean;
}

export interface OfficialPaceSegment {
  start: number;
  seconds: number;
  resting: boolean;
  points: [elapsed: number, pace: number][];
}

export interface OfficialActivityData {
  segments?: OfficialSegment[];
  paceMeters?: 500 | 1000;
  pace?: {
    duration: number;
    segments: OfficialPaceSegment[];
  };
}

export interface ActivityDetail extends ActivitySummary {
  segments: ActivitySegment[];
  official?: OfficialActivityData;
}
