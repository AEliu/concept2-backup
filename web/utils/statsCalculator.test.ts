import { describe, it, expect } from 'vitest';
import { calculateDerivedStats } from './statsCalculator';
import { DailyDistances } from '@/types';

describe('statsCalculator', () => {
  describe('calculateDerivedStats', () => {
    it('should return zero values for empty data', () => {
      const emptyData: DailyDistances = {};
      const result = calculateDerivedStats(emptyData);

      expect(result).toEqual({
        totalDistance: 0,
        totalWorkouts: 0,
        currentStreak: 0,
        maxStreak: 0,
        thisMonthDistance: 0,
        thisYearDistance: 0,
        lastWorkoutDate: null,
      });
    });

    it('should calculate total distance correctly', () => {
      const data: DailyDistances = {
        '2024-11-20': 5000,
        '2024-11-21': 5200,
        '2024-11-22': 4047,
      };
      const result = calculateDerivedStats(data);

      expect(result.totalDistance).toBe(5000 + 5200 + 4047);
    });

    it('should count total workouts', () => {
      const data: DailyDistances = {
        '2024-11-20': 5000,
        '2024-11-21': 5200,
        '2024-11-22': 4047,
      };
      const result = calculateDerivedStats(data);

      expect(result.totalWorkouts).toBe(3);
    });

    it('should identify max streak (non-consecutive)', () => {
      const data: DailyDistances = {
        '2024-11-20': 5000,
        '2024-11-21': 5200, // +1
        '2024-11-23': 4047, // reset, streak = 1
        '2024-11-24': 2000, // +1, streak = 2
      };
      const result = calculateDerivedStats(data);

      expect(result.maxStreak).toBe(2);
    });

    it('should identify current streak when last workout was recent', () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const yyyy = yesterday.getFullYear();
      const mm = String(yesterday.getMonth() + 1).padStart(2, '0');
      const dd = String(yesterday.getDate()).padStart(2, '0');

      const data: DailyDistances = {
        [`${yyyy}-${mm}-${dd}`]: 5000,
      };

      const result = calculateDerivedStats(data);

      expect(result.currentStreak).toBe(1);
    });

    it('should calculate current streak for consecutive days', () => {
      const today = new Date();
      const date1 = new Date(today);
      date1.setDate(date1.getDate() - 2);
      const date2 = new Date(today);
      date2.setDate(date2.getDate() - 1);

      const formatDate = (date: Date) => {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      };

      const data: DailyDistances = {
        [formatDate(date1)]: 5000,
        [formatDate(date2)]: 5200,
      };

      const result = calculateDerivedStats(data);

      expect(result.currentStreak).toBe(2);
    });

    it('should set current streak to 0 when last workout was long ago', () => {
      const data: DailyDistances = {
        '2023-01-01': 5000,
      };
      const result = calculateDerivedStats(data);

      expect(result.currentStreak).toBe(0);
    });

    it('should calculate this year distance correctly', () => {
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;

      const data: DailyDistances = {
        [`${currentYear}-11-20`]: 5000,
        [`${currentYear}-11-21`]: 5200,
        [`${lastYear}-12-31`]: 10000, // Should not count
      };

      const result = calculateDerivedStats(data);

      expect(result.thisYearDistance).toBe(5000 + 5200);
    });

    it('should calculate this month distance correctly', () => {
      const today = new Date();
      const currentYear = today.getFullYear();
      const currentMonth = today.getMonth() + 1; // 1-indexed for string formatting
      const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const yearForLastMonth = currentMonth === 1 ? currentYear - 1 : currentYear;

      const mm = String(currentMonth).padStart(2, '0');
      const lastMm = String(lastMonth).padStart(2, '0');

      const data: DailyDistances = {
        [`${currentYear}-${mm}-20`]: 5000,
        [`${currentYear}-${mm}-21`]: 5200,
        [`${yearForLastMonth}-${lastMm}-25`]: 10000, // Should not count
      };

      const result = calculateDerivedStats(data);

      expect(result.thisMonthDistance).toBe(5000 + 5200);
    });

    it('should include last workout date', () => {
      const data: DailyDistances = {
        '2024-11-19': 3000,
        '2024-11-20': 5000,
        '2024-11-21': 5200,
      };
      const result = calculateDerivedStats(data);

      expect(result.lastWorkoutDate).toBe('2024-11-21');
    });

    it('should handle data with gaps correctly', () => {
      const data: DailyDistances = {
        '2024-11-20': 5000,
        '2024-11-21': 5200, // streak 2
        '2024-11-23': 4047, // gap, streak 1
        '2024-11-24': 2000, // streak 2
        '2024-11-25': 5000, // streak 3
        '2024-11-26': 1085, // streak 4
        '2024-11-28': 6000, // gap, streak 1
        '2024-11-29': 2000, // streak 2
      };

      const result = calculateDerivedStats(data);

      expect(result.maxStreak).toBe(4); // Longest streak is 4 days
    });
  });
});
