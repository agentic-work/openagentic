import React from 'react';
import { motion } from 'framer-motion';

const releases = [
  {
    version: '0.6.3',
    codename: 'Light It Up',
    date: 'April 2026',
    current: true,
    highlights: [
      'CDC Azure AI Foundry — Claude Opus 4.6 chat via Anthropic Messages API on Azure',
      'Smart model router through azure-ai-foundry provider handling both OpenAI and Anthropic formats',
      'AWS Identity Center trusted-token-issuer OBO flow for cross-cloud agent operations',
      'Auto-discovered AIF deployments surfaced in Model Registry and chat selector',
      'ChatPipeline per-LLM-call timeout bumped to 5 min for multi-tool ReAct loops',
      'HITL low-risk whitelist for read-only cross-sub resource graph queries',
      'Agents are draggable canvas nodes in Flows, pulled from /api/agents SOT registry',
      'Workflow templates auto-seeded on server startup (idempotent, upsert by name)',
      'Stg deployment on HA raft Vault with Shamir unseal — no cloud KMS',
    ],
  },
  {
    version: '0.6.0',
    codename: 'Overhaul',
    date: 'March 2026',
    current: false,
    highlights: [
      'Workflow governance — per-node/workflow/admin config hierarchy with 3-level governance',
      'Unified cross-mode memory — chat, code, and flows share a single per-user context layer',
      'Workflow versioning — auto-snapshot on save, visual diff, version restore',
      'Agent platform — persona system, tool policy, visual cron scheduling',
      'Admin dashboard overhaul — Recharts charts across all 10 admin views',
      'LLM Provider Setup Wizard — 4-step first-time configuration wizard',
      'Slack and Teams integration — inbound webhook to workflow execution',
    ],
  },
  {
    version: '0.5.0',
    codename: 'Hardened',
    date: 'February 2026',
    current: false,
    highlights: [
      'DLP Scanner — 50+ detection rules for credentials, PII, infrastructure secrets',
      'Immutable audit trail — cryptographic hash chaining, tamper-evident logs',
      'Mandatory HITL enforcement — server-side tool approval gate for high-risk operations',
      'Agent Proxy — multi-agent orchestration with parallel, sequential, supervisor patterns',
      'Apple-inspired color palette — real greens, blues, purples across the UI',
    ],
  },
  {
    version: '0.4.0',
    codename: 'Titan',
    date: 'February 2026',
    current: false,
    highlights: [
      '75 CVE patches, auth bypass removal',
      'Streaming code blocks fix',
      'Tool result grounding with LangGraph integration',
      'Unique colorful Admin Console icons with gradient animations',
    ],
  },
  {
    version: '0.3.0',
    codename: 'Atlas',
    date: 'January 2026',
    current: false,
    highlights: [
      'Live artifact streaming — artifacts render as they stream, not after completion',
      'Warm container pool — instant Code Mode startup via K8s warm pool',
      'Unified version system across all components',
    ],
  },
  {
    version: '0.2.0',
    codename: 'Pioneer',
    date: 'January 2026',
    current: false,
    highlights: [
      'Code Mode V2 with VSCode integration',
      'Intelligence Slider for model selection',
      'Multi-provider LLM support (Anthropic, OpenAI, Google, Azure, Ollama)',
      'MCP Tools integration',
    ],
  },
  {
    version: '0.1.0',
    codename: 'Genesis',
    date: 'December 2025',
    current: false,
    highlights: [
      'Initial release',
      'SSE streaming chat',
      'Azure AD and Google OAuth',
      'Basic MCP proxy',
    ],
  },
];

const ChangelogPage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-8 py-12">
    <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
      Changelog
    </h1>
    <p className="text-sm mb-10" style={{ color: 'var(--color-textSecondary)' }}>
      Version history and release notes for the OpenAgentic platform.
    </p>

    <div className="relative">
      {/* Timeline line */}
      <div
        className="absolute left-[18px] top-0 bottom-0 w-px"
        style={{ backgroundColor: 'var(--color-border)' }}
      />

      <div className="space-y-10">
        {releases.map((release, i) => (
          <motion.div
            key={release.version}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="relative pl-12"
          >
            {/* Timeline dot */}
            <div
              className="absolute left-2.5 top-1 w-4 h-4 rounded-full border-2"
              style={{
                backgroundColor: release.current ? 'var(--color-primary)' : 'var(--color-surface)',
                borderColor: release.current ? 'var(--color-primary)' : 'var(--color-border)',
              }}
            />

            {/* Version header */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                v{release.version}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: release.current ? 'var(--color-primary)' : 'var(--color-surfaceSecondary)',
                  color: release.current ? 'white' : 'var(--color-textMuted)',
                }}
              >
                {release.codename}
              </span>
              {release.current && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{ backgroundColor: '#22c55e20', color: '#22c55e' }}
                >
                  CURRENT
                </span>
              )}
              <span className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                {release.date}
              </span>
            </div>

            {/* Features */}
            <div
              className="rounded-lg p-4"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            >
              <ul className="space-y-2">
                {release.highlights.map((item, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-textSecondary)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5">
                      <circle cx="12" cy="12" r="4" fill="var(--color-primary)" opacity="0.6" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  </div>
);

export default ChangelogPage;
