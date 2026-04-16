/**
 * @copyright 2024 Openagentic LLC
 * @license PROPRIETARY
 */

import React from 'react';
import { TrendingUp, TrendingDown, Minus, Activity, AlertCircle, CheckCircle, Clock, Cpu, HardDrive, Network } from '@/shared/icons';
import { motion } from 'framer-motion';
// Pure frontend - charts rendered by API

interface MetricData {
  name?: string;  // Optional to handle legacy data
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: number;
  status?: 'healthy' | 'warning' | 'critical';
  sparkline?: number[];
  query?: string;
  timestamp?: string;
  metric?: string;  // Legacy property name that might still be used
}

interface MetricCardProps {
  metric: MetricData;
  theme: 'light' | 'dark';
  onViewInGrafana?: () => void;
}

const MetricCard: React.FC<MetricCardProps> = ({ metric, theme, onViewInGrafana }) => {
  // Use 'metric' property if 'name' is not available
  const metricName = metric.name || metric.metric || 'Unknown Metric';
  
  const getMetricIcon = (name: string) => {
    const nameLower = name?.toLowerCase() || '';
    if (!nameLower) return <Activity size={20} />;
    if (nameLower.includes('cpu')) return <Cpu size={20} />;
    if (nameLower.includes('memory') || nameLower.includes('mem')) return <HardDrive size={20} />;
    if (nameLower.includes('network') || nameLower.includes('net')) return <Network size={20} />;
    if (nameLower.includes('latency') || nameLower.includes('time')) return <Clock size={20} />;
    return <Activity size={20} />;
  };
  
  const getTrendIcon = (trend?: 'up' | 'down' | 'stable') => {
    switch (trend) {
      case 'up':
        return <TrendingUp size={16} className="text-green-500" />;
      case 'down':
        return <TrendingDown size={16} className="text-red-500" />;
      case 'stable':
        return <Minus size={16} style={{ color: 'var(--color-textSecondary)' }} />;
      default:
        return null;
    }
  };
  
  const getStatusColor = (status?: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy':
        return 'text-theme-success-fg';
      case 'warning':
        return 'text-theme-warning-fg';
      case 'critical':
        return 'text-theme-error-fg';
      default:
        return 'text-text-secondary';
    }
  };
  
  const getStatusIcon = (status?: 'healthy' | 'warning' | 'critical') => {
    switch (status) {
      case 'healthy':
        return <CheckCircle size={16} />;
      case 'warning':
      case 'critical':
        return <AlertCircle size={16} />;
      default:
        return null;
    }
  };
  
  const formatValue = (value: number | string, unit?: string) => {
    if (typeof value === 'number') {
      // Format large numbers
      if (value >= 1e9) {
        return `${(value / 1e9).toFixed(2)}${unit === 'bytes' ? ' GB' : 'B'}`;
      } else if (value >= 1e6) {
        return `${(value / 1e6).toFixed(2)}${unit === 'bytes' ? ' MB' : 'M'}`;
      } else if (value >= 1e3) {
        return `${(value / 1e3).toFixed(2)}${unit === 'bytes' ? ' KB' : 'K'}`;
      }
      
      // Format percentages
      if (unit === '%' || (value >= 0 && value <= 1)) {
        return `${(value * 100).toFixed(1)}%`;
      }
      
      return `${value.toFixed(2)} ${unit || ''}`;
    }
    return value;
  };
  
  // Prepare sparkline data
  const sparklineData = metric.sparkline?.map((value, index) => ({
    index,
    value
  })) || [];
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className="rounded-lg border p-4 cursor-pointer transition-all bg-bg-primary border-border-primary hover:border-border-secondary"
      onClick={onViewInGrafana}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-bg-secondary">
            {getMetricIcon(metricName)}
          </div>
          
          <div>
            <div className="text-sm font-medium text-text-primary">
              {metricName}
            </div>
            
            {metric.timestamp && (
              <div className="text-xs text-text-secondary">
                {new Date(metric.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
        
        {metric.status && (
          <div className={`${getStatusColor(metric.status)}`}>
            {getStatusIcon(metric.status)}
          </div>
        )}
      </div>
      
      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl font-bold text-text-primary">
            {formatValue(metric.value, metric.unit)}
          </div>
          
          {metric.trend && metric.trendValue !== undefined && (
            <div className="flex items-center gap-1 mt-1">
              {getTrendIcon(metric.trend)}
              <span className={`text-xs ${
                metric.trend === 'up' 
                  ? 'text-green-500' 
                  : metric.trend === 'down' 
                  ? 'text-red-500' 
                  : 'text-gray-500'
              }`}>
                {metric.trendValue > 0 ? '+' : ''}{metric.trendValue}%
              </span>
            </div>
          )}
        </div>
        
        {/* Sparkline - Pure Frontend: Simple visual placeholder */}
        {sparklineData.length > 0 && (
          <div className="w-24 h-12 bg-bg-secondary rounded-sm flex items-center justify-center">
            <div className="text-xs text-text-tertiary">Chart</div>
          </div>
        )}
      </div>
      
      {metric.query && (
        <div className="mt-2 pt-2 border-t text-xs font-mono border-border-primary text-text-tertiary">
          {metric.query}
        </div>
      )}
    </motion.div>
  );
};

export default MetricCard;
