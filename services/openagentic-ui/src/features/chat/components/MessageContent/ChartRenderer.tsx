/**
 * Client-Side Chart Renderer using Recharts
 * Renders charts directly in the browser without server-side rendering
 */

import React, { useMemo } from 'react';
import {
  PieChart, Pie, Cell,
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  ScatterChart, Scatter,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

interface ChartData {
  type: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'doughnut' | 'bubble';
  data: any[];
  title?: string;
  xAxis?: string;
  yAxis?: string;
  dataKeys?: string[];
  colors?: string[];
  options?: any;
}

interface ChartRendererProps {
  chartSpec: string | ChartData;
  theme: 'light' | 'dark';
  height?: number;
}

// Default color palette
// eslint-disable-next-line no-restricted-syntax -- Chart visualization colors are intentional design choices
const DEFAULT_COLORS = [
  '#8b5cf6', // Purple
  '#3b82f6', // Blue
  '#10b981', // Green
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#84cc16', // Lime
];

const ChartRenderer: React.FC<ChartRendererProps> = ({
  chartSpec,
  theme,
  height = 400
}) => {
  // Parse chart specification if it's a string
  const chartData = useMemo(() => {
    if (typeof chartSpec === 'string') {
      try {
        // Try to parse JSON block from the string
        const jsonMatch = chartSpec.match(/```(?:json|chart)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[1]);
        }
        // Try to parse as plain JSON
        return JSON.parse(chartSpec);
      } catch (error) {
        console.error('Failed to parse chart specification:', error);
        return null;
      }
    }
    return chartSpec;
  }, [chartSpec]);

  // Get colors from spec or use defaults
  const colors = chartData?.colors || DEFAULT_COLORS;

  // Get data keys (for multi-series charts)
  const dataKeys = useMemo(() => {
    if (chartData?.dataKeys) return chartData.dataKeys;
    if (chartData?.data?.length > 0) {
      // Auto-detect numeric keys from first data item
      const firstItem = chartData.data[0];
      return Object.keys(firstItem).filter(key => {
        const val = firstItem[key];
        return typeof val === 'number' && key !== 'value';
      });
    }
    return ['value'];
  }, [chartData]);

  // Theme-based styling
  /* eslint-disable no-restricted-syntax -- Theme-conditional colors match Tailwind palette */
  const textColor = theme === 'dark' ? '#e5e7eb' : '#374151';
  const gridColor = theme === 'dark' ? '#374151' : '#e5e7eb';
  const bgColor = theme === 'dark' ? '#1f2937' : '#ffffff';
  /* eslint-enable no-restricted-syntax */

  if (!chartData || !chartData.data) {
    return (
      <div className="p-4 rounded-lg bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800">
        <p className="text-sm text-red-600 dark:text-red-400">
          Invalid chart data format
        </p>
      </div>
    );
  }

  const renderChart = () => {
    const chartType = chartData.type?.toLowerCase() || 'bar';

    switch (chartType) {
      case 'pie':
      case 'doughnut':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <PieChart>
              <Pie
                data={chartData.data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={chartType === 'doughnut' ? 120 : 140}
                innerRadius={chartType === 'doughnut' ? 60 : 0}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                labelLine={true}
              >
                {chartData.data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: bgColor, borderColor: gridColor }}
                labelStyle={{ color: textColor }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );

      case 'line':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey={chartData.xAxis || 'name'}
                stroke={textColor}
                tick={{ fill: textColor }}
              />
              <YAxis
                stroke={textColor}
                tick={{ fill: textColor }}
                label={chartData.yAxis ? { value: chartData.yAxis, angle: -90, position: 'insideLeft', fill: textColor } : undefined}
              />
              <Tooltip
                contentStyle={{ backgroundColor: bgColor, borderColor: gridColor }}
                labelStyle={{ color: textColor }}
              />
              <Legend />
              {dataKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={{ fill: colors[index % colors.length] }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey={chartData.xAxis || 'name'}
                stroke={textColor}
                tick={{ fill: textColor }}
              />
              <YAxis
                stroke={textColor}
                tick={{ fill: textColor }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: bgColor, borderColor: gridColor }}
                labelStyle={{ color: textColor }}
              />
              <Legend />
              {dataKeys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.3}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case 'scatter':
      case 'bubble':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey={chartData.xAxis || 'x'}
                type="number"
                stroke={textColor}
                tick={{ fill: textColor }}
              />
              <YAxis
                dataKey={chartData.yAxis || 'y'}
                type="number"
                stroke={textColor}
                tick={{ fill: textColor }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: bgColor, borderColor: gridColor }}
                labelStyle={{ color: textColor }}
              />
              <Legend />
              <Scatter
                name={chartData.title || 'Data'}
                data={chartData.data}
                fill={colors[0]}
              />
            </ScatterChart>
          </ResponsiveContainer>
        );

      case 'radar':
        return (
          <ResponsiveContainer width="100%" height={height}>
            <RadarChart data={chartData.data}>
              <PolarGrid stroke={gridColor} />
              <PolarAngleAxis dataKey="name" stroke={textColor} />
              <PolarRadiusAxis stroke={textColor} />
              <Tooltip
                contentStyle={{ backgroundColor: bgColor, borderColor: gridColor }}
                labelStyle={{ color: textColor }}
              />
              <Legend />
              {dataKeys.map((key, index) => (
                <Radar
                  key={key}
                  name={key}
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.3}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        );

      case 'bar':
      default:
        return (
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey={chartData.xAxis || 'name'}
                stroke={textColor}
                tick={{ fill: textColor }}
              />
              <YAxis
                stroke={textColor}
                tick={{ fill: textColor }}
                label={chartData.yAxis ? { value: chartData.yAxis, angle: -90, position: 'insideLeft', fill: textColor } : undefined}
              />
              <Tooltip
                contentStyle={{ backgroundColor: bgColor, borderColor: gridColor }}
                labelStyle={{ color: textColor }}
              />
              <Legend />
              {dataKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[index % colors.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        backgroundColor: bgColor,
        borderColor: gridColor
      }}
    >
      {chartData?.title && (
        <h3
          className="text-lg font-semibold mb-4 text-center"
          style={{ color: textColor }}
        >
          {chartData.title}
        </h3>
      )}

      <div style={{ width: '100%', height }}>
        {renderChart()}
      </div>
    </div>
  );
};

export default ChartRenderer;
