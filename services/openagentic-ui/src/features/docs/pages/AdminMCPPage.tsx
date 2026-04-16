/**
 * AdminMCPPage - MCP Server Management documentation.
 *
 * Documents server CRUD, tool discovery, health monitoring, log streaming,
 * access control, and API endpoints.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsToolIcon, DocsShieldIcon, DocsInfraIcon } from '../components/DocsIcons';

// ============================================================================
// MCP ARCHITECTURE DIAGRAM
// ============================================================================

const mcpArchitectureDiagram: DiagramDefinition = {
  type: 'architecture',
  title: 'MCP Server Architecture',
  description: 'How the platform communicates with MCP servers',
  layout: 'vertical',
  nodes: [
    { id: 'chat', label: 'Chat Pipeline', description: 'User request', shape: 'rounded', color: 'blue' },
    { id: 'proxy', label: 'MCP Proxy', description: 'Routing & auth', shape: 'server', color: 'orange' },
    { id: 'discovery', label: 'Tool Discovery', description: 'Vector similarity', shape: 'rounded', color: 'cyan' },
    { id: 'server1', label: 'MCP Server A', description: 'e.g., Azure tools', shape: 'server', color: 'purple' },
    { id: 'server2', label: 'MCP Server B', description: 'e.g., GitHub tools', shape: 'server', color: 'purple' },
    { id: 'server3', label: 'MCP Server C', description: 'e.g., K8s tools', shape: 'server', color: 'purple' },
    { id: 'health', label: 'Health Monitor', description: 'Periodic checks', shape: 'rounded', color: 'green' },
    { id: 'logs', label: 'Log Aggregator', description: 'Structured logs', shape: 'database', color: 'gray' },
  ],
  edges: [
    { source: 'chat', target: 'proxy', animated: true },
    { source: 'proxy', target: 'discovery' },
    { source: 'discovery', target: 'server1', style: 'dashed' },
    { source: 'discovery', target: 'server2', style: 'dashed' },
    { source: 'discovery', target: 'server3', style: 'dashed' },
    { source: 'health', target: 'server1', style: 'dashed', color: 'green' },
    { source: 'health', target: 'server2', style: 'dashed', color: 'green' },
    { source: 'health', target: 'server3', style: 'dashed', color: 'green' },
    { source: 'server1', target: 'logs', style: 'dashed', color: 'gray' },
    { source: 'server2', target: 'logs', style: 'dashed', color: 'gray' },
    { source: 'server3', target: 'logs', style: 'dashed', color: 'gray' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const mcpTabs = [
  {
    name: 'Server Management',
    description: 'The primary view for managing MCP server configurations. Each server is displayed as a card showing its name, transport type (stdio or SSE), connection status, tool count, and last health check time. Supports add, edit, delete, enable, and disable operations.',
  },
  {
    name: 'Registry',
    description: 'A searchable catalog of all registered MCP servers, both active and inactive. Displays metadata including server version, author, description, and capability tags. Admins can browse the registry to discover available servers and activate them.',
  },
  {
    name: 'Tools',
    description: 'Unified view of all tools across all connected MCP servers. Each tool shows its name, description, input schema, server of origin, and execution statistics. Supports testing individual tools with custom input payloads and inspecting the response.',
  },
  {
    name: 'Health',
    description: 'Health status matrix showing all servers in a grid with real-time status indicators. Displays response latency, uptime percentage, consecutive failures, and last successful check time. Unhealthy servers are highlighted and can be restarted from this view.',
  },
  {
    name: 'Logs',
    description: 'Real-time log streaming from all MCP servers with powerful filtering. Filter by server, log level (debug, info, warn, error), time range, and text search. Logs are structured JSON and can be expanded to view full payloads.',
  },
];

const serverOperations = [
  { op: 'Add Server', description: 'Register a new MCP server by specifying its name, transport type (stdio command or SSE URL), environment variables, and optional authentication. The system validates connectivity before saving.' },
  { op: 'Edit Server', description: 'Modify server configuration including connection details, environment variables, and timeout settings. Changes take effect on the next connection cycle.' },
  { op: 'Delete Server', description: 'Permanently removes a server and all its tool registrations. Requires confirmation. Active tool calls to this server will fail gracefully.' },
  { op: 'Enable / Disable', description: 'Toggle server availability without removing its configuration. Disabled servers are hidden from tool discovery and their tools are unavailable to agents.' },
];

const accessControlFeatures = [
  { feature: 'Azure AD Group Mapping', description: 'Each MCP server can be restricted to specific Azure AD groups. Only users in the mapped groups can invoke tools from that server. Multiple groups can be assigned per server.' },
  { feature: 'Tool-Level Permissions', description: 'Beyond server-level access, individual tools can have additional permission requirements. High-risk tools can require elevated roles or explicit approval.' },
  { feature: 'Execution Mode', description: 'Servers can be set to read-only mode (informational queries only) or full-access mode (read and write operations). Read-only mode is recommended for production environments until tools are thoroughly tested.' },
];

const apiEndpoints = [
  { method: 'GET', path: '/admin/mcp/servers', description: 'List all registered MCP servers with status.' },
  { method: 'POST', path: '/admin/mcp/servers', description: 'Register a new MCP server.' },
  { method: 'PUT', path: '/admin/mcp/servers/:id', description: 'Update server configuration.' },
  { method: 'DELETE', path: '/admin/mcp/servers/:id', description: 'Remove a server registration.' },
  { method: 'POST', path: '/admin/mcp/servers/:id/enable', description: 'Enable a disabled server.' },
  { method: 'POST', path: '/admin/mcp/servers/:id/disable', description: 'Disable a server.' },
  { method: 'GET', path: '/admin/mcp/servers/:id/tools', description: 'List tools for a specific server.' },
  { method: 'POST', path: '/admin/mcp/tools/:id/test', description: 'Test a specific tool with sample input.' },
  { method: 'GET', path: '/admin/mcp/health', description: 'Get health status matrix for all servers.' },
  { method: 'GET', path: '/admin/mcp/logs', description: 'Query server logs with filters.' },
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

const AdminMCPPage: React.FC = () => {
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
        <div style={{ marginBottom: '20px' }}><DocsToolIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          MCP Server Management
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          The MCP (Model Context Protocol) management console provides full control over
          the platform's tool servers. Manage server connections, discover and test tools,
          monitor health in real time, and stream logs for debugging. Access control is
          enforced per Azure AD group.
        </p>
      </motion.div>

      {/* SCREENSHOT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <img
          src="/docs/screenshots/admin-mcp.png"
          alt="MCP server management interface showing server cards and health indicators"
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}
        />
      </motion.section>

      {/* FIVE TABS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Navigation</p>
        <h2 style={sectionTitleStyle}>Five Management Tabs</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          MCP administration is organized into five tabs covering server configuration,
          tool discovery, health monitoring, and log analysis.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {mcpTabs.map((tab, i) => (
            <motion.div
              key={tab.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.05, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <span style={{
                  display: 'inline-block', fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)',
                  background: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)',
                  borderRadius: '6px', padding: '2px 10px', letterSpacing: '0.04em',
                }}>
                  Tab {i + 1}
                </span>
                <h4 style={{ ...labelStyle, marginBottom: 0 }}>{tab.name}</h4>
              </div>
              <p style={descTextStyle}>{tab.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* ARCHITECTURE DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Architecture</p>
        <h2 style={sectionTitleStyle}>MCP Server Architecture</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The MCP proxy sits between the chat pipeline and individual MCP servers,
          handling routing, authentication, health monitoring, and log aggregation.
        </p>
        <ReactFlowDiagram
          diagram={mcpArchitectureDiagram}
          height={480}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* SERVER OPERATIONS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Operations</p>
        <h2 style={sectionTitleStyle}>Server CRUD Operations</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {serverOperations.map((op, i) => (
            <motion.div
              key={op.op}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.05, duration: 0.35 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{op.op}</h4>
              <p style={descTextStyle}>{op.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* TOOL DISCOVERY */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Tools</p>
        <h2 style={sectionTitleStyle}>Tool Discovery and Testing</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          When a server is connected, the platform automatically discovers all tools it exposes
          via the MCP protocol. Each tool's name, description, and JSON Schema input definition
          is indexed for vector-based discovery. The Tools tab provides a testing interface where
          admins can invoke any tool with custom payloads and inspect the full response, including
          execution time and output structure.
        </p>
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsToolIcon size={24} /></div>
            <div>
              <h4 style={labelStyle}>Semantic Tool Discovery</h4>
              <p style={descTextStyle}>
                Tool descriptions are embedded using the configured embedding provider and stored
                in the vector database. When a user's message requires tools, the system finds
                relevant tools via semantic similarity rather than keyword matching, enabling
                natural language tool selection.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* LOG STREAMING */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Debugging</p>
        <h2 style={sectionTitleStyle}>Real-Time Log Streaming</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The Logs tab provides a live-updating view of all MCP server logs. Logs stream
          in real time via WebSocket and can be paused for inspection. Filtering options
          include server name, log level, time range, and full-text search. Each log entry
          can be expanded to view the complete structured JSON payload including request
          inputs, response outputs, and timing information.
        </p>
      </motion.section>

      {/* HEALTH STATUS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.42, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Monitoring</p>
        <h2 style={sectionTitleStyle}>Health Status Matrix</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The Health tab displays a matrix of all servers with real-time status indicators.
          Health checks run periodically and measure response latency, tool availability,
          and connection stability. Servers are classified as healthy (green), degraded
          (yellow), or unreachable (red). The matrix also tracks uptime percentage and
          consecutive failure counts for trend analysis.
        </p>
      </motion.section>

      {/* ACCESS CONTROL */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Security</p>
        <h2 style={sectionTitleStyle}>Access Control</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          MCP server access is governed by Azure AD group membership and execution mode settings.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {accessControlFeatures.map((f, i) => (
            <motion.div
              key={f.feature}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.05, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsShieldIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{f.feature}</h4>
                <p style={descTextStyle}>{f.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* API ENDPOINTS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>API Reference</p>
        <h2 style={sectionTitleStyle}>MCP API Endpoints</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          All MCP management operations are available via the admin REST API.
        </p>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
                {['Method', 'Endpoint', 'Description'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {apiEndpoints.map((ep, i) => (
                <tr key={`${ep.method}-${ep.path}`} style={{ borderBottom: i < apiEndpoints.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                      color: ep.method === 'GET' ? '#22c55e' : ep.method === 'POST' ? '#3b82f6' : ep.method === 'PUT' ? '#f59e0b' : '#ef4444',
                    }}>
                      {ep.method}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--color-text)' }}>{ep.path}</td>
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

export default AdminMCPPage;
