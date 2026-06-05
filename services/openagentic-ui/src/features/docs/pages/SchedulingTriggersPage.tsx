// theme-allow: decorative gradient SVG illustration icons (multi-stop art glyphs).
import React from 'react';
import { motion } from 'framer-motion';

// ============================================================================
// INLINE SVG ICONS
// ============================================================================

const ClockIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="clockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#22c55e" />
        <stop offset="100%" stopColor="#14b8a6" />
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10" stroke="url(#clockGrad)" strokeWidth="2" />
    <polyline points="12,6 12,12 16,14" stroke="url(#clockGrad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WebhookIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <defs>
      <linearGradient id="webhookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
    </defs>
    <circle cx="6" cy="18" r="3" stroke="url(#webhookGrad)" strokeWidth="2" />
    <path d="M6 15a6 6 0 009.33-5" stroke="url(#webhookGrad)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="18" cy="6" r="3" stroke="url(#webhookGrad)" strokeWidth="2" />
    <path d="M18 9a6 6 0 01-9.33 5" stroke="url(#webhookGrad)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

// ============================================================================
// COMPONENT
// ============================================================================

const SchedulingTriggersPage: React.FC = () => {
  const cronExamples = [
    { expression: '0 9 * * 1-5', meaning: 'Every weekday at 9:00 AM' },
    { expression: '*/15 * * * *', meaning: 'Every 15 minutes' },
    { expression: '0 0 * * 0', meaning: 'Every Sunday at midnight' },
    { expression: '0 8 1 * *', meaning: 'First day of every month at 8:00 AM' },
    { expression: '30 17 * * 5', meaning: 'Every Friday at 5:30 PM' },
    { expression: '0 */6 * * *', meaning: 'Every 6 hours' },
  ];

  const webhookFeatures = [
    { feature: 'Unique URL', detail: 'Each workflow gets a unique, unguessable webhook URL that can be rotated at any time.' },
    { feature: 'Signature Verification', detail: 'Incoming requests are verified using HMAC-SHA256 signatures. Unsigned or mismatched requests are rejected.' },
    { feature: 'Payload Mapping', detail: 'The webhook body is available as input data. Use Transform nodes to extract and reshape the payload.' },
    { feature: 'IP Filtering', detail: 'Optionally restrict webhook calls to specific IP ranges or CIDR blocks.' },
    { feature: 'Rate Limiting', detail: 'Webhooks are rate-limited per workflow to prevent abuse. Default: 60 calls per minute.' },
  ];

  const eventTypes = [
    { event: 'metric.threshold', description: 'A Prometheus query result crosses a configured threshold', source: 'Prometheus MCP' },
    { event: 'log.match', description: 'A log query matches a configured pattern', source: 'Loki MCP' },
    { event: 'deployment.completed', description: 'A Kubernetes deployment rollout completes', source: 'Kubernetes MCP' },
    { event: 'github.push', description: 'Commits are pushed to a watched repository', source: 'GitHub MCP' },
    { event: 'approval.pending', description: 'A HITL approval gate is waiting for a decision', source: 'Platform' },
    { event: 'cost.threshold', description: 'Cloud spending exceeds a configured threshold', source: 'AWS / Azure / GCP MCP' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Scheduling and Triggers
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          Workflows can be triggered manually, on a schedule, via webhooks, through the API, or in
          response to platform events. Multiple triggers can be attached to a single workflow.
        </p>
      </motion.div>

      {/* Cron Scheduling */}
      <motion.section custom={1} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <ClockIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Cron Scheduling
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          Use standard cron expressions to run workflows on a recurring schedule. The scheduler runs
          in UTC and supports timezone overrides per workflow.
        </p>
        <div
          className="rounded-xl overflow-hidden mb-10"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Expression</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              {cronExamples.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="p-3 font-mono text-xs" style={{ color: 'var(--color-text)' }}>{row.expression}</td>
                  <td className="p-3" style={{ color: 'var(--color-textSecondary)' }}>{row.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>

      {/* Webhooks */}
      <motion.section custom={2} variants={sectionVariants} initial="hidden" animate="visible">
        <div className="flex items-center gap-3 mb-4">
          <WebhookIcon />
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
            Webhooks
          </h2>
        </div>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          Trigger workflows from external systems by sending an HTTP POST to the workflow's webhook URL.
          The request body becomes the workflow input data.
        </p>
        <div className="space-y-3 mb-10">
          {webhookFeatures.map((item, i) => (
            <motion.div
              key={item.feature}
              custom={i + 3}
              variants={sectionVariants}
              initial="hidden"
              animate="visible"
              className="rounded-lg p-4 flex gap-4"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }} />
              <div>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {item.feature}
                </span>
                <p className="text-sm mt-1" style={{ color: 'var(--color-textSecondary)' }}>
                  {item.detail}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* Event Triggers */}
      <motion.section custom={8} variants={sectionVariants} initial="hidden" animate="visible">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          Event Triggers
        </h2>
        <p className="mb-6 leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
          Workflows can react to platform events in real time. When an event matching the trigger
          condition occurs, the workflow starts with the event payload as input.
        </p>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: 'var(--color-surface)' }}>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Event</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Description</th>
                <th className="text-left p-3 font-semibold" style={{ color: 'var(--color-text)', borderBottom: '1px solid var(--color-border)' }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {eventTypes.map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="p-3 font-mono text-xs" style={{ color: 'var(--color-text)' }}>{row.event}</td>
                  <td className="p-3" style={{ color: 'var(--color-textSecondary)' }}>{row.description}</td>
                  <td className="p-3 text-xs" style={{ color: 'var(--color-textMuted)' }}>{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.section>
    </div>
  );
};

export default SchedulingTriggersPage;
