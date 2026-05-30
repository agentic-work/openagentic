import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsCodeIcon, DocsInfraIcon, DocsToolIcon } from '../components/DocsIcons';

// ============================================================================
// SANDBOX LIFECYCLE DIAGRAM
// ============================================================================

const sandboxDiagram: DiagramDefinition = {
  type: 'process',
  title: 'Sandbox Pod Lifecycle',
  description: 'From user request to pod termination',
  layout: 'horizontal',
  nodes: [
    { id: 'request', label: 'User Opens Code', description: 'Session request', shape: 'rounded', color: 'blue' },
    { id: 'provision', label: 'Pod Provisioning', description: 'K8s pod creation', shape: 'rounded', color: 'orange' },
    { id: 'ready', label: 'Sandbox Ready', description: 'IDE connected', shape: 'rounded', color: 'green' },
    { id: 'active', label: 'Active Session', description: 'User coding', shape: 'rounded', color: 'primary' },
    { id: 'idle', label: 'Idle Detection', description: 'Inactivity timer', shape: 'diamond', color: 'yellow' },
    { id: 'terminate', label: 'Pod Termination', description: 'Resources freed', shape: 'rounded', color: 'red' },
  ],
  edges: [
    { source: 'request', target: 'provision', animated: true },
    { source: 'provision', target: 'ready' },
    { source: 'ready', target: 'active' },
    { source: 'active', target: 'idle', style: 'dashed' },
    { source: 'idle', target: 'terminate', label: 'timeout' },
    { source: 'idle', target: 'active', label: 'activity', style: 'dashed' },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const sessionListColumns = [
  { column: 'User', description: 'The authenticated user who owns the session. Links to the user\'s profile and activity history.' },
  { column: 'Pod Name', description: 'The Kubernetes pod identifier running the user\'s sandbox environment. Can be used for kubectl inspection.' },
  { column: 'Status', description: 'Current pod status: Provisioning, Running, Idle, or Terminating. Color-coded for quick scanning.' },
  { column: 'Started', description: 'Timestamp when the session was initiated. Duration since start is displayed in relative format.' },
  { column: 'Last Activity', description: 'Timestamp of the most recent user interaction (file edit, terminal command, or AI request).' },
  { column: 'Resource Usage', description: 'Current CPU and memory consumption as percentage of the allocated limits. Progress bars provide visual status.' },
  { column: 'Actions', description: 'Admin actions: view pod logs, restart pod, force terminate session. Force termination requires confirmation.' },
];

const podManagementFeatures = [
  { feature: 'Pod Inspection', description: 'View detailed pod information including container status, resource consumption, events, and logs. Direct kubectl-equivalent access without leaving the admin UI.' },
  { feature: 'Pod Restart', description: 'Gracefully restart a user\'s sandbox pod. The user is notified and the pod is recreated with the same configuration. Unsaved work in the editor is preserved via autosave.' },
  { feature: 'Force Terminate', description: 'Immediately terminate a pod and end the user\'s session. Used for runaway processes, resource exhaustion, or security incidents. Requires admin confirmation.' },
  { feature: 'Resource Adjustment', description: 'Dynamically adjust CPU and memory limits for a running pod. Changes take effect without pod restart for memory; CPU changes may require a rolling update.' },
];

const sandboxSettings = [
  { setting: 'Base Image', description: 'The container image used for sandbox environments. Includes pre-installed languages, tools, and AI coding assistants. Admins can customize the image to add organization-specific tools.' },
  { setting: 'Idle Timeout', description: 'Duration of inactivity before a session is automatically terminated. Default is 30 minutes. Shorter timeouts free resources faster; longer timeouts reduce user friction.' },
  { setting: 'Max Sessions per User', description: 'Maximum concurrent sandbox sessions a single user can have. Prevents resource hoarding. Default is 1 for standard users, 3 for power users.' },
  { setting: 'Persistent Storage', description: 'Whether sandbox sessions retain files between sessions via persistent volumes. When enabled, users can resume previous work. Storage is quota-limited per user.' },
  { setting: 'Network Policy', description: 'Network access rules for sandbox pods. Options: isolated (no external access), restricted (allowlisted endpoints only), or open (full internet access). Default is restricted.' },
];

const resourceLimits = [
  { resource: 'CPU Request', description: 'Minimum CPU allocated to each sandbox pod. Guaranteed resources that the pod always has access to. Default: 500m (half a CPU core).' },
  { resource: 'CPU Limit', description: 'Maximum CPU a sandbox pod can consume. Prevents any single session from starving other pods. Default: 2000m (2 CPU cores).' },
  { resource: 'Memory Request', description: 'Minimum memory allocated to each sandbox pod. Guaranteed to be available. Default: 512Mi.' },
  { resource: 'Memory Limit', description: 'Maximum memory a sandbox pod can use. Exceeding this limit causes the container to be OOM-killed and restarted. Default: 4Gi.' },
  { resource: 'Ephemeral Storage', description: 'Maximum temporary disk space for the sandbox. Used for build artifacts, temporary files, and downloaded packages. Default: 10Gi.' },
  { resource: 'GPU Access', description: 'Whether sandbox pods can request GPU resources. Disabled by default. When enabled, admins specify the GPU type and maximum count per pod.' },
];

const sessionMetrics = [
  { metric: 'Total Sessions', description: 'Cumulative count of all Openagentic sessions created. Broken down by time period (hourly, daily, weekly) for trend analysis.' },
  { metric: 'Active Sessions', description: 'Current count of running sandbox pods. Displayed as a real-time gauge with historical overlay. Helps with capacity planning.' },
  { metric: 'Average Provision Time', description: 'Mean time from session request to sandbox ready state. Includes pod scheduling, image pull, and container startup. Target is under 15 seconds.' },
  { metric: 'Session Duration Distribution', description: 'Histogram showing how long sessions last. Identifies usage patterns: quick tasks (under 10 minutes) vs. extended development sessions (hours).' },
  { metric: 'Resource Utilization', description: 'Aggregate CPU and memory utilization across all active sandbox pods. Shows cluster-level resource pressure and informs scaling decisions.' },
  { metric: 'Pod Failure Rate', description: 'Percentage of sessions that ended due to pod failures (OOM kills, crash loops, scheduling failures). High rates indicate resource limit or image issues.' },
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

const AdminCodeModePage: React.FC = () => {
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
        <div style={{ marginBottom: '20px' }}><DocsCodeIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          Openagentic Administration
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          Manage Openagentic sandbox environments from the admin console. Monitor active
          sessions, manage per-user Kubernetes pods, configure sandbox settings and resource
          limits, and track session metrics for capacity planning.
        </p>
      </motion.div>

      {/* SANDBOX LIFECYCLE DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Lifecycle</p>
        <h2 style={sectionTitleStyle}>Sandbox Pod Lifecycle</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Each Openagentic session runs in an isolated Kubernetes pod that follows a defined
          lifecycle from provisioning through idle detection and termination.
        </p>
        <ReactFlowDiagram
          diagram={sandboxDiagram}
          height={320}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* ACTIVE SESSIONS LIST */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Sessions</p>
        <h2 style={sectionTitleStyle}>Active Sessions List</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The active sessions view provides a real-time table of all running Openagentic
          sessions with detailed status information and admin actions.
        </p>
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '14px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
                {['Column', 'Description'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600, color: 'var(--color-textMuted)', fontSize: '11px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sessionListColumns.map((c, i) => (
                <tr key={c.column} style={{ borderBottom: i < sessionListColumns.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap' }}>{c.column}</td>
                  <td style={{ padding: '10px 16px', color: 'var(--color-textSecondary)' }}>{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* POD MANAGEMENT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Operations</p>
        <h2 style={sectionTitleStyle}>Per-User Pod Management</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Admin actions for managing individual user sandbox pods.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {podManagementFeatures.map((f, i) => (
            <motion.div
              key={f.feature}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + i * 0.05, duration: 0.35 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsInfraIcon size={20} /></div>
              <div>
                <h4 style={labelStyle}>{f.feature}</h4>
                <p style={descTextStyle}>{f.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* SANDBOX SETTINGS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Configuration</p>
        <h2 style={sectionTitleStyle}>Sandbox Settings</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Global settings that control sandbox environment behavior for all users.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {sandboxSettings.map((s, i) => (
            <motion.div
              key={s.setting}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <span style={{
                  fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono)',
                  color: 'var(--color-primary)', background: 'var(--color-surfaceSecondary)',
                  border: '1px solid var(--color-border)', borderRadius: '4px', padding: '2px 8px',
                }}>
                  config
                </span>
                <h4 style={{ ...labelStyle, marginBottom: 0 }}>{s.setting}</h4>
              </div>
              <p style={descTextStyle}>{s.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* RESOURCE LIMITS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Resources</p>
        <h2 style={sectionTitleStyle}>Resource Limits</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Kubernetes resource requests and limits for sandbox pods. These settings
          control the compute resources available to each user session.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {resourceLimits.map((r, i) => (
            <motion.div
              key={r.resource}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{r.resource}</h4>
              <p style={descTextStyle}>{r.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* SESSION METRICS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Analytics</p>
        <h2 style={sectionTitleStyle}>Session Metrics</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Key metrics for monitoring Openagentic usage and planning capacity.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {sessionMetrics.map((m, i) => (
            <motion.div
              key={m.metric}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.04, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsToolIcon size={18} /></div>
              <div>
                <h4 style={labelStyle}>{m.metric}</h4>
                <p style={descTextStyle}>{m.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>
    </div>
  );
};

export default AdminCodeModePage;
