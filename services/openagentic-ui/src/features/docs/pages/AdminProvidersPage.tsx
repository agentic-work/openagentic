/**
 * AdminProvidersPage - LLM Provider Management documentation.
 *
 * Documents provider types, card view, capability matrix, setup wizard,
 * embedding configuration, and API endpoints.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ReactFlowDiagram, DiagramDefinition } from '@/components/diagrams/ReactFlowDiagram';
import { DocsInfraIcon, DocsShieldIcon, DocsToolIcon } from '../components/DocsIcons';

// ============================================================================
// PROVIDER LIFECYCLE DIAGRAM
// ============================================================================

const providerLifecycleDiagram: DiagramDefinition = {
  type: 'process',
  title: 'Provider Lifecycle',
  description: 'From creation to active routing',
  layout: 'horizontal',
  nodes: [
    { id: 'create', label: 'Create Provider', description: 'Add credentials', shape: 'rounded', color: 'blue' },
    { id: 'configure', label: 'Configure', description: 'Models & limits', shape: 'rounded', color: 'purple' },
    { id: 'test', label: 'Test Connection', description: 'Validate endpoint', shape: 'diamond', color: 'orange' },
    { id: 'activate', label: 'Activate', description: 'Enable routing', shape: 'rounded', color: 'green' },
    { id: 'monitor', label: 'Monitor', description: 'Health & cost', shape: 'rounded', color: 'primary' },
  ],
  edges: [
    { source: 'create', target: 'configure' },
    { source: 'configure', target: 'test' },
    { source: 'test', target: 'activate', label: 'pass' },
    { source: 'activate', target: 'monitor', animated: true },
  ],
};

// ============================================================================
// DATA
// ============================================================================

const providerTypes = [
  {
    name: 'Azure OpenAI',
    description: 'Enterprise Azure-hosted deployments with Entra ID authentication. Supports private endpoints and VNet integration. Admins configure deployment names and map them to model capabilities.',
    auth: 'Entra ID (Managed Identity) or API Key',
  },
  {
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock service providing access to its catalog of foundation models. Authenticated via IAM roles or access keys. Supports cross-region inference profiles.',
    auth: 'IAM Role / Access Key + Secret',
  },
  {
    name: 'Google Vertex AI',
    description: 'Google Cloud Vertex AI platform with its available model catalog. Authenticated via service account JSON or workload identity. Supports regional endpoints.',
    auth: 'Service Account JSON / Workload Identity',
  },
  {
    name: 'Anthropic',
    description: 'Direct Anthropic API access to their model catalog. Standard API key authentication with configurable rate limits and spend budgets.',
    auth: 'API Key',
  },
  {
    name: 'OpenAI',
    description: 'Direct OpenAI API access to their model catalog. Supports organization-scoped API keys and project-level isolation.',
    auth: 'API Key (org-scoped)',
  },
  {
    name: 'Ollama',
    description: 'Self-hosted open-source models running locally or on dedicated infrastructure. No authentication required for local deployments. Admins configure the endpoint URL.',
    auth: 'None (local) / Bearer Token',
  },
  {
    name: 'Azure AI Foundry',
    description: 'Azure AI model catalog for serverless and managed compute deployments. Provides access to a broad set of open and proprietary models through a unified API surface.',
    auth: 'Entra ID / API Key',
  },
];

const providerCardFields = [
  { field: 'Status', description: 'Active, paused, or error state with color-coded indicator.' },
  { field: 'Health', description: 'Real-time health check result with latency measurement. Green (healthy), yellow (degraded), red (unreachable).' },
  { field: 'Request Count', description: 'Total requests routed to this provider in the selected time window.' },
  { field: 'Cost', description: 'Cumulative cost attributed to this provider based on token pricing rules.' },
];

const providerActions = [
  { action: 'Add', description: 'Opens the provider creation form. Select a provider type, enter credentials, configure endpoint details, and set initial model mappings.' },
  { action: 'Edit', description: 'Modify provider settings including credentials, rate limits, cost budgets, and model configurations. Changes take effect immediately for new requests.' },
  { action: 'Delete', description: 'Permanently removes a provider and its configuration. Requires confirmation. Active sessions using this provider will fall back to alternatives.' },
  { action: 'Test', description: 'Sends a lightweight health-check request to the provider endpoint. Returns latency, status code, and model availability confirmation.' },
  { action: 'Pause / Resume', description: 'Temporarily disables a provider without deleting its configuration. Paused providers are skipped by the model router. Useful during maintenance windows.' },
  { action: 'Rotate Credentials', description: 'Updates API keys or tokens with zero-downtime rotation. The system validates new credentials before deactivating old ones.' },
];

const setupWizardSteps = [
  { step: 'Select Provider Type', description: 'Choose from the supported provider types. The wizard adapts its form fields based on the selected type (e.g., deployment name for Azure, region for Bedrock).' },
  { step: 'Enter Credentials', description: 'Provide authentication details. Credentials are encrypted at rest using AES-256. The wizard validates credential format before proceeding.' },
  { step: 'Configure Models', description: 'Map the provider\'s available models to platform capabilities. Set which models handle chat, code, embedding, and vision tasks. Define fallback priorities.' },
  { step: 'Verify & Activate', description: 'Run an automated connectivity test. The wizard sends a test prompt and verifies response quality. On success, the provider is activated and available for routing.' },
];

const apiEndpoints = [
  { method: 'GET', path: '/admin/llm-providers', description: 'List all configured providers with status and health.' },
  { method: 'POST', path: '/admin/llm-providers', description: 'Create a new provider configuration.' },
  { method: 'GET', path: '/admin/llm-providers/:id', description: 'Get detailed provider configuration by ID.' },
  { method: 'PUT', path: '/admin/llm-providers/:id', description: 'Update an existing provider configuration.' },
  { method: 'DELETE', path: '/admin/llm-providers/:id', description: 'Remove a provider configuration.' },
  { method: 'POST', path: '/admin/llm-providers/:id/test', description: 'Test provider connectivity and health.' },
  { method: 'POST', path: '/admin/llm-providers/:id/pause', description: 'Pause a provider (disable routing).' },
  { method: 'POST', path: '/admin/llm-providers/:id/resume', description: 'Resume a paused provider.' },
  { method: 'POST', path: '/admin/llm-providers/:id/rotate', description: 'Rotate provider credentials.' },
  { method: 'GET', path: '/admin/llm-providers/capabilities', description: 'Get the capability matrix across all providers.' },
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

const AdminProvidersPage: React.FC = () => {
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
        <div style={{ marginBottom: '20px' }}><DocsInfraIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          LLM Provider Management
        </h1>
        <p style={{ ...bodyTextStyle, fontSize: '15px' }}>
          Administrators configure which LLM providers power the platform. Each provider offers
          its catalog of models, configured and mapped by admins to platform capabilities.
          Multiple providers can be active simultaneously for redundancy, cost optimization,
          and capability coverage.
        </p>
      </motion.div>

      {/* SCREENSHOT */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <img
          src="/docs/screenshots/admin-providers.png"
          alt="Provider management interface showing provider cards with health status"
          style={{ width: '100%', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: '0 4px 24px rgba(0,0,0,0.12)' }}
        />
      </motion.section>

      {/* PROVIDER TYPES */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Provider Types</p>
        <h2 style={sectionTitleStyle}>Supported Providers</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          The platform supports seven provider types. Each provider offers its own catalog
          of models that admins can configure and map to platform capabilities. Providers
          are not limited to specific models -- the available models depend on the provider's
          current offerings and the admin's configuration.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {providerTypes.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                <h4 style={labelStyle}>{p.name}</h4>
                <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-textMuted)', fontFamily: 'var(--font-mono)', background: 'var(--color-surfaceSecondary)', padding: '2px 8px', borderRadius: '4px' }}>
                  {p.auth}
                </span>
              </div>
              <p style={descTextStyle}>{p.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* CARD VIEW */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Interface</p>
        <h2 style={sectionTitleStyle}>Provider Card View</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Each configured provider is displayed as a card showing its current operational
          status. Cards are color-coded by health state and provide quick-access actions.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {providerCardFields.map((f) => (
            <div key={f.field} style={cardStyle}>
              <h4 style={labelStyle}>{f.field}</h4>
              <p style={descTextStyle}>{f.description}</p>
            </div>
          ))}
        </div>
      </motion.section>

      {/* CAPABILITY MATRIX */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Capabilities</p>
        <h2 style={sectionTitleStyle}>Capability Matrix View</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Toggle to the matrix view for a grid comparing all providers against platform
          capabilities. The matrix shows which providers support chat completion, code
          generation, embedding, vision, function calling, streaming, and JSON mode.
          Cells are color-coded: green for supported, gray for unsupported, yellow for
          partial support.
        </p>
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsToolIcon size={24} /></div>
            <div>
              <h4 style={labelStyle}>Dynamic Discovery</h4>
              <p style={descTextStyle}>
                Capabilities are auto-detected when a provider is added. The system probes the
                provider's API to determine supported features. Admins can override auto-detected
                capabilities if needed.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* ACTIONS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Operations</p>
        <h2 style={sectionTitleStyle}>Provider Actions</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {providerActions.map((a, i) => (
            <motion.div
              key={a.action}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + i * 0.04, duration: 0.3 }}
              style={cardStyle}
            >
              <h4 style={labelStyle}>{a.action}</h4>
              <p style={descTextStyle}>{a.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* SETUP WIZARD */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>First-Time Setup</p>
        <h2 style={sectionTitleStyle}>4-Step Setup Wizard</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          When deploying the platform for the first time or adding a new provider type, a
          guided wizard walks administrators through the configuration process.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {setupWizardSteps.map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 + i * 0.05, duration: 0.3 }}
              style={{ ...cardStyle, display: 'flex', gap: '16px', alignItems: 'flex-start' }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                background: 'var(--color-surfaceSecondary)', border: '1px solid var(--color-border)',
                fontSize: '13px', fontWeight: 700, color: 'var(--color-primary)',
              }}>
                {i + 1}
              </span>
              <div>
                <h4 style={labelStyle}>{s.step}</h4>
                <p style={descTextStyle}>{s.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.section>

      {/* PROVIDER LIFECYCLE DIAGRAM */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Lifecycle</p>
        <h2 style={sectionTitleStyle}>Provider Lifecycle</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          Providers follow a defined lifecycle from creation through active use and monitoring.
        </p>
        <ReactFlowDiagram
          diagram={providerLifecycleDiagram}
          height={300}
          interactive
          showControls
          showMiniMap={false}
        />
      </motion.section>

      {/* EMBEDDING PROVIDERS */}
      <motion.section style={sectionStyle} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>Embeddings</p>
        <h2 style={sectionTitleStyle}>Embedding Provider Configuration</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          In addition to chat and completion models, providers can be configured for
          embedding generation. Embeddings power the RAG pipeline, semantic search, and
          tool discovery. A dedicated embedding provider can be selected independently
          from the chat provider, allowing cost optimization (e.g., using a cheaper
          embedding model while routing chat to a more capable provider).
        </p>
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}><DocsShieldIcon size={24} /></div>
            <div>
              <h4 style={labelStyle}>Credential Isolation</h4>
              <p style={descTextStyle}>
                Embedding providers can use separate credentials from chat providers. This
                supports scenarios where embedding and completion workloads run on different
                Azure subscriptions or AWS accounts for cost isolation.
              </p>
            </div>
          </div>
        </div>
      </motion.section>

      {/* API ENDPOINTS */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.5 }}>
        <p style={sectionHeadingStyle}>API Reference</p>
        <h2 style={sectionTitleStyle}>Provider API Endpoints</h2>
        <p style={{ ...bodyTextStyle, marginBottom: '24px' }}>
          All provider management operations are available via the admin REST API.
          Requests require admin-level authentication.
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

export default AdminProvidersPage;
