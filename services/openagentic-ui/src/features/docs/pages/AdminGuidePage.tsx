import React from 'react';

const AdminGuidePage: React.FC = () => (
  <div className="max-w-4xl mx-auto px-8 py-12">
    <h1 className="text-2xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
      Administration Guide
    </h1>
    <p className="text-sm leading-relaxed mb-8" style={{ color: 'var(--color-textSecondary)' }}>
      This section covers platform administration: configuring LLM providers, managing agents,
      tuning system settings, and monitoring platform health. Admin access is required.
    </p>
    <div className="space-y-6">
      {[
        { title: 'Provider Management', desc: 'Configure Azure OpenAI, AWS Bedrock, Google Vertex, Anthropic, OpenAI, and Ollama providers. Set up model routing, failover chains, and cost budgets.' },
        { title: 'Agent Configuration', desc: 'Create and tune agents in the Agent Management panel. Configure model selection, temperature, token limits, thinking behavior, tool whitelists, and delegation rules.' },
        { title: 'MCP Server Management', desc: 'Enable/disable MCP servers, configure access policies per Azure AD group, review tool call logs, and set execution modes (read-only vs full access).' },
        { title: 'Monitoring & Observability', desc: 'Access Prometheus metrics, Grafana dashboards (12 pre-built), Loki log queries, and the built-in pipeline log viewer. Monitor LLM performance, agent execution, and cost attribution.' },
        { title: 'Security Configuration', desc: 'Configure DLP rules (enable/disable categories), set rate limits per user, manage API keys, and review the immutable audit trail.' },
        { title: 'User Management', desc: 'View user activity, manage permissions, configure authentication providers (Azure AD, Google, local), and handle user lockouts.' },
      ].map((section) => (
        <div
          key={section.title}
          className="rounded-lg p-5"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>{section.title}</h3>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>{section.desc}</p>
        </div>
      ))}
    </div>
  </div>
);

export default AdminGuidePage;
