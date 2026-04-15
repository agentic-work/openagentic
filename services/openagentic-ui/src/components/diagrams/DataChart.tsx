/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * DataChart Component
 *
 * Renders data visualizations using Recharts with admin dashboard styling.
 * Supports line, bar, area, pie, and composed charts.
 */

import React, { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';

// Chart types supported
export type ChartType = 'line' | 'bar' | 'area' | 'pie' | 'donut';

// Data point interface
export interface DataPoint {
  name: string;
  value?: number;
  [key: string]: string | number | undefined;
}

// Series definition for multi-series charts
export interface ChartSeries {
  key: string;
  name: string;
  color?: string;
  type?: 'line' | 'bar' | 'area';
}

// Chart definition (what LLM generates)
export interface ChartDefinition {
  type: ChartType;
  title?: string;
  description?: string;
  data: DataPoint[];
  series?: ChartSeries[];
  xAxis?: string;
  yAxis?: string;
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
}

interface DataChartProps {
  chart: ChartDefinition;
  className?: string;
  height?: number;
}

// Default color palette - Apple-inspired
// eslint-disable-next-line no-restricted-syntax -- Chart visualization colors are intentional design choices
const DEFAULT_COLORS = [
  '#0A84FF', // Apple Blue (Primary)
  '#22C55E', // Apple Green
  '#F97316', // Apple Orange
  '#FF453A', // Apple Red
  '#BF5AF2', // Apple Purple
  '#FF375F', // Apple Pink
  '#64D2FF', // Apple Cyan
  '#FFD60A', // Apple Yellow
];

// Get accent color from CSS
const getAccentColor = (): string => {
  // eslint-disable-next-line no-restricted-syntax -- Fallback color for SSR
  if (typeof window === 'undefined') return '#0A84FF';
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--user-accent-primary')
    // eslint-disable-next-line no-restricted-syntax -- Fallback color
    .trim() || '#0A84FF';
};

// Custom tooltip styling
const CustomTooltip: React.FC<TooltipProps<number, string>> = ({
  active,
  payload,
  label,
}) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-surface border border-border/30 rounded-lg shadow-lg px-3 py-2">
      <p className="text-sm font-medium text-text-primary mb-1">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="font-medium text-text-primary">
            {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
};

// Line Chart renderer
const RenderLineChart: React.FC<{
  data: DataPoint[];
  series: ChartSeries[];
  colors: string[];
  showGrid: boolean;
  showLegend: boolean;
  xAxisKey: string;
}> = ({ data, series, colors, showGrid, showLegend, xAxisKey }) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
      {showGrid && (
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          opacity={0.3}
        />
      )}
      <XAxis
        dataKey={xAxisKey}
        stroke="var(--text-secondary)"
        fontSize={12}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <YAxis
        stroke="var(--text-secondary)"
        fontSize={12}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <Tooltip content={<CustomTooltip />} />
      {showLegend && (
        <Legend
          wrapperStyle={{ paddingTop: '20px' }}
          formatter={(value) => <span className="text-text-secondary text-sm">{value}</span>}
        />
      )}
      {series.map((s, i) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color || colors[i % colors.length]}
          strokeWidth={2}
          dot={{ fill: s.color || colors[i % colors.length], strokeWidth: 0, r: 4 }}
          activeDot={{ r: 6, strokeWidth: 0 }}
        />
      ))}
    </LineChart>
  </ResponsiveContainer>
);

// Bar Chart renderer
const RenderBarChart: React.FC<{
  data: DataPoint[];
  series: ChartSeries[];
  colors: string[];
  showGrid: boolean;
  showLegend: boolean;
  stacked: boolean;
  xAxisKey: string;
}> = ({ data, series, colors, showGrid, showLegend, stacked, xAxisKey }) => (
  <ResponsiveContainer width="100%" height="100%">
    <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
      {showGrid && (
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          opacity={0.3}
        />
      )}
      <XAxis
        dataKey={xAxisKey}
        stroke="var(--text-secondary)"
        fontSize={12}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <YAxis
        stroke="var(--text-secondary)"
        fontSize={12}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <Tooltip content={<CustomTooltip />} />
      {showLegend && (
        <Legend
          wrapperStyle={{ paddingTop: '20px' }}
          formatter={(value) => <span className="text-text-secondary text-sm">{value}</span>}
        />
      )}
      {series.map((s, i) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          name={s.name}
          fill={s.color || colors[i % colors.length]}
          stackId={stacked ? 'stack' : undefined}
          radius={[4, 4, 0, 0]}
        />
      ))}
    </BarChart>
  </ResponsiveContainer>
);

// Area Chart renderer
const RenderAreaChart: React.FC<{
  data: DataPoint[];
  series: ChartSeries[];
  colors: string[];
  showGrid: boolean;
  showLegend: boolean;
  stacked: boolean;
  xAxisKey: string;
}> = ({ data, series, colors, showGrid, showLegend, stacked, xAxisKey }) => (
  <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
      {showGrid && (
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--color-border)"
          opacity={0.3}
        />
      )}
      <XAxis
        dataKey={xAxisKey}
        stroke="var(--text-secondary)"
        fontSize={12}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <YAxis
        stroke="var(--text-secondary)"
        fontSize={12}
        tickLine={false}
        axisLine={{ stroke: 'var(--color-border)' }}
      />
      <Tooltip content={<CustomTooltip />} />
      {showLegend && (
        <Legend
          wrapperStyle={{ paddingTop: '20px' }}
          formatter={(value) => <span className="text-text-secondary text-sm">{value}</span>}
        />
      )}
      {series.map((s, i) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color || colors[i % colors.length]}
          fill={s.color || colors[i % colors.length]}
          fillOpacity={0.2}
          stackId={stacked ? 'stack' : undefined}
        />
      ))}
    </AreaChart>
  </ResponsiveContainer>
);

// Pie Chart renderer
const RenderPieChart: React.FC<{
  data: DataPoint[];
  colors: string[];
  showLegend: boolean;
  isDonut: boolean;
}> = ({ data, colors, showLegend, isDonut }) => (
  <ResponsiveContainer width="100%" height="100%">
    <PieChart>
      <Pie
        data={data}
        cx="50%"
        cy="50%"
        innerRadius={isDonut ? '60%' : 0}
        outerRadius="80%"
        paddingAngle={2}
        dataKey="value"
        nameKey="name"
        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
        labelLine={false}
      >
        {data.map((_, index) => (
          <Cell
            key={`cell-${index}`}
            fill={colors[index % colors.length]}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />
        ))}
      </Pie>
      <Tooltip content={<CustomTooltip />} />
      {showLegend && (
        <Legend
          formatter={(value) => <span className="text-text-secondary text-sm">{value}</span>}
        />
      )}
    </PieChart>
  </ResponsiveContainer>
);

export const DataChart: React.FC<DataChartProps> = ({
  chart,
  className = '',
  height = 300,
}) => {
  const accentColor = getAccentColor();
  const colors = chart.colors || [accentColor, ...DEFAULT_COLORS.slice(1)];

  // Derive series from data if not provided
  const series = useMemo(() => {
    if (chart.series) return chart.series;

    // Auto-detect series from first data point
    const firstPoint = chart.data[0];
    if (!firstPoint) return [];

    const keys = Object.keys(firstPoint).filter(k => k !== 'name' && k !== chart.xAxis);
    return keys.map((key, i) => ({
      key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      color: colors[i % colors.length],
    }));
  }, [chart.data, chart.series, chart.xAxis, colors]);

  const xAxisKey = chart.xAxis || 'name';
  const showGrid = chart.showGrid !== false;
  const showLegend = chart.showLegend !== false;
  const stacked = chart.stacked || false;

  const renderChart = () => {
    switch (chart.type) {
      case 'line':
        return (
          <RenderLineChart
            data={chart.data}
            series={series}
            colors={colors}
            showGrid={showGrid}
            showLegend={showLegend}
            xAxisKey={xAxisKey}
          />
        );
      case 'bar':
        return (
          <RenderBarChart
            data={chart.data}
            series={series}
            colors={colors}
            showGrid={showGrid}
            showLegend={showLegend}
            stacked={stacked}
            xAxisKey={xAxisKey}
          />
        );
      case 'area':
        return (
          <RenderAreaChart
            data={chart.data}
            series={series}
            colors={colors}
            showGrid={showGrid}
            showLegend={showLegend}
            stacked={stacked}
            xAxisKey={xAxisKey}
          />
        );
      case 'pie':
        return (
          <RenderPieChart
            data={chart.data}
            colors={colors}
            showLegend={showLegend}
            isDonut={false}
          />
        );
      case 'donut':
        return (
          <RenderPieChart
            data={chart.data}
            colors={colors}
            showLegend={showLegend}
            isDonut={true}
          />
        );
      default:
        return (
          <RenderLineChart
            data={chart.data}
            series={series}
            colors={colors}
            showGrid={showGrid}
            showLegend={showLegend}
            xAxisKey={xAxisKey}
          />
        );
    }
  };

  return (
    <div
      className={`data-chart glass-card overflow-hidden ${className}`}
      style={{
        borderRadius: '12px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {(chart.title || chart.description) && (
        <div className="px-4 py-3 border-b border-border/30">
          {chart.title && (
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: accentColor }}
              />
              <h3 className="text-sm font-semibold text-text-primary">{chart.title}</h3>
            </div>
          )}
          {chart.description && (
            <p className="text-xs text-text-secondary mt-1 ml-4">{chart.description}</p>
          )}
        </div>
      )}
      <div className="p-4" style={{ height }}>
        {renderChart()}
      </div>
    </div>
  );
};

/**
 * Parse chart JSON from LLM output
 */
export const parseChartJson = (json: string): ChartDefinition | null => {
  try {
    const parsed = JSON.parse(json);

    if (!parsed.data || !Array.isArray(parsed.data)) {
      return null;
    }

    return {
      type: parsed.type || 'line',
      title: parsed.title,
      description: parsed.description,
      data: parsed.data,
      series: parsed.series,
      xAxis: parsed.xAxis,
      yAxis: parsed.yAxis,
      colors: parsed.colors,
      showLegend: parsed.showLegend,
      showGrid: parsed.showGrid,
      stacked: parsed.stacked,
    };
  } catch {
    return null;
  }
};

export default DataChart;
