import React, { useMemo } from 'react';
import { motion, type Transition } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsInfraIcon, DocsToolIcon, DocsBrainIcon } from '../components/DocsIcons';

// ============================================================================
// OBSERVABILITY STACK DIAGRAM
// ============================================================================

const observabilityDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'Observability Stack',
  description: 'Built-in Prometheus metrics + optional external backends',
  layout: 'vertical',
  nodes: [
    { id: 'services', label: 'Platform Services', description: 'API, MCP, Agents', shape: 'server', color: 'blue' },
    { id: 'prometheus', label: 'Prometheus', description: 'Metrics scraping (shipped)', shape: 'rounded', color: 'orange' },
    { id: 'admin-ui', label: 'Admin UI', description: 'Built-in monitoring', shape: 'rounded', color: 'primary' },
    { id: 'grafana', label: 'Grafana', description: 'Optional external', shape: 'rounded', color: 'gray' },
    { id: 'loki', label: 'Loki', description: 'Optional external logs', shape: 'rounded', color: 'gray' },
  ],
  edges: [
    { source: 'services', target: 'prometheus', label: '/metrics', animated: true },
    { source: 'prometheus', target: 'admin-ui' },
    { source: 'prometheus', target: 'grafana', label: 'optional', style: 'dashed', color: 'gray' },
    { source: 'services', target: 'loki', label: 'optional', style: 'dashed', color: 'gray' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const mcpMetrics = [
  { metric: 'Total Calls', description: 'Cumulative count of all MCP tool invocations across all servers. Includes successful, failed, and timed-out calls.' },
  { metric: 'Success Rate', description: 'Percentage of tool calls that completed successfully (HTTP 2xx or valid MCP response). Displayed as a gauge with green/yellow/red thresholds.' },
  { metric: 'Average Execution Time', description: 'Mean time from tool invocation to response across all tools. Broken down by percentile (p50, p95, p99) for latency analysis.' },
  { metric: 'Failed Calls', description: 'Count of tool calls that returned errors, timed out, or were rejected by access control. Expandable to see failure reasons.' },
];

const llmMetrics = [
  { metric: 'Total Messages', description: 'Count of all LLM completion requests sent across all providers. Includes chat, code, embedding, and agent calls.' },
  { metric: 'Total Tokens', description: 'Cumulative token consumption (input + output) across all providers. Broken down by provider and model for cost attribution.' },
  { metric: 'Total Cost', description: 'Aggregated cost across all LLM calls based on provider pricing rules. Updated in near real-time with cost-per-token calculations.' },
  { metric: 'Average Tokens per Message', description: 'Mean token count per completion request. Useful for identifying verbose prompts or unexpectedly large responses.' },
];

const topCharts = [
  { chart: 'Top Tools by Call Volume', description: 'Bar chart ranking MCP tools by invocation count. Identifies the most heavily used tools and potential optimization targets.' },
  { chart: 'Top Tools by Failure Rate', description: 'Bar chart ranking tools by error percentage. Highlights tools that need attention or server-side fixes.' },
  { chart: 'Top Models by Token Usage', description: 'Bar chart ranking models by total tokens consumed. Helps identify which models drive the most cost.' },
  { chart: 'Top Models by Request Count', description: 'Bar chart ranking models by number of completion requests. Shows routing distribution across the model fleet.' },
];

const debugTools = [
  { tool: 'Reindex MCP Tools', description: 'Triggers a full re-discovery and re-indexing of all MCP server tools. Useful after server upgrades or when tool discovery seems stale. Updates the vector embeddings for semantic tool matching.' },
  { tool: 'Clear Caches', description: 'Invalidates Redis caches for model routing, tool schemas, and session data. Useful for forcing fresh data after configuration changes. Select which cache layers to clear.' },
  { tool: 'Test Tool Calling', description: 'End-to-end diagnostic that sends a test prompt through the full pipeline, forces tool selection, and verifies the complete tool call roundtrip. Reports timing for each stage.' },
];

const grafanaDashboards = [
  { name: 'Platform Overview', description: 'High-level health: request rate, error rate, latency, active users.' },
  { name: 'LLM Performance', description: 'Model response times, token throughput, and provider availability.' },
  { name: 'MCP Tool Analytics', description: 'Tool call volume, latency distributions, and error breakdown.' },
  { name: 'Agent Execution', description: 'Agent delegation counts, success rates, and duration histograms.' },
  { name: 'Cost Attribution', description: 'Spend by provider, model, user, and team over time.' },
  { name: 'Workflow Metrics', description: 'Execution counts, durations, and failure analysis.' },
  { name: 'Infrastructure Health', description: 'Pod status, resource utilization, and node health.' },
  { name: 'Database Performance', description: 'PostgreSQL query times, connection pools, and pgvector latency.' },
  { name: 'Redis Metrics', description: 'Cache hit rates, memory usage, and connection counts.' },
  { name: 'DLP & Security', description: 'DLP scan rates, violation counts, and blocked content categories.' },
  { name: 'User Activity', description: 'Active sessions, message rates, and feature usage distribution.' },
];

const prometheusEndpoints = [
  { endpoint: '/metrics', description: 'Standard Prometheus metrics for the API service. Includes HTTP request counts, latencies, and error rates.' },
  { endpoint: '/metrics/llm', description: 'LLM-specific metrics: token counts, model latencies, provider health, and routing decisions.' },
  { endpoint: '/metrics/mcp', description: 'MCP tool metrics: call counts, execution times, error rates, and server health.' },
  { endpoint: '/metrics/agents', description: 'Agent execution metrics: delegation counts, success rates, and cost per agent type.' },
  { endpoint: '/metrics/flows', description: 'Workflow execution metrics: run counts, durations, node-level timing, and failure rates.' },
];

// ============================================================================
// STYLES
// ============================================================================

const sectionStyle: React.CSSProperties = { marginBottom: '56px' };
const sectionHeadingStyle: React.CSSProperties = { fontSize: '13px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: 'var(--color-textMuted)', marginBottom: '8px' };
const sectionTitleStyle: React.CSSProperties = { fontSize: '24px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '12px', lineHeight: 1.2 };
const bodyTextStyle: React.CSSProperties = { fontSize: '14px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' };
const cardStyle: React.CSSProperties = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '20px 24px' };
const labelStyle: React.CSSProperties = { fontSize: '14px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '6px' };
const descTextStyle: React.CSSProperties = { fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 };

// ============================================================================
// COMPONENT
// ============================================================================

const AdminMonitoringPage: React.FC = () => {
  const fadeUp = useMemo(
    () => ({
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } as Transition,
    }),
    []
  );

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      {/* HERO */}
      <motion.div {...fadeUp} style={{ marginBottom: '56px' }}>
        <div style={{ marginBottom: '20px' }}><DocsInfraIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Monitoring & Observability
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          Comprehensive monitoring across the entire platform stack. Track MCP tool
          performance, LLM usage and costs, infrastructure health, and debug issues
          with built-in diagnostic tools. Backed by shipped Prometheus metrics and the
          built-in admin monitoring view, with optional external Grafana and Loki backends.
        </p>
      </motion.div>

      {/* SCREENSHOT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <img
          src="/docs/screenshots/admin-monitoring.png"
          alt="Monitoring dashboard showing MCP tool metrics and LLM usage charts"
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}
        />
      </motion.section>

      {/* OBSERVABILITY STACK DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Architecture</p>
        <h2 style={sectionTitleStyle}>Observability Stack</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The platform ships Prometheus for metrics scraping and exposes a built-in
          monitoring view in the admin UI for quick access. External Grafana (for richer
          dashboards) and Loki (for log aggregation) are optional integrations you can
          point the platform at — they are not deployed by the stack itself.
        </p>
        <ReactFlowDiagram
          diagram={observabilityDiagram}
          height={420}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* MCP TOOL METRICS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>MCP Tools</p>
        <h2 style={sectionTitleStyle}>MCP Tool Execution Metrics</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Four key metrics provide a comprehensive view of MCP tool health and performance.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {mcpMetrics.map((m, i) => (
            <motion.div
              key={m.metric}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 + i * 0.05, duration: 0.35 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsToolIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{m.metric}</h4>
                <p style={descTextStyle}>{m.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* LLM USAGE METRICS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>LLM Usage</p>
        <h2 style={sectionTitleStyle}>LLM Usage Metrics</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Four metrics track LLM consumption across all providers and models.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {llmMetrics.map((m, i) => (
            <motion.div
              key={m.metric}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.05, duration: 0.35 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsBrainIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{m.metric}</h4>
                <p style={descTextStyle}>{m.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* TOP CHARTS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Rankings</p>
        <h2 style={sectionTitleStyle}>Top Tools and Top Models</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Ranked bar charts identify the highest-impact tools and models for optimization
          and capacity planning.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {topCharts.map((c, i) => (
            <motion.div
              key={c.chart}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{c.chart}</h4>
              <p style={descTextStyle}>{c.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* DEBUG TOOLS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Diagnostics</p>
        <h2 style={sectionTitleStyle}>Debug Tools</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Built-in diagnostic tools for troubleshooting platform issues without
          needing direct infrastructure access.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {debugTools.map((dt, i) => (
            <motion.div
              key={dt.tool}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 + i * 0.05, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{dt.tool}</h4>
              <p style={descTextStyle}>{dt.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* GRAFANA DASHBOARDS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Grafana (optional)</p>
        <h2 style={sectionTitleStyle}>Suggested Dashboards</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          If you connect an external Grafana instance, these are the dashboards we
          recommend building on top of the shipped Prometheus metrics. Grafana itself is
          not deployed by the stack — the admin UI link points at whatever Grafana you
          configure.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
          {grafanaDashboards.map((d, i) => (
            <motion.div
              key={d.name}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.03, duration: 0.25 }}
              style={{ ...cardStyle, padding: '14px 18px' }}
            >
              <h4 style={{ ...labelStyle, fontSize: '13px' }}>{d.name}</h4>
              <p style={{ ...descTextStyle, fontSize: '12px' }}>{d.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* PROMETHEUS ENDPOINTS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Metrics Endpoints</p>
        <h2 style={sectionTitleStyle}>Prometheus Metrics</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Each service exposes Prometheus-compatible metrics endpoints that are scraped
          automatically by the monitoring stack.
        </p>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
                {['Endpoint', 'Description'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prometheusEndpoints.map((ep, i) => (
                <tr key={ep.endpoint} style={{ borderBottom: i < prometheusEndpoints.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text)', fontWeight: 600 }}>{ep.endpoint}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--color-textSecondary)' }}>{ep.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
};

export default AdminMonitoringPage;
