import React from 'react';
import { motion } from 'framer-motion';
import { DocsCodeIcon } from '../components/DocsIcons';

// ============================================================================
// DATA
// ============================================================================

interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  description: string;
}

interface EndpointGroup {
  name: string;
  description: string;
  endpoints: Endpoint[];
}

const endpointGroups: EndpointGroup[] = [
  {
    name: 'Chat',
    description: 'Conversational AI with streaming responses, session management, and model selection.',
    endpoints: [
      { method: 'POST', path: '/api/chat/stream', description: 'Send a message and stream the AI response via SSE' },
      { method: 'GET', path: '/api/chat/sessions', description: 'List all chat sessions for the authenticated user' },
      { method: 'POST', path: '/api/chat/sessions', description: 'Create a new chat session with optional configuration' },
    ],
  },
  {
    name: 'Models',
    description: 'Query available LLM providers and models configured for the platform.',
    endpoints: [
      { method: 'GET', path: '/api/chat/models', description: 'List all available models with provider, tier, and capability metadata' },
    ],
  },
  {
    name: 'MCP',
    description: 'Model Context Protocol servers for tool execution and resource access.',
    endpoints: [
      { method: 'POST', path: '/api/mcp/*', description: 'Proxy requests to MCP servers for tool invocation' },
      { method: 'GET', path: '/api/v1/mcp/*', description: 'Versioned MCP endpoints for server discovery and capability listing' },
    ],
  },
  {
    name: 'Admin',
    description: 'Platform administration: providers, users, organizations, and system configuration.',
    endpoints: [
      { method: 'GET', path: '/api/admin/*', description: 'Read admin resources (providers, users, orgs, configs)' },
      { method: 'POST', path: '/api/admin/*', description: 'Create admin resources (new provider, user, org)' },
      { method: 'PUT', path: '/api/admin/*', description: 'Update admin resources (edit provider config, user roles)' },
      { method: 'DELETE', path: '/api/admin/*', description: 'Remove admin resources (deactivate provider, remove user)' },
    ],
  },
  {
    name: 'Workflows',
    description: 'Visual workflow builder: create, execute, schedule, and monitor automated pipelines.',
    endpoints: [
      { method: 'GET', path: '/api/workflows/*', description: 'List workflows, get execution status and history' },
      { method: 'POST', path: '/api/workflows/*', description: 'Create workflows, trigger execution, schedule runs' },
    ],
  },
  {
    name: 'Agents',
    description: 'Agent registry: list types, view configurations, and manage custom agents.',
    endpoints: [
      { method: 'GET', path: '/api/agents/*', description: 'List agent types and their configurations' },
      { method: 'POST', path: '/api/agents/*', description: 'Create or invoke custom agent configurations' },
    ],
  },
  {
    name: 'Health',
    description: 'System health checks for monitoring, load balancers, and diagnostics.',
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'Basic liveness check (returns 200 OK)' },
      { method: 'GET', path: '/api/health/comprehensive', description: 'Detailed health: database, Redis, Milvus, MCP servers, LLM providers' },
    ],
  },
];

const methodColors: Record<string, { text: string; bg: string }> = {
  GET: { text: 'var(--color-info)', bg: 'color-mix(in srgb, var(--color-info) 12%, transparent)' },
  POST: { text: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)' },
  PUT: { text: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' },
  DELETE: { text: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)' },
};

// ============================================================================
// STYLES
// ============================================================================

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--color-textMuted)',
  marginBottom: '8px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  color: 'var(--color-text)',
  marginBottom: '16px',
  lineHeight: 1.2,
};

const proseStyle: React.CSSProperties = {
  fontSize: '15px',
  color: 'var(--color-textSecondary)',
  lineHeight: 1.7,
  maxWidth: '680px',
};

// ============================================================================
// COMPONENT
// ============================================================================

const ApiReferencePage: React.FC = () => (
  <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
    {/* HEADER */}
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ marginBottom: '40px' }}
    >
      <div style={{ marginBottom: '20px' }}>
        <DocsCodeIcon size={40} />
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
        API Reference
      </h1>
      <p style={proseStyle}>
        OpenAgentic exposes a RESTful API for chat completions, conversation management,
        workflow execution, MCP tool access, and administration. Explore all endpoints
        interactively with the Swagger UI or browse the endpoint groups below.
      </p>
    </motion.div>

    {/* AUTH NOTE */}
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1, duration: 0.4 }}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '10px',
        padding: '16px 20px',
        marginBottom: '32px',
        display: 'flex',
        gap: '12px',
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--color-primary)',
          marginTop: '7px',
        }}
      />
      <p style={{ fontSize: '13px', color: 'var(--color-textSecondary)', lineHeight: 1.6 }}>
        All API endpoints require authentication. Use a Bearer token from your session
        or generate an API key in Settings. The Swagger UI will use your current session
        token automatically when you are signed in.
      </p>
    </motion.div>

    {/* SWAGGER LINK */}
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.4 }}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '14px',
        padding: '32px',
        marginBottom: '48px',
        textAlign: 'center',
      }}
    >
      <h2
        style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--color-text)',
          marginBottom: '12px',
        }}
      >
        Interactive API Explorer
      </h2>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--color-textSecondary)',
          lineHeight: 1.6,
          marginBottom: '20px',
          maxWidth: '480px',
          margin: '0 auto 20px',
        }}
      >
        The Swagger UI provides an interactive explorer where you can view request/response
        schemas, try API calls, and inspect authentication requirements.
      </p>
      <button
        onClick={() => window.open('/api/swagger', '_blank')}
        style={{
          display: 'inline-block',
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--color-textOnPrimary, var(--brand-on-accent))',
          background: 'var(--color-primary)',
          padding: '10px 28px',
          borderRadius: '8px',
          border: 'none',
          cursor: 'pointer',
          transition: 'opacity 0.2s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '0.85';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.opacity = '1';
        }}
      >
        Open Swagger UI
      </button>
      <div
        style={{
          marginTop: '12px',
          fontSize: '12px',
          color: 'var(--color-textMuted)',
        }}
      >
        Opens /api/swagger in a new browser tab
      </div>
    </motion.div>

    {/* ENDPOINT GROUPS */}
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.2, duration: 0.5 }}
    >
      <p style={sectionHeadingStyle}>Endpoints</p>
      <h2 style={sectionTitleStyle}>API Endpoint Groups</h2>
      <p style={{ ...proseStyle, marginBottom: '32px' }}>
        The API is organized into logical groups. Each group serves a specific
        domain of platform functionality.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {endpointGroups.map((group, gi) => (
          <motion.div
            key={group.name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + gi * 0.05, duration: 0.35 }}
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '14px',
              overflow: 'hidden',
            }}
          >
            {/* Group header */}
            <div
              style={{
                padding: '20px 24px 12px',
              }}
            >
              <h3
                style={{
                  fontSize: '17px',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginBottom: '4px',
                }}
              >
                {group.name}
              </h3>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--color-textSecondary)',
                  lineHeight: 1.5,
                }}
              >
                {group.description}
              </p>
            </div>

            {/* Endpoints */}
            <div style={{ padding: '0 12px 12px' }}>
              {group.endpoints.map((ep, ei) => {
                const colors = methodColors[ep.method];
                return (
                  <div
                    key={`${ep.method}-${ep.path}-${ei}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background:
                        ei % 2 === 0
                          ? 'var(--color-surfaceSecondary)'
                          : 'transparent',
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: '10px',
                        fontWeight: 700,
                        color: colors.text,
                        background: colors.bg,
                        padding: '3px 7px',
                        borderRadius: '4px',
                        letterSpacing: '0.04em',
                        minWidth: '50px',
                        textAlign: 'center',
                        marginTop: '1px',
                      }}
                    >
                      {ep.method}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <code
                        style={{
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono, monospace)',
                          color: 'var(--color-text)',
                          fontWeight: 500,
                          wordBreak: 'break-all',
                        }}
                      >
                        {ep.path}
                      </code>
                      <p
                        style={{
                          fontSize: '12px',
                          color: 'var(--color-textMuted)',
                          lineHeight: 1.4,
                          marginTop: '2px',
                        }}
                      >
                        {ep.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  </div>
);

export default ApiReferencePage;
