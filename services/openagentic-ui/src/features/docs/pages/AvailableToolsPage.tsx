import React, { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';

/**
 * AvailableToolsPage — the MCP server catalog, SOURCE-READ from the generated
 * mcp-servers manifest (public/docs/generated/mcp-servers.json), which the docs
 * generator derives by scanning services/mcps/oap-*-mcp. The server list, the
 * per-server tool count, and the headline count all come from real source — no
 * hand-maintained server array (which had drifted to list MCPs that no longer
 * ship). The optional METADATA map below (category + identity color) is friendly
 * decoration matched by id; it never adds or removes a server.
 */

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
// FRIENDLY METADATA (decoration only — keyed by the oap-*-mcp dir id)
// ============================================================================
// theme-allow: per-MCP identity color scale (vendor brand hues — Azure #0078D4,
// AWS #FF9900, GCP #4285F4, k8s #326CE5, Prometheus #E6522C, …). Same carve-out
// as the vendor brand-colors + node-TYPE identity palettes; categorical identity
// values, not themeable surfaces. Any server NOT in this map renders with a
// neutral category + default color, so a newly-added MCP still appears.
interface ServerMeta {
  displayName: string;
  category: string;
  color: string;
}

const SERVER_META: Record<string, ServerMeta> = {
  'oap-azure-mcp': { displayName: 'Azure', category: 'Cloud', color: '#0078D4' },
  'oap-aws-mcp': { displayName: 'AWS', category: 'Cloud', color: '#FF9900' },
  'oap-gcp-mcp': { displayName: 'GCP', category: 'Cloud', color: '#4285F4' },
  'oap-kubernetes-mcp': { displayName: 'Kubernetes', category: 'Infrastructure', color: '#326CE5' },
  'oap-github-mcp': { displayName: 'GitHub', category: 'Development', color: '#6b7280' },
  'oap-prometheus-mcp': { displayName: 'Prometheus', category: 'Observability', color: '#E6522C' },
  'oap-loki-mcp': { displayName: 'Loki', category: 'Observability', color: '#F0A500' },
  'oap-alertmanager-mcp': { displayName: 'Alertmanager', category: 'Observability', color: '#E6522C' },
  'oap-incident-mcp': { displayName: 'Incident', category: 'Operations', color: '#ef4444' },
  'oap-runbook-mcp': { displayName: 'Runbook', category: 'Operations', color: '#22c55e' },
  'oap-web-mcp': { displayName: 'Web', category: 'Data', color: '#3b82f6' },
  'oap-knowledge-mcp': { displayName: 'Knowledge', category: 'Data', color: '#8b5cf6' },
  'oap-admin-mcp': { displayName: 'Admin', category: 'Platform', color: '#64748b' },
  'oap-agent-architect-mcp': { displayName: 'Agent Architect', category: 'Platform', color: '#a855f7' },
};

const DEFAULT_META: ServerMeta = {
  displayName: '',
  category: 'Other',
  color: 'var(--color-accent)',
};

/** Turn `oap-foo-bar-mcp` into a friendly `Foo Bar` fallback display name. */
function fallbackName(id: string): string {
  return id
    .replace(/^oap-/, '')
    .replace(/-mcp$/, '')
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

interface RenderServer {
  id: string;
  displayName: string;
  category: string;
  color: string;
  toolCount: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

const AvailableToolsPage: React.FC = () => {
  const { loadManifest, loadedManifests } = useDocsStore();

  useEffect(() => {
    if (!loadedManifests.has('mcp-servers')) {
      loadManifest('mcp-servers').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  const manifest = loadedManifests.get('mcp-servers');

  // Server list + tool counts SOURCE-READ from the generated manifest (one
  // section per oap-*-mcp dir). Friendly metadata is merged in by id.
  const servers = useMemo<RenderServer[]>(() => {
    if (!manifest) return [];
    return manifest.sections.map((s) => {
      const meta = SERVER_META[s.id] ?? DEFAULT_META;
      return {
        id: s.id,
        displayName: meta.displayName || fallbackName(s.id),
        category: meta.category,
        color: meta.color,
        toolCount: s.items.length,
      };
    });
  }, [manifest]);

  const serverCount = servers.length;
  const totalTools = useMemo(() => servers.reduce((n, s) => n + s.toolCount, 0), [servers]);

  // Categories in stable first-seen order, source-derived from the server list.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const s of servers) if (!seen.includes(s.category)) seen.push(s.category);
    return seen;
  }, [servers]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Available Tools
        </h1>
        <p className="text-lg leading-relaxed mb-6" style={{ color: 'var(--color-textSecondary)' }}>
          {serverCount > 0 ? (
            <>
              OpenAgentic ships {serverCount} built-in MCP servers exposing {totalTools} tools,
              spanning cloud providers, observability, development platforms, and internal
              services. Each server exposes tools the AI can use to answer questions and perform
              actions.
            </>
          ) : (
            <>Loading the MCP server catalog…</>
          )}
        </p>
      </motion.div>

      {/* Category Quick Nav */}
      {categories.length > 0 && (
        <motion.div
          custom={1}
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
          className="flex flex-wrap gap-2 mb-10"
        >
          {categories.map((cat) => {
            const count = servers.filter((s) => s.category === cat).length;
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
      )}

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
            {servers
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
                      {server.displayName}
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
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full ml-auto"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${server.color} 12%, transparent)`,
                        color: server.color,
                      }}
                    >
                      {server.toolCount} tool{server.toolCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                    The <span className="font-mono">{server.id}</span> MCP server exposes{' '}
                    {server.toolCount} tool{server.toolCount === 1 ? '' : 's'} to the agent. Open the
                    MCP Servers reference for the full per-tool schema.
                  </p>
                </div>
              ))}
          </div>
        </motion.section>
      ))}

      {/* OAT Section */}
      <motion.section custom={categories.length + 2} variants={sectionVariants} initial="hidden" animate="visible">
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
              { label: 'Dynamic synthesis', detail: 'OAT generates the tool implementation and runs it in the isolated synth-executor service' },
              { label: 'Schema validation', detail: 'Generated tools have typed inputs and outputs' },
              { label: 'Security review', detail: 'OAT tools pass DLP scanning before execution' },
              { label: 'Session-scoped', detail: 'Synthesized tools exist only for the current session' },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: 'var(--color-accent)' }} />
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
