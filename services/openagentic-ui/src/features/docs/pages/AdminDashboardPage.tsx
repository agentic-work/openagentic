import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsInfraIcon, DocsBrainIcon, DocsToolIcon } from '../components/DocsIcons';

// ============================================================================
// DASHBOARD TAB FLOW DIAGRAM
// ============================================================================

const dashboardDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Dashboard Data Flow',
  description: 'How metrics are collected and rendered',
  layout: 'horizontal',
  nodes: [
    { id: 'services', label: 'Platform Services', description: 'API, MCP, Agents', shape: 'server', color: 'blue' },
    { id: 'metrics', label: 'Metrics Collector', description: 'Prometheus + custom', shape: 'rounded', color: 'orange' },
    { id: 'aggregator', label: 'Aggregator', description: 'Time-series rollup', shape: 'rounded', color: 'purple' },
    { id: 'api', label: 'Admin API', description: '/admin/dashboard/*', shape: 'rounded', color: 'green' },
    { id: 'dashboard', label: 'Dashboard UI', description: 'Recharts rendering', shape: 'rounded', color: 'primary' },
  ],
  edges: [
    { source: 'services', target: 'metrics', animated: true },
    { source: 'metrics', target: 'aggregator' },
    { source: 'aggregator', target: 'api' },
    { source: 'api', target: 'dashboard', animated: true },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const metricSummaries = [
  { label: 'Total Users', description: 'Count of unique users who have accessed the platform. Includes active and inactive accounts.' },
  { label: 'Chat Sessions', description: 'Total chat sessions initiated across all users. A session begins when a user starts a new conversation.' },
  { label: 'Messages', description: 'Cumulative message count across all sessions. Includes both user messages and AI responses.' },
  { label: 'Flow Executions', description: 'Total workflow executions completed or in progress. Covers manual triggers, cron schedules, and webhook invocations.' },
  { label: 'Agent Runs', description: 'Total agent delegation invocations. Counts each time the orchestrator delegates to a specialist agent.' },
];

const dashboardTabs = [
  { name: 'Overview', description: 'Top-level summary metrics and trend sparklines. Shows the 6 metric summary cards at a glance with percentage change indicators for the selected time range.' },
  { name: 'Usage & Tokens', description: 'Detailed token consumption breakdown by provider, model, and user. Area charts show token usage over time. Includes input vs. output token split and cost-per-token analysis.' },
  { name: 'Cost Analysis', description: 'Financial dashboard with cost attribution per user, team, provider, and model. Bar charts compare monthly spend. Pie chart shows provider cost distribution. Budget alerts and forecasting.' },
  { name: 'Flows & Agents', description: 'Workflow execution metrics and agent delegation analytics. Line charts track execution counts, success rates, and average duration. Agent utilization heatmap by type.' },
  { name: 'MCP & Tools', description: 'MCP server health and tool execution metrics. Shows tool call volume, success rates, and latency percentiles. Top tools ranked by usage. Server availability timeline.' },
  { name: 'Infrastructure', description: 'System health metrics including API response times, database connection pools, Redis cache hit rates, queue depths, and Kubernetes pod status across namespaces.' },
];

const timeRanges = [
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const chartTypes = [
  { name: 'AreaChart', usage: 'Token usage over time, session counts, message volume trends. The filled area provides quick visual density recognition.' },
  { name: 'LineChart', usage: 'Latency percentiles (p50, p95, p99), success rates, and multi-series comparisons where overlay clarity matters.' },
  { name: 'BarChart', usage: 'Cost comparisons by provider or user, execution counts by agent type, and period-over-period comparisons.' },
  { name: 'PieChart', usage: 'Provider cost distribution, model usage share, and proportional breakdowns where the total is meaningful.' },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionStyle: React.CSSProperties = {
  marginBottom: '56px',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: 'var(--color-textMuted)',
  marginBottom: '8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 700,
  color: 'var(--color-text)',
  marginBottom: '12px',
  lineHeight: 1.2,
};

const bodyTextStyle: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.7,
  maxWidth: '680px',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '12px',
  padding: '20px 24px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--color-text)',
  marginBottom: '6px',
};

const descStyle: React.CSSProperties = {
  fontSize: '13px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.6,
};

// ============================================================================
// COMPONENT
// ============================================================================

const AdminDashboardPage: React.FC = () => {
  const fadeUp = useMemo(
    () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    }),
    []
  );

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      {/* HERO */}
      <motion.div {...fadeUp} style={{ marginBottom: '56px' }}>
        <div style={{ marginBottom: '20px' }}>
          <DocsInfraIcon size={40} />
        </div>
        <h1
          style={{
            fontSize: '36px',
            fontWeight: 700,
            color: 'var(--color-text)',
            marginBottom: '16px',
            letterSpacing: '-0.02em',
          }}
        >
          Admin Dashboard
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          The admin dashboard provides a comprehensive, real-time view of platform health,
          usage patterns, and cost attribution. All metrics auto-refresh every 60 seconds
          and can be filtered by time range from the last hour to the last 90 days.
        </p>
      </motion.div>

      {/* SCREENSHOT */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        <img
          src="/docs/screenshots/admin-dashboard.png"
          alt="Admin dashboard overview showing metric summary cards and chart tabs"
          style={{
            width: '100%',
            borderRadius: '12px',
            border: '1px solid var(--color-border)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.12)',
          }}
        />
      </motion.section>

      {/* METRIC SUMMARY ROW */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Summary Metrics</p>
        <h2 style={sectionTitleStyle}>Six Key Indicators</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The top of the dashboard displays six summary metric cards. Each card shows the
          current value and a percentage change indicator relative to the previous equivalent
          time period. These cards provide an at-a-glance health check before diving into
          detailed tabs.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {metricSummaries.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{m.label}</h4>
              <p style={descStyle}>{m.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* DASHBOARD TABS */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Navigation</p>
        <h2 style={sectionTitleStyle}>Seven Dashboard Tabs</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The dashboard is organized into seven tabs, each providing a focused view of a
          specific aspect of platform operations. Tabs retain their state when switching,
          so you can compare data across views without losing context.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {dashboardTabs.map((tab, i) => (
            <motion.div
              key={tab.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--color-primary)',
                    background: 'var(--color-surfaceSecondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '6px',
                    padding: '2px 10px',
                    letterSpacing: '0.04em',
                  }}
                >
                  Tab {i + 1}
                </span>
                <h4 style={{ ...labelStyle, marginBottom: 0 }}>{tab.name}</h4>
              </div>
              <p style={descStyle}>{tab.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* TIME RANGE SELECTOR */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Filtering</p>
        <h2 style={sectionTitleStyle}>Time Range Selector</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          A dropdown at the top right of the dashboard controls the time window for all
          charts and metrics. Changing the time range re-fetches data from the aggregation
          layer and updates all visible charts simultaneously.
        </p>
        <div
          style={{
            ...cardStyle,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', marginRight: '8px' }}>
            Available ranges:
          </span>
          {timeRanges.map((r) => (
            <span
              key={r.value}
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: 'var(--color-textSecondary)',
                background: 'var(--color-surfaceSecondary)',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                padding: '4px 12px',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {r.value}
            </span>
          ))}
        </div>
      </motion.section>

      {/* CHART TYPES */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Visualizations</p>
        <h2 style={sectionTitleStyle}>Recharts Visualization Types</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The dashboard uses the Recharts library to render interactive, responsive charts.
          All charts support hover tooltips with exact values, and most support click-to-drill-down
          for additional detail.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {chartTypes.map((ct, i) => (
            <motion.div
              key={ct.name}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.06, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{ct.name}</h4>
              <p style={descStyle}>{ct.usage}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* DATA FLOW DIAGRAM */}
      <motion.section
        style={sectionStyle}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Architecture</p>
        <h2 style={sectionTitleStyle}>Data Flow</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Dashboard data flows from platform services through a metrics collector,
          gets aggregated into time-series rollups, and is served via the admin API
          to the React frontend for rendering.
        </p>
        <ReactFlowDiagram
          diagram={dashboardDiagram}
          height={320}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* AUTO-REFRESH */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
      >
        <p style={sectionHeadingStyle}>Behavior</p>
        <h2 style={sectionTitleStyle}>Auto-Refresh</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The dashboard automatically refreshes all metrics every 60 seconds. A subtle
          progress indicator in the top bar shows when the next refresh will occur. Manual
          refresh is available via a button in the toolbar. During refresh, charts smoothly
          transition to updated data without full page reloads. The auto-refresh interval
          applies to all tabs uniformly and persists across tab switches.
        </p>
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}>
              <DocsBrainIcon size={24} />
            </div>
            <div>
              <h4 style={labelStyle}>Performance Note</h4>
              <p style={descStyle}>
                Dashboard queries are optimized with pre-computed rollup tables. Time ranges
                beyond 30 days use hourly aggregation instead of raw data points, keeping
                response times under 500ms regardless of the selected range.
              </p>
            </div>
          </div>
        </div>
      </motion.section>
    </div>
  );
};

export default AdminDashboardPage;
