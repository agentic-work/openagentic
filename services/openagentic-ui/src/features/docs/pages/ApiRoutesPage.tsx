import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';
import { DocsCodeIcon } from '../components/DocsIcons';

const routeGroups = [
  {
    group: 'Chat',
    routes: [
      { method: 'POST', path: '/api/chat/completions', desc: 'Send a message and stream the AI response' },
      { method: 'POST', path: '/api/chat/completions/cancel', desc: 'Cancel an in-progress completion' },
      { method: 'GET', path: '/api/chat/models', desc: 'List available models and their capabilities' },
    ],
  },
  {
    group: 'Conversations',
    routes: [
      { method: 'GET', path: '/api/conversations', desc: 'List conversations for the current user' },
      { method: 'GET', path: '/api/conversations/:id', desc: 'Get a conversation with its messages' },
      { method: 'DELETE', path: '/api/conversations/:id', desc: 'Delete a conversation' },
      { method: 'PATCH', path: '/api/conversations/:id', desc: 'Update conversation title or metadata' },
    ],
  },
  {
    group: 'Flows',
    routes: [
      { method: 'GET', path: '/api/flows', desc: 'List saved workflows' },
      { method: 'POST', path: '/api/flows', desc: 'Create a new workflow' },
      { method: 'POST', path: '/api/flows/:id/execute', desc: 'Trigger a workflow execution' },
      { method: 'GET', path: '/api/flows/:id/runs', desc: 'List execution history for a workflow' },
    ],
  },
  {
    group: 'Agents',
    routes: [
      { method: 'GET', path: '/api/agents', desc: 'List available agent types' },
      { method: 'GET', path: '/api/agents/:id', desc: 'Get agent configuration details' },
    ],
  },
  {
    group: 'MCP',
    routes: [
      { method: 'GET', path: '/api/mcp/servers', desc: 'List MCP servers and their tools' },
      { method: 'POST', path: '/api/mcp/invoke', desc: 'Directly invoke an MCP tool' },
    ],
  },
  {
    group: 'Admin',
    routes: [
      { method: 'GET', path: '/api/admin/providers', desc: 'List LLM provider configurations' },
      { method: 'PUT', path: '/api/admin/providers/:id', desc: 'Update a provider configuration' },
      { method: 'GET', path: '/api/admin/users', desc: 'List platform users' },
      { method: 'GET', path: '/api/admin/audit', desc: 'Query the audit trail' },
      { method: 'GET', path: '/api/admin/settings', desc: 'Get system settings' },
      { method: 'PUT', path: '/api/admin/settings', desc: 'Update system settings' },
    ],
  },
];

const methodColors: Record<string, { color: string; bg: string }> = {
  GET: { color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  POST: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  PUT: { color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  PATCH: { color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  DELETE: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const ApiRoutesPage: React.FC = () => {
  const { loadManifest, loadedManifests } = useDocsStore();

  useEffect(() => {
    if (!loadedManifests.has('http-routes')) {
      loadManifest('http-routes').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
        <div style={{ marginBottom: '20px' }}><DocsCodeIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          API Routes
        </h1>
        <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
          A quick reference of all HTTP endpoints exposed by the OpenAgentic API. For
          interactive testing and full request/response schemas, use the Swagger UI page.
        </p>
      </motion.div>

      {routeGroups.map((group, gi) => (
        <motion.section
          key={group.group}
          style={{ marginBottom: '40px' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 + gi * 0.05, duration: 0.4 }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>{group.group}</h2>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden' }}>
            {group.routes.map((route, i) => (
              <div
                key={`${route.method}-${route.path}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 20px',
                  borderBottom: i < group.routes.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    letterSpacing: '0.04em',
                    minWidth: '52px',
                    textAlign: 'center',
                    color: methodColors[route.method]?.color ?? 'var(--color-text)',
                    background: methodColors[route.method]?.bg ?? 'var(--color-surfaceSecondary)',
                  }}
                >
                  {route.method}
                </span>
                <code style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)', fontWeight: 500, minWidth: '280px' }}>
                  {route.path}
                </code>
                <span style={{ fontSize: '12px', color: 'var(--color-textMuted)' }}>{route.desc}</span>
              </div>
            ))}
          </div>
        </motion.section>
      ))}
    </div>
  );
};

export default ApiRoutesPage;
