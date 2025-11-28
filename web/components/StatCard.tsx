import React from 'react';

interface StatCardProps {
  index: string;
  label: string;
  value: string | number;
  subValue?: string;
  large?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({ index, label, value, subValue, large = false }) => {
  return (
    <div className={`relative flex flex-col justify-between p-6 ${large ? 'h-full' : 'h-48'}`}>
        
      {/* Label Section */}
      <div className="flex justify-between items-start border-b border-gray-300 pb-2 mb-4">
        <span className="font-mono text-xs font-bold uppercase tracking-widest text-gray-500">{index} :: {label}</span>
      </div>

      {/* Value Section */}
      <div className="mt-auto">
        <div className={`font-serif leading-none text-black ${large ? 'text-7xl md:text-8xl' : 'text-5xl'}`}>
          {value}
        </div>
        {subValue && (
          <div className="font-mono text-xs text-gray-500 mt-2 uppercase tracking-wide border-l-2 border-black pl-2 ml-1">
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
};