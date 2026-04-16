import React from 'react';
import { motion } from 'framer-motion';

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const sectionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

// ============================================================================
// DATA
// ============================================================================

interface MCPServer {
  name: string;
  id: string;
  description: string;
  category: string;
  capabilities: string[];
  color: string;
}

const mcpServers: MCPServer[] = [
  {
    name: 'Azure',
    id: 'oap-azure-mcp',
    description: 'Azure resource management including VMs, App Services, networking, storage, and resource groups. Supports read and write operations with OBO token authentication.',
    category: 'Cloud',
    capabilities: ['Resource enumeration', 'VM management', 'App Service control', 'Network inspection', 'Storage management'],
    color: '#0078D4',
  },
  {
    name: 'AWS',
    id: 'oap-aws-mcp',
    description: 'AWS services including EC2 instance management, S3 bucket operations, cost analysis via Cost Explorer, and IAM identity inspection.',
    category: 'Cloud',
    capabilities: ['EC2 instances', 'S3 operations', 'Cost analysis', 'IAM identity', 'CloudWatch metrics'],
    color: '#FF9900',
  },
  {
    name: 'GCP',
    id: 'oap-gcp-mcp',
    description: 'Google Cloud Platform resource management including Compute Engine, Cloud Storage, BigQuery, and project-level operations.',
    category: 'Cloud',
    capabilities: ['Compute Engine', 'Cloud Storage', 'BigQuery', 'Project management', 'IAM policies'],
    color: '#4285F4',
  },
  {
    name: 'Azure Cost',
    id: 'oap-azure-cost-mcp',
    description: 'Specialized Azure cost analysis with budget tracking, anomaly detection, and cost optimization recommendations.',
    category: 'Cloud',
    capabilities: ['Cost breakdown', 'Budget tracking', 'Anomaly detection', 'Optimization tips', 'Forecast'],
    color: '#0078D4',
  },
  {
    name: 'Kubernetes',
    id: 'oap-kubernetes-mcp',
    description: 'Kubernetes cluster management covering pods, deployments, services, configmaps, secrets, and namespace operations.',
    category: 'Infrastructure',
    capabilities: ['Pod management', 'Deployment control', 'Service inspection', 'Log streaming', 'Resource scaling'],
    color: '#326CE5',
  },
  {
    name: 'GitHub',
    id: 'oap-github-mcp',
    description: 'GitHub integration for repositories, pull requests, issues, actions, and code search across configured organizations.',
    category: 'Development',
    capabilities: ['Repository listing', 'PR management', 'Issue tracking', 'Actions status', 'Code search'],
    color: '#6b7280',
  },
  {
    name: 'Prometheus',
    id: 'oap-prometheus-mcp',
    description: 'Prometheus metrics querying with PromQL support, instant queries, range queries, and metric metadata discovery.',
    category: 'Observability',
    capabilities: ['PromQL queries', 'Range queries', 'Metric metadata', 'Alert rules', 'Target status'],
    color: '#E6522C',
  },
  {
    name: 'Loki',
    id: 'oap-loki-mcp',
    description: 'Loki log querying with LogQL support for filtering, aggregating, and exploring application logs across services.',
    category: 'Observability',
    capabilities: ['LogQL queries', 'Log streaming', 'Label discovery', 'Log aggregation', 'Context lookup'],
    color: '#F0A500',
  },
  {
    name: 'Alertmanager',
    id: 'oap-alertmanager-mcp',
    description: 'Alertmanager integration for viewing, silencing, and managing active alerts and alert groups.',
    category: 'Observability',
    capabilities: ['Active alerts', 'Silence management', 'Alert groups', 'Receiver status', 'Inhibition rules'],
    color: '#E6522C',
  },
  {
    name: 'Incident',
    id: 'oap-incident-mcp',
    description: 'Incident lifecycle management including creation, status updates, timeline entries, and post-mortem generation.',
    category: 'Operations',
    capabilities: ['Create incidents', 'Update status', 'Timeline entries', 'Severity tracking', 'Post-mortem'],
    color: '#ef4444',
  },
  {
    name: 'Runbook',
    id: 'oap-runbook-mcp',
    description: 'Runbook discovery and execution for standardized operational procedures. Supports parameterized execution with audit logging.',
    category: 'Operations',
    capabilities: ['Runbook listing', 'Parameterized execution', 'Step tracking', 'Output capture', 'Audit logs'],
    color: '#22c55e',
  },
  {
    name: 'Web',
    id: 'oap-web-mcp',
    description: 'Web search and page scraping capabilities. Performs searches via configured providers and extracts structured content from web pages.',
    category: 'Data',
    capabilities: ['Web search', 'Page scraping', 'Content extraction', 'Screenshot capture', 'Link following'],
    color: '#3b82f6',
  },
  {
    name: 'Knowledge',
    id: 'oap-knowledge-mcp',
    description: 'Knowledge base retrieval using vector similarity search. Query the RAG system for relevant documents and context.',
    category: 'Data',
    capabilities: ['Semantic search', 'Document retrieval', 'Metadata filtering', 'Chunk navigation', 'Source citation'],
    color: '#8b5cf6',
  },
  {
    name: 'Admin',
    id: 'oap-admin-mcp',
    description: 'Platform administration tools for managing users, providers, system configuration, and operational health checks.',
    category: 'Platform',
    capabilities: ['User management', 'Provider config', 'System health', 'Feature flags', 'Cache management'],
    color: '#64748b',
  },
  {
    name: 'OpenAgentic',
    id: 'oap-openagentic-mcp',
    description: 'Code Mode tools for AI-assisted development. File operations, terminal commands, workspace management, and code analysis.',
    category: 'Development',
    capabilities: ['File read/write', 'Terminal execution', 'Workspace search', 'Diff generation', 'Code analysis'],
    color: '#22c55e',
  },
  {
    name: 'Agent Architect',
    id: 'oap-agent-architect-mcp',
    description: 'Meta-agent for designing and building new agents. Generates agent configurations, prompt templates, and tool selections based on requirements.',
    category: 'Platform',
    capabilities: ['Agent design', 'Prompt generation', 'Tool selection', 'Config generation', 'Testing'],
    color: '#a855f7',
  },
];

// Group by category
const categories = Array.from(new Set(mcpServers.map((s) => s.category)));

// ============================================================================
// COMPONENT
// ============================================================================

const AvailableToolsPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Available Tools
        </h1>
        <p className="text-lg leading-relaxed mb-6" style={{ color: 'var(--color-textSecondary)' }}>
          OpenAgentic connects to {mcpServers.length} MCP servers spanning cloud providers,
          observability tools, development platforms, and internal services. Each server exposes
          multiple tools that the AI can use to answer questions and perform actions.
        </p>
      </motion.div>

      {/* Category Quick Nav */}
      <motion.div
        custom={1}
        variants={sectionVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-wrap gap-2 mb-10"
      >
        {categories.map((cat) => {
          const count = mcpServers.filter((s) => s.category === cat).length;
          return (
            <a
              key={cat}
              href={`#cat-${cat.toLowerCase()}`}
              className="px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {cat} ({count})
            </a>
          );
        })}
      </motion.div>

      {/* Servers by Category */}
      {categories.map((category, catIdx) => (
        <motion.section
          key={category}
          id={`cat-${category.toLowerCase()}`}
          custom={catIdx + 2}
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
          className="mb-10"
        >
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
            {category}
          </h2>
          <div className="space-y-4">
            {mcpServers
              .filter((s) => s.category === category)
              .map((server) => (
                <div
                  key={server.id}
                  className="rounded-xl p-5"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: server.color }}
                    />
                    <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                      {server.name}
                    </h3>
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        color: 'var(--color-textMuted)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      {server.id}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-textSecondary)' }}>
                    {server.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {server.capabilities.map((cap) => (
                      <span
                        key={cap}
                        className="text-xs px-2 py-1 rounded-md"
                        style={{
                          backgroundColor: `${server.color}12`,
                          color: server.color,
                          border: `1px solid ${server.color}25`,
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </motion.section>
      ))}

      {/* OAT Section */}
      <motion.section custom={10} variants={sectionVariants} initial="hidden" animate="visible">
        <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          On-demand Agent Tooling (OAT)
        </h2>
        <div
          className="rounded-xl p-6"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--color-textSecondary)' }}>
            When no existing MCP tool matches the user's need, the OAT system can dynamically
            synthesize a new tool at runtime. OAT analyzes the request, generates a tool definition
            with input/output schemas, implements the tool logic, and registers it for the current
            session.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { label: 'Dynamic synthesis', detail: 'Tool code is generated and sandboxed at runtime' },
              { label: 'Schema validation', detail: 'Generated tools have typed inputs and outputs' },
              { label: 'Security review', detail: 'OAT tools pass DLP scanning before execution' },
              { label: 'Session-scoped', detail: 'Synthesized tools exist only for the current session' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: '#a855f7' }} />
                <div>
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {item.label}
                  </span>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-textMuted)' }}>
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.section>
    </div>
  );
};

export default AvailableToolsPage;
