import React, { useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, RadialBarChart, RadialBar
} from 'recharts';
import { RefreshCw, Download, Maximize2, AlertCircle, X } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

export interface VisualizationData {
  type: 'bar' | 'line' | 'area' | 'pie' | 'radial' | 'gauge';
  title: string;
  data: Record<string, any>[];
  config?: {
    xAxis?: string;
    yAxis?: string | string[];
    color?: string | string[];
    stacked?: boolean;
    showGrid?: boolean;
    showLegend?: boolean;
    unit?: string;
  };
}

interface DataVisualizationProps {
  data: VisualizationData;
  theme?: 'light' | 'dark';
  onRefresh?: () => void;
}

const DataVisualization: React.FC<DataVisualizationProps> = ({
  data,
  theme = 'dark',
  onRefresh
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

  // Color palettes for charts
  // eslint-disable-next-line no-restricted-syntax -- Chart visualization colors are intentional design choices
  const colors = theme === 'dark'
    ? ['#3B82F6', '#22C55E', '#F97316', '#EF4444', '#A855F7', '#EC4899', '#14B8A6', '#F97316']
    : ['#2563EB', '#16A34A', '#EA580C', '#DC2626', '#0A84FF', '#DB2777', '#0891B2', '#EA580C'];

  // eslint-disable-next-line no-restricted-syntax -- Theme-conditional colors match Tailwind palette
  const gridColor = theme === 'dark' ? '#374151' : '#E5E7EB';
  // eslint-disable-next-line no-restricted-syntax -- Theme-conditional colors match Tailwind palette
  const textColor = theme === 'dark' ? '#9CA3AF' : '#6B7280';
  // Validate data
  if (!data || !data.data || !Array.isArray(data.data)) {
    return (
      <div className="rounded-lg border p-8 text-center bg-bg-secondary border-border">
        <AlertCircle className="mx-auto mb-4 text-red-400" size={48} />
        <p className="text-text-muted">
          No data available for visualization
        </p>
      </div>
    );
  }

  if (data.data.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center bg-bg-secondary border-border">
        <AlertCircle className="mx-auto mb-4 text-yellow-400" size={48} />
        <p className="text-text-muted">
          No data points to display
        </p>
      </div>
    );
  }

  const handleExport = () => {
    try {
      // Convert chart data to CSV
      const headers = Object.keys(data.data[0] || {}).join(',');
      const rows = data.data.map(row => Object.values(row).join(','));
      const csvContent = `data:text/csv;charset=utf-8,${headers}\n${rows.join('\n')}`;

      const link = document.createElement('a');
      link.href = encodeURI(csvContent);
      link.download = `${data.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const renderChart = () => {
    try {
      const { type, config = {} } = data;
      const chartData = selectedFilters.length > 0
        ? data.data.filter(item => !selectedFilters.includes(item.name || item.label))
        : data.data;

      // Ensure we have valid config values
      const xAxisKey = config.xAxis || 'name';
      const yAxisKey = config.yAxis || 'value';
      const unit = config.unit || '';

      /* eslint-disable no-restricted-syntax -- Theme-conditional colors match Tailwind palette */
      const tooltipStyle = {
        backgroundColor: theme === 'dark' ? '#1F2937' : '#FFFFFF',
        border: `1px solid ${theme === 'dark' ? '#374151' : '#E5E7EB'}`,
        borderRadius: '8px',
        fontSize: '12px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
      };
      /* eslint-enable no-restricted-syntax */

      switch (type) {
        case 'bar':
          return (
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              {config.showGrid !== false && (
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.5} />
              )}
              <XAxis
                dataKey={xAxisKey}
                stroke={textColor}
                fontSize={11}
                angle={-45}
                textAnchor="end"
                height={80}
                interval={0}
                tick={{ fill: textColor }}
              />
              <YAxis
                stroke={textColor}
                fontSize={11}
                tick={{ fill: textColor }}
                tickFormatter={(value) => `${value}${unit}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [`${value}${unit}`, '']}
              />
              {config.showLegend !== false && <Legend wrapperStyle={{ paddingTop: '20px' }} />}
              {Array.isArray(yAxisKey) ? (
                yAxisKey.map((key, index) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={Array.isArray(config.color) ? config.color[index] : colors[index % colors.length]}
                    stackId={config.stacked ? 'stack' : undefined}
                    radius={[4, 4, 0, 0]}
                  />
                ))
              ) : (
                <Bar
                  dataKey={yAxisKey as string}
                  fill={typeof config.color === 'string' ? config.color : colors[0]}
                  radius={[4, 4, 0, 0]}
                >
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Bar>
              )}
            </BarChart>
          );

        case 'line':
          return (
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              {config.showGrid !== false && (
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.5} />
              )}
              <XAxis
                dataKey={xAxisKey}
                stroke={textColor}
                fontSize={11}
                tick={{ fill: textColor }}
              />
              <YAxis
                stroke={textColor}
                fontSize={11}
                tick={{ fill: textColor }}
                tickFormatter={(value) => `${value}${unit}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [`${value}${unit}`, '']}
              />
              {config.showLegend !== false && <Legend />}
              {Array.isArray(yAxisKey) ? (
                yAxisKey.map((key, index) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={Array.isArray(config.color) ? config.color[index] : colors[index % colors.length]}
                    strokeWidth={2}
                    dot={{ r: 4, fill: colors[index % colors.length] }}
                    activeDot={{ r: 6, strokeWidth: 2 }}
                  />
                ))
              ) : (
                <Line
                  type="monotone"
                  dataKey={yAxisKey as string}
                  stroke={typeof config.color === 'string' ? config.color : colors[0]}
                  strokeWidth={2}
                  dot={{ r: 4, fill: colors[0] }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                />
              )}
            </LineChart>
          );

        case 'area':
          return (
            <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <defs>
                {colors.map((color, index) => (
                  <linearGradient key={index} id={`gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                    <stop offset="95%" stopColor={color} stopOpacity={0.1}/>
                  </linearGradient>
                ))}
              </defs>
              {config.showGrid !== false && (
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.5} />
              )}
              <XAxis
                dataKey={xAxisKey}
                stroke={textColor}
                fontSize={11}
                tick={{ fill: textColor }}
              />
              <YAxis
                stroke={textColor}
                fontSize={11}
                tick={{ fill: textColor }}
                tickFormatter={(value) => `${value}${unit}`}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [`${value}${unit}`, '']}
              />
              {config.showLegend !== false && <Legend />}
              {Array.isArray(yAxisKey) ? (
                yAxisKey.map((key, index) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={Array.isArray(config.color) ? config.color[index] : colors[index % colors.length]}
                    fill={`url(#gradient-${index % colors.length})`}
                    stackId={config.stacked ? 'stack' : undefined}
                  />
                ))
              ) : (
                <Area
                  type="monotone"
                  dataKey={yAxisKey as string}
                  stroke={typeof config.color === 'string' ? config.color : colors[0]}
                  fill="url(#gradient-0)"
                />
              )}
            </AreaChart>
          );

        case 'pie':
          const pieDataKey = typeof yAxisKey === 'string' ? yAxisKey : 'value';
          const total = chartData.reduce((sum, item) => sum + (Number(item[pieDataKey]) || 0), 0);
          return (
            <PieChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={true}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                outerRadius={120}
                innerRadius={60}
                // eslint-disable-next-line no-restricted-syntax -- Chart visualization color
                fill="#8884d8"
                dataKey={pieDataKey}
                paddingAngle={2}
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={colors[index % colors.length]}
                    // eslint-disable-next-line no-restricted-syntax -- Theme-conditional color
                    stroke={theme === 'dark' ? '#1F2937' : '#FFFFFF'}
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [`${value}${unit} (${((value / total) * 100).toFixed(1)}%)`, '']}
              />
              <Legend />
            </PieChart>
          );

        case 'radial':
          return (
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="30%"
              outerRadius="90%"
              data={chartData}
              startAngle={180}
              endAngle={0}
            >
              <RadialBar
                label={{ position: 'insideStart', fill: textColor }}
                background
                dataKey={typeof yAxisKey === 'string' ? yAxisKey : 'value'}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </RadialBar>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend />
            </RadialBarChart>
          );

        default:
          return (
            <div className="flex items-center justify-center h-full text-gray-500">
              Unsupported chart type: {type}
            </div>
          );
      }
    } catch (err) {
      console.error('Chart rendering error:', err);
      return (
        <div className="flex flex-col items-center justify-center h-full">
          <AlertCircle className="mb-4 text-red-400" size={48} />
          <p className="text-text-muted">
            Error rendering chart
          </p>
          <p className="text-sm mt-2 text-text-muted">
            {err instanceof Error ? err.message : 'Unknown error'}
          </p>
        </div>
      );
    }
  };

  const chartContent = (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl border shadow-lg bg-bg-secondary border-border ${
        isFullscreen ? 'fixed inset-4 z-50 overflow-hidden' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            data.type === 'bar' ? 'bg-blue-500' :
            data.type === 'line' ? 'bg-green-500' :
            data.type === 'area' ? 'bg-cyan-500' :
            data.type === 'pie' ? 'bg-orange-500' : 'bg-gray-500'
          }`} />
          <h3 className="font-semibold text-lg text-text-primary">
            {data.title || 'Data Visualization'}
          </h3>
        </div>

        <div className="flex items-center gap-1">
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="p-2 rounded-lg transition-all hover:bg-bg-hover text-text-muted hover:text-text-primary"
              title="Refresh data"
            >
              <RefreshCw size={16} />
            </button>
          )}

          <button
            onClick={handleExport}
            className="p-2 rounded-lg transition-all hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title="Export as CSV"
          >
            <Download size={16} />
          </button>

          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 rounded-lg transition-all hover:bg-bg-hover text-text-muted hover:text-text-primary"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <X size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
      </div>

      {/* Chart Container */}
      <div className="p-4" style={{ height: isFullscreen ? 'calc(100vh - 140px)' : '400px' }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>

      {/* Footer with data summary */}
      <div className="px-4 py-2 border-t text-xs flex items-center justify-between border-border text-text-muted">
        <span>
          {data.data?.length || 0} data points • {data.type} chart
        </span>
        {onRefresh && (
          <span className="opacity-60">Click refresh to update</span>
        )}
      </div>
    </motion.div>
  );

  // Fullscreen overlay
  if (isFullscreen) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-black/80"
          onClick={() => setIsFullscreen(false)}
        />
        {chartContent}
      </AnimatePresence>
    );
  }

  return chartContent;
};

export default DataVisualization;
