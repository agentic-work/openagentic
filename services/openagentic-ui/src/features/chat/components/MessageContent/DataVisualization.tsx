import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, Maximize2, AlertCircle, X } from '@/shared/icons';
import { Bar as AwBar, type BarData } from '../../../../lib/charts/components/Bar';
import { Line as AwLine, type LineData } from '../../../../lib/charts/components/Line';
import { Area as AwArea, type AreaData } from '../../../../lib/charts/components/Area';
import { Donut as AwDonut, type DonutData } from '../../../../lib/charts/components/Donut';
import { Gauge as AwGauge, type GaugeData } from '../../../../lib/charts/components/Gauge';
import { useThemeTokens } from '../../../../lib/charts/hooks/useThemeTokens';

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

function detectKeys(rows: Record<string, any>[], xKey?: string, declared?: string | string[]): string[] {
  if (declared) return Array.isArray(declared) ? declared : [declared];
  const first = rows[0];
  if (!first) return ['value'];
  return Object.keys(first).filter((k) => typeof first[k] === 'number' && k !== xKey);
}

function downloadCsv(viz: VisualizationData) {
  if (!viz.data?.length) return;
  const cols = Object.keys(viz.data[0]);
  const csv = [cols.join(','), ...viz.data.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${viz.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'data'}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const DataVisualization: React.FC<DataVisualizationProps> = ({ data, onRefresh }) => {
  const tokens = useThemeTokens();
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    return (
      <div
        style={{
          padding: 16,
          borderRadius: 8,
          border: `1px solid ${tokens.warn}`,
          background: tokens.bg1,
          color: tokens.warn,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        <AlertCircle size={16} />
        No data to visualize
      </div>
    );
  }

  const renderBody = (height = 380): React.ReactNode => {
    const xKey = data.config?.xAxis ?? 'name';
    const keys = detectKeys(data.data, xKey, data.config?.yAxis);
    const categories = data.data.map((r) => String(r[xKey] ?? ''));

    if (data.type === 'pie') {
      const slices = data.data.map((r) => ({
        name: String(r[xKey] ?? r.name ?? ''),
        value: Number(r.value ?? r[keys[0]] ?? 0),
      }));
      const donut: DonutData = { slices };
      return <AwDonut data={donut} height={height} />;
    }
    if (data.type === 'gauge' || data.type === 'radial') {
      const gauge: GaugeData = {
        gauges: data.data.map((r, i) => ({
          name: String(r[xKey] ?? r.name ?? `g${i + 1}`),
          value: Number(r.value ?? r[keys[0]] ?? 0),
          max: Number(r.max ?? 100),
          unit: data.config?.unit,
        })),
      };
      return <AwGauge data={gauge} />;
    }
    if (data.type === 'line') {
      const line: LineData = {
        series: keys.map((k) => ({
          name: k,
          data: data.data.map((r) => ({ t: String(r[xKey] ?? ''), v: Number(r[k]) })),
        })),
        unit: data.config?.unit,
      };
      return <AwLine data={line} height={height} />;
    }
    if (data.type === 'area') {
      const area: AreaData = {
        series: keys.map((k) => ({
          name: k,
          data: data.data.map((r) => ({ t: String(r[xKey] ?? ''), v: Number(r[k]) })),
        })),
        mode: data.config?.stacked ? 'stacked' : keys.length > 1 ? 'stacked' : 'overlay',
        xLabels: categories,
      };
      return <AwArea data={area} height={height} />;
    }
    const bar: BarData = {
      categories,
      series: keys.map((k) => ({ name: k, values: data.data.map((r) => Number(r[k])) })),
      mode: data.config?.stacked ? 'stacked' : keys.length > 1 ? 'grouped' : 'stacked',
    };
    return <AwBar data={bar} height={height} />;
  };

  const card: React.CSSProperties = {
    padding: 16,
    borderRadius: 12,
    background: tokens.bg1,
    border: `1px solid ${tokens.line1}`,
    fontFamily: tokens.fontUi,
  };
  const head: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 };
  const title: React.CSSProperties = { fontSize: 14, fontWeight: 600, color: tokens.fg1 };
  const iconBtn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: tokens.fg2,
    cursor: 'pointer',
    padding: 4,
    borderRadius: 6,
  };

  return (
    <>
      <div style={card}>
        <div style={head}>
          <div style={title}>{data.title}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {onRefresh && (
              <button style={iconBtn} onClick={onRefresh} title="Refresh" aria-label="Refresh chart">
                <RefreshCw size={14} />
              </button>
            )}
            <button style={iconBtn} onClick={() => downloadCsv(data)} title="Download CSV" aria-label="Download CSV">
              <Download size={14} />
            </button>
            <button style={iconBtn} onClick={() => setIsFullscreen(true)} title="Fullscreen" aria-label="Fullscreen">
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
        {renderBody(380)}
      </div>
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'color-mix(in srgb, var(--cm-bg) 72%, transparent)',
              zIndex: 80,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 32,
            }}
            onClick={() => setIsFullscreen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                background: tokens.bg0,
                border: `1px solid ${tokens.line1}`,
                borderRadius: 12,
                padding: 24,
                width: 'min(1100px, 96vw)',
                maxHeight: '92vh',
                overflow: 'auto',
              }}
            >
              <div style={head}>
                <div style={title}>{data.title}</div>
                <button style={iconBtn} onClick={() => setIsFullscreen(false)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              {renderBody(560)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default DataVisualization;
