import React from 'react';
import { motion } from 'framer-motion';

const releases = [
  {
    version: '0.7.1',
    codename: 'AGENTICHAT',
    date: 'May 2026',
    current: true,
    image: '/agentichat.png',
    highlights: [
      'Enterprise chatmode (Claude-Code-grade) — single chatmode pipeline, 12 T1 primitives (tool_search, agent_search, Task, agent_send/list/stop, read_large_result, web_search, web_fetch, synth, pattern_save, pattern_recall), per-T1 description builders, full SDK canonical events',
      'Glob-based permissions UI — Claude-Code allow/deny/ask rules replace the legacy regex-tier ToolApprovalGate. Admin editor at /admin#tool-permissions. 48/48 TDD\'d',
      'Inline tool-result summary — completed tool cards now show "· N items" / "· N subscriptions" inline in the header (mock 01 §863 contract). Drillable INPUT/RESULT body preserved',
      'Learned patterns memory — learned_patterns Milvus collection (model-write-only via pattern_save, RBAC-filtered recall via pattern_recall). Exemplars, not prescriptions. DLP-redacted at write',
      'LargeResultStorage end-to-end — Redis-backed offload at 30KB threshold with auto-tokens ({{count}}/{{sample_names}}) in 9 cloud-list seed templates. Handle survives multi-pod restarts via Redis (48h TTL)',
      'OBO end-to-end — AD User → Azure access_token → MCP user-identity 1-1. 6-case real TDD harness pins the wire-in (commit 6df31d57)',
      'Admin-configurable max_turns — chat_loop.max_turns knob in SystemConfiguration. Default 24, range [4, 100]. No more silent 12-turn cap on capstone work',
    ],
  },
  {
    version: '0.7.0',
    codename: 'Atlas Donzo',
    date: 'April 2026',
    current: false,
    highlights: [
      'Universal admin chrome migration — every routed admin page now uses the v2 PageHeader primitive',
      'New API Token Management view + KubernetesView (KSM-driven cluster health) replacing v1 placeholders',
      'Sidebar restructure — Security & Access merged into System Management, Performance Metrics moved to Dashboard tab, Legacy Templates retired',
      'Theme audit + sweep — 0 accent leaks, 0 zero-contrast, 0 undefined tokens; 263 residual hex literals scrubbed; ESLint rule `no-hardcoded-admin-color` blocks regressions',
      'AIF non-stream Responses API — gpt-5-pro / gpt-5-codex / o-pro deployments now route correctly from the admin Test-Provider button',
      'PageHeader sticky-mode on log/audit pages for long-scroll usability',
      'Docs / About — animated `[openagentic]` brand wordmark + atlas hero image in the About modal, sourced from a shared component',
    ],
  },
  {
    version: '0.6.27',
    codename: 'Atlas Shrugged',
    date: 'April 2026',
    current: false,
    highlights: [
      'Router Tuning Live Scoring Lab — tune SmartRouter weights live, simulate 8 hard prompts, visualize the formula, see ranked KPIs; 10 new Prometheus metrics instrument Router + Defaults',
      'Registry as sole SoT for default chat model — env-var + Ollama hardcodes removed; Tenant Default Models admin page owns all 5 category defaults',
      'Dynamic cross-CSP pricing — BedrockPricingFetcher (AWS SDK) + PricingService orchestrator replace stale static tables',
      '/model slash command for live LLM hot-swap (#355); Ollama thinking-only fallback',
      'File uploads persist to MinIO — drag-dropped files go through pre-upload pipeline instead of base64-inlined into messages',
      'Admin console v2 — Control Plane-inspired redesign (lazy chunk); recharts sparklines, MCP pie + LLM Sankey on Overview, 7 populated tabs from /admin/dashboard/metrics; v1 SettingsMenu + close X + Cog header preserved',
      'UAT bench router blocker cleared — chat-stream now routes to claude-sonnet-4-6 for all prompt sizes; 152-UC bench unblocked',
      '492 commits since 0.6.6. Breaking: DEFAULT_CHAT_MODEL env / Ollama fallback no longer read — seed the chat role in the model registry (boot migration handles it)',
    ],
  },
  {
    version: '0.6.6',
    codename: 'No Backdoor',
    date: 'April 2026',
    current: false,
    highlights: [
      'HITL backdoor DELETED — DISABLE_HITL_GATE env var is now a no-op',
      'DLP pre-LLM redaction stage — credentials masked before messages reach any model',
      'Tenant isolation — RLS + MilvusAuditGuard + DataAccessAuditService across every data path',
      'AWS MCP expanded 8 → 31 tools; GCP MCP expanded 28 → 46 tools',
      'Background-job state machine for long-running agent work',
      'All pods on amd64; SonarQube workflow split for per-service quality gates',
      'synth_execute exposed as first-class tool',
      '70 new vitest cases passing; UC-A13/A14/A17 live-verified with evidence',
    ],
  },
  {
    version: '0.6.5',
    codename: 'Lock Step',
    date: 'April 2026',
    current: false,
    highlights: [
      'Bob cloud-operations Phase-1 — Azure RG/VM/AKS/App-Gateway tools wired through MCP',
      'Azure MCP hardened — typed OBO token cache + retry + pagination',
      'Live-verified 19/19 UC battery with reproducible harness evidence',
    ],
  },
  {
    version: '0.6.3',
    codename: 'Light It Up',
    date: 'April 2026',
    current: false,
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
      'Unified version system across all components',
    ],
  },
  {
    version: '0.2.0',
    codename: 'Pioneer',
    date: 'January 2026',
    current: false,
    highlights: [
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
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-success) 12%, transparent)', color: 'var(--color-success)' }}
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
              {(release as { image?: string }).image && (
                <img
                  src={(release as { image: string }).image}
                  alt={`${release.codename} — v${release.version}`}
                  style={{
                    width: '100%',
                    maxHeight: 280,
                    objectFit: 'cover',
                    borderRadius: 8,
                    marginBottom: 16,
                    border: '1px solid var(--color-border)',
                  }}
                />
              )}
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
