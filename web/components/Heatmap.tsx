import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { DailyDistances } from '../types';

interface HeatmapProps {
  data: DailyDistances;
}
// theme.ts 或放在 Heatmap.tsx 顶部

export const HEATMAP_THEME = {
  // 单独定义的空值颜色
  EMPTY: "#e5e5e5", 
  
  // 直接定义为数组，D3可以直接吃
  // 对应: [ <2000, 2k-5k, 5k-10k, >10k ]
  COLORS: [
    "#E8CDCD", // Level 1
    "#C98084", // Level 2
    "#9E383D", // Level 3
    "#5E0B0F"  // Level 4 (Record)
  ]
};

export const Heatmap: React.FC<HeatmapProps> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data || !containerRef.current) return;

    // Clear previous render
    d3.select(svgRef.current).selectAll("*").remove();

    const cellSize = 11; // Slightly smaller for tighter grid
    const cellMargin = 3;
    const yearHeight = cellSize * 7 + (cellMargin * 7); 
    
    // Determine date range (Last 365 days)
    const today = new Date();
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(today.getFullYear() - 1);
    
    const width = 900; 
    const height = yearHeight + 40;

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", `0 0 ${width} ${height}`);

    // Grayscale Color Scale
    // 0 -> Light Gray, High -> Black
    const colorScale = d3.scaleThreshold<number, string>()
      .domain([1, 2000, 5000, 10000]) 
      .range(HEATMAP_THEME.COLORS);

    const timeWeek = d3.timeSunday;
    const dates = d3.timeDays(oneYearAgo, today);

    const g = svg.append("g")
        .attr("transform", `translate(30, 20)`);

    // Draw cells
    g.selectAll(".day")
      .data(dates)
      .enter().append("rect")
      .attr("class", "day")
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("x", (d) => timeWeek.count(oneYearAgo, d) * (cellSize + cellMargin))
      .attr("y", (d) => d.getDay() * (cellSize + cellMargin))
      .attr("rx", 0) 
      .attr("ry", 0)
      .attr("fill", (d) => {
        const iso = d3.timeFormat("%Y-%m-%d")(d);
        return data[iso] ? colorScale(data[iso]) : "transparent";
      })
      .attr("stroke", (d) => {
         const iso = d3.timeFormat("%Y-%m-%d")(d);
         // If no data, outline it lightly to show the grid
         return data[iso] ? "none" : HEATMAP_THEME.EMPTY; 
      })
      .attr("stroke-width", 1)
      .append("title")
      .text((d) => {
        const iso = d3.timeFormat("%Y-%m-%d")(d);
        const val = data[iso];
        return `${iso}: ${val ? val.toLocaleString() : 0} m`;
      });

    // Month Labels
    const months = d3.timeMonths(oneYearAgo, today);
    g.selectAll(".month")
      .data(months)
      .enter().append("text")
      .attr("class", "month")
      .attr("x", (d) => timeWeek.count(oneYearAgo, d) * (cellSize + cellMargin))
      .attr("y", -10)
      .text((d) => d3.timeFormat("%b")(d))
      .attr("fill", "#000")
      .attr("font-size", "10px")
      .style("font-family", "'Space Mono', monospace")
      .style("text-transform", "uppercase");

    // Day Labels
    const days = ["S", "M", "T", "W", "T", "F", "S"];
    g.selectAll(".day-label")
      .data([1, 3, 5]) 
      .enter().append("text")
      .attr("x", -10)
      .attr("y", (d) => d * (cellSize + cellMargin) + 9)
      .text((d) => days[d])
      .attr("fill", "#9ca3af")
      .attr("font-size", "8px")
      .attr("text-anchor", "end")
      .style("font-family", "'Space Mono', monospace");

  }, [data]);

  return (
    <div className="w-full overflow-x-auto pb-4 custom-scrollbar" ref={containerRef}>
      <svg ref={svgRef} className="min-w-[800px] mx-auto"></svg>
    </div>
  );
};