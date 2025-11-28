import React, { useEffect, useState } from 'react';
import { StatsData, DerivedStats } from './types';
import { calculateDerivedStats } from './utils/statsCalculator';
import { StatCard } from './components/StatCard';
import { Heatmap } from './components/Heatmap';
import { Header } from './components/Header';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

const MOCK_DATA: StatsData = {
  daily_distances: {
    "2024-11-20": 5000,
    "2024-11-21": 5200,
    "2024-11-22": 4047,
    "2024-11-23": 4328,
    "2024-11-24": 2000,
    "2024-11-25": 5000,
    "2024-11-26": 1085,
    "2024-11-27": 5900,
    "2024-11-28": 6000,
    "2024-11-29": 2000,
    "2024-11-30": 8000
  }
};

const App: React.FC = () => {
  const [data, setData] = useState<StatsData | null>(null);
  const [stats, setStats] = useState<DerivedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('./stats.json');
        if (!response.ok) throw new Error("Network response was not ok");
        const jsonData: StatsData = await response.json();
        setData(jsonData);
      } catch (err) {
        console.warn("Using demo data.");
        setData(MOCK_DATA);
        setIsDemoMode(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (data) {
      setStats(calculateDerivedStats(data.daily_distances));
    }
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f3f3f1] flex items-center justify-center">
        <div className="font-mono text-xs uppercase animate-pulse">Initializing System...</div>
      </div>
    );
  }

  const recentActivity = data ? Object.entries(data.daily_distances)
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .slice(-30)
    .map(([date, meters]) => ({
      date: date.substring(5),
      meters
    })) : [];

  return (
    <div className="min-h-screen bg-[#f3f3f1] font-sans text-[#1a1a1a] pb-24">
      <Header />

      <main className="max-w-7xl mx-auto border-l border-r border-black">

        {/* Demo Warning - Minimal */}
        {isDemoMode && (
          <div className="border-b border-black p-2 bg-black text-white text-center font-mono text-[10px] uppercase tracking-widest">
            :: Demo Mode Active :: Local Data Not Found ::
          </div>
        )}

        {/* 01 :: OVERVIEW GRID */}
        <section className="border-b border-black">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-black">

            {stats && (
              <>
                <div className="border-black">
                  <StatCard
                    index="01"
                    label="Streak"
                    value={`${stats.currentStreak}`}
                    subValue={stats.currentStreak > 0 ? "Rowing" : "Inactive"}
                  />
                </div>
                <div className="border-black">
                  <StatCard
                    index="02"
                    label="Mo. Volume"
                    value={(stats.thisMonthDistance / 1000).toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    })}
                    subValue="Kilometers"
                  />
                </div>
                <div className="border-black">
                  <StatCard
                    index="03"
                    label="Yr. Volume"
                    value={(stats.thisYearDistance / 1000).toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    })}
                    subValue="Kilometers"
                  />
                </div>
                <div className="border-black bg-black text-white">
                  {/* Inverted Card for Emphasis */}
                  <div className="relative flex flex-col justify-between p-6 h-48">
                    <div className="flex justify-between items-start border-b border-gray-700 pb-2 mb-4">
                      <span className="font-mono text-xs font-bold uppercase tracking-widest text-gray-400">04 :: All Time</span>
                    </div>
                    <div className="mt-auto">
                      <div className="font-serif text-5xl leading-none text-white">
                        {(stats.totalDistance / 1000).toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    })}
                      </div>
                      <div className="font-mono text-xs text-gray-400 mt-2 uppercase tracking-wide border-l-2 border-white pl-2 ml-1">
                        Kilometers
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* 02 :: VISUALIZATION */}
        <section className="grid grid-cols-1 lg:grid-cols-3 border-b border-black">

          {/* HEATMAP - Spans 2 cols */}
          <div className="lg:col-span-2 border-b lg:border-b-0 lg:border-r border-black p-8">
            <div className="flex justify-between items-end mb-8">
              <div>
                <span className="font-mono text-xs text-gray-500 uppercase block mb-1">05 :: Frequency</span>
                <h2 className="font-serif text-3xl">Activity Heatmap</h2>
              </div>
              <div className="hidden md:flex gap-1 font-mono text-[10px] text-gray-400 uppercase tracking-wider">
                <span>Low</span>
                <span className="text-black">High</span>
              </div>
            </div>
            {data && <Heatmap data={data.daily_distances} />}
          </div>

          {/* BAR CHART */}
          <div className="p-8 bg-white">
            <div className="flex justify-between items-end mb-8">
              <div>
                <span className="font-mono text-xs text-gray-500 uppercase block mb-1">06 :: Intensity</span>
                <h2 className="font-serif text-3xl">Last 30 Days</h2>
              </div>
            </div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={recentActivity}>
                  <CartesianGrid strokeDasharray="1 3" vertical={false} stroke="#e5e5e5" />
                  <XAxis
                    dataKey="date"
                    stroke="#999"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    fontFamily="'Space Mono', monospace"
                    interval={6}
                  />
                  <Tooltip
                    cursor={{ fill: '#f3f3f1' }}
                    contentStyle={{
                      backgroundColor: '#000',
                      border: 'none',
                      color: '#fff',
                      fontFamily: "'Space Mono', monospace",
                      fontSize: '12px',
                      padding: '4px 8px'
                    }}
                    itemStyle={{ color: '#fff' }}
                  />
                  <Bar dataKey="meters" fill="#1a1a1a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* 03 :: FOOTER DETAILS */}
        <section className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b border-black divide-black">
          <div className="p-8">
            <span className="font-mono text-xs text-gray-500 uppercase block mb-4">07 :: Consistency Index</span>
            <div className="flex items-center gap-4">
              <div className="font-serif text-6xl">
                {stats?.maxStreak}
              </div>
              <div className="font-mono text-xs text-gray-500 leading-relaxed">
                MAX CONSECUTIVE<br />
                DAYS RECORDED
              </div>
            </div>
          </div>

          <div className="p-8">
            <span className="font-mono text-xs text-gray-500 uppercase block mb-4">08 :: Last Entry</span>
            <div className="flex items-center gap-4">
              <div className="font-serif text-4xl italic">
                {stats?.lastWorkoutDate || 'N/A'}
              </div>
            </div>
          </div>
        </section>

      </main>

      <footer className="max-w-7xl mx-auto py-8 text-center font-mono text-[10px] text-gray-400 uppercase tracking-widest">
        Designed in 2025 :: Concept2 Backup Project
      </footer>
    </div>
  );
};

export default App;