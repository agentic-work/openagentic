// theme-allow: workflow node-CATEGORY identity color scale (the node-TYPE palette
// carve-out shared with the workflow canvas) — categorical identity, not themeable surfaces.
import React, { useEffect, useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';

/**
 * NodeTypesPage — the Flow canvas node-type reference, SOURCE-READ from the
 * generated node-types manifest (public/docs/generated/node-types.json), which
 * the docs generator derives from the workflow-engine node registry (one item
 * per registered node, minus the removed-node denylist). The category list, the
 * per-node descriptions, and the headline count all come from real source — no
 * hand-maintained node array (which had drifted to a stale "34 nodes / 7
 * categories" and even listed a removed `code` node). The CATEGORY_COLOR map
 * below is friendly decoration keyed by the source category id.
 */

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.06, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
};

// Category identity colors (decoration only — keyed by the source category id).
const CATEGORY_COLOR: Record<string, string> = {
  trigger: '#22c55e',
  ai: '#8b5cf6',
  agent: '#a855f7',
  logic: '#3b82f6',
  control: '#f97316',
  data: '#06b6d4',
  action: '#3b82f6',
  integration: '#22c55e',
  annotation: '#94a3b8',
};

const DEFAULT_CATEGORY_COLOR = 'var(--color-accent)';

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface RenderNode {
  id: string;
  name: string;
  description: string;
  nodeType: string;
}

interface RenderCategory {
  id: string;
  name: string;
  color: string;
  nodes: RenderNode[];
}

// ============================================================================
// COMPONENT
// ============================================================================

const NodeTypesPage: React.FC = () => {
  const { loadManifest, loadedManifests } = useDocsStore();

  useEffect(() => {
    if (!loadedManifests.has('node-types')) {
      loadManifest('node-types').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  const manifest = loadedManifests.get('node-types');

  // Categories + nodes SOURCE-READ from the generated manifest (one section per
  // node category, one item per registered node type).
  const categories = useMemo<RenderCategory[]>(() => {
    if (!manifest) return [];
    return manifest.sections.map((s) => ({
      id: s.id,
      name: s.title || titleCase(s.id),
      color: CATEGORY_COLOR[s.id] ?? DEFAULT_CATEGORY_COLOR,
      nodes: s.items.map((it) => ({
        id: it.id,
        name: it.name,
        description: it.description ?? '',
        nodeType: String(it.properties?.nodeType ?? it.id),
      })),
    }));
  }, [manifest]);

  const totalNodes = useMemo(
    () => categories.reduce((sum, c) => sum + c.nodes.length, 0),
    [categories],
  );

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <motion.div custom={0} variants={sectionVariants} initial="hidden" animate="visible">
        <h1 className="text-3xl font-bold mb-3" style={{ color: 'var(--color-text)' }}>
          Node Types Reference
        </h1>
        <p className="text-lg leading-relaxed mb-10" style={{ color: 'var(--color-textSecondary)' }}>
          {totalNodes > 0 ? (
            <>
              The workflow engine provides {totalNodes} node types across {categories.length}{' '}
              categories. Each node has a typed schema that defines how data flows through your
              workflow.
            </>
          ) : (
            <>Loading the workflow node registry…</>
          )}
        </p>
      </motion.div>

      {/* Category Index */}
      {categories.length > 0 && (
        <motion.div
          custom={1}
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
          className="rounded-xl p-5 mb-10 flex flex-wrap gap-3"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          {categories.map((cat) => (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{
                backgroundColor: `color-mix(in srgb, ${cat.color} 15%, transparent)`,
                color: cat.color,
                border: `1px solid color-mix(in srgb, ${cat.color} 30%, transparent)`,
              }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
              {cat.name}
              <span className="text-xs opacity-60">{cat.nodes.length}</span>
            </a>
          ))}
        </motion.div>
      )}

      {/* Node Categories */}
      {categories.map((category, catIdx) => (
        <motion.section
          key={category.id}
          id={`cat-${category.id}`}
          custom={catIdx + 2}
          variants={sectionVariants}
          initial="hidden"
          animate="visible"
          className="mb-10"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: category.color }} />
            <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>
              {category.name}
            </h2>
            <span className="text-sm" style={{ color: 'var(--color-textMuted)' }}>
              {category.nodes.length} node{category.nodes.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="space-y-3">
            {category.nodes.map((node) => (
              <div
                key={node.id}
                className="rounded-lg p-4"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {node.name}
                  </h3>
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor: 'var(--color-background)',
                      color: 'var(--color-textMuted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {node.nodeType}
                  </span>
                </div>
                {node.description && (
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--color-textSecondary)' }}>
                    {node.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </motion.section>
      ))}
    </div>
  );
};

export default NodeTypesPage;
