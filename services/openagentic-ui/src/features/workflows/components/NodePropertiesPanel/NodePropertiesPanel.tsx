/**
 * Node Properties Panel
 * Professional right sidebar panel for configuring workflow nodes
 * Enhanced with better form controls, validation, and micro-interactions
 *
 * This is the thin composition shell: it wires the data-editing backbone
 * (useNodeDataEditor) to the per-node-type config groups (NodeConfigRouter),
 * the universal advanced section, and the schema-driven docs panel. The
 * heavy per-node-type rendering lives in ./groups/*. The public import path
 * remains ../NodePropertiesPanel (a re-export shim), so importers are unchanged.
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Save, Trash2, AlertCircle, Check } from '@/shared/icons';
import type { Node } from 'reactflow';
import type { NodeData } from '../../types/workflow.types';
// Schema-driven settings — exposes required-field markers, enum values, defaults
// from the /node-schemas registry. UI agent #3 consumes this for full UX.
import { useNodeSchemaSettings } from '../../hooks/useNodeSchemaSettings';
import { useNodeSchemas } from '../../hooks/useNodeSchemas';
import { NodeDocsPanel } from '../NodeDocsPanel';
import { fetchAgents as fetchAgentRegistry } from '../../services/agentRegistryApi';
import type { AgentRegistryEntry } from '../../services/agentRegistryApi';
import { useNodeDataEditor } from './useNodeDataEditor';
import { NodeConfigRouter } from './NodeConfigRouter';
import { UniversalAdvancedConfig } from './groups/UniversalAdvancedConfig';
import type { JsonSchema, NodeConfigContext } from './types';

interface NodePropertiesPanelProps {
  node: Node<NodeData> | null;
  onClose: () => void;
  onUpdate: (nodeId: string, data: Partial<NodeData>) => void;
  onDelete: (nodeId: string) => void;
  availableModels?: string[];
  availableTools?: Array<{ name: string; server: string; description?: string; inputSchema?: JsonSchema }>;
  theme?: 'light' | 'dark';
}

export const NodePropertiesPanel: React.FC<NodePropertiesPanelProps> = ({
  node,
  onClose,
  onUpdate,
  onDelete,
  availableModels = [],
  availableTools = [],
  theme = 'dark',
}) => {
  // Data-editing backbone: working copy of nodeData + dirty flag + typed
  // setters/readers. Preserves the original `field || fallback` semantics.
  const editor = useNodeDataEditor(node);
  const { nodeData, hasChanges, setHasChanges, updateData } = editor;

  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showUniversalAdvanced, setShowUniversalAdvanced] = useState(false);

  // Schema-driven settings — available for downstream consumers and future
  // required-field marker rendering. Falls back gracefully for legacy node types.
  const schemaSettings = useNodeSchemaSettings(node?.type as string ?? '');
  // Full schema object (for the Docs panel) keyed by the same node type.
  const { byType: schemasByType } = useNodeSchemas();
  const fullSchema = schemasByType[node?.type as string ?? ''] ?? null;

  // Agent ID dropdown state (must be at component level for hooks rules)
  const [agentOptions, setAgentOptions] = useState<AgentRegistryEntry[]>([]);
  const [agentSearchQuery, setAgentSearchQuery] = useState('');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  // Agent-Proxy node collapsible sections (shared across the agent groups).
  // Hoisted here so these hooks run before any early return.
  const [showPersona, setShowPersona] = useState(false);
  const [showToolPolicy, setShowToolPolicy] = useState(false);
  const [showAgentMemory, setShowAgentMemory] = useState(false);

  // Fetch agents when panel opens for agent node types
  useEffect(() => {
    if (
      node?.type === 'agent_single' ||
      node?.type === 'agent_supervisor' ||
      node?.type === 'agent_pool' ||
      node?.type === 'multi_agent'
    ) {
      fetchAgentRegistry().then(setAgentOptions);
    }
  }, [node?.type]);

  // Close agent dropdown on outside click
  useEffect(() => {
    if (!agentDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentDropdownRef.current && !agentDropdownRef.current.contains(e.target as HTMLElement)) {
        setAgentDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentDropdownOpen]);

  if (!node) return null;

  const isDark = theme === 'dark';

  const handleSave = () => {
    onUpdate(node.id, nodeData);
    setHasChanges(false);
    setShowSaveConfirmation(true);
    setTimeout(() => setShowSaveConfirmation(false), 2000);
  };

  const handleDelete = () => {
    if (confirm(`Delete node "${nodeData.label}"?`)) {
      onDelete(node.id);
      onClose();
    }
  };

  // Prop bundle shared by every per-node-type config group.
  const configCtx: NodeConfigContext = {
    editor,
    isDark,
    availableModels,
    availableTools,
    showAdvanced,
    setShowAdvanced,
    agentOptions,
    agentSearchQuery,
    setAgentSearchQuery,
    agentDropdownOpen,
    setAgentDropdownOpen,
    agentDropdownRef,
    showPersona,
    setShowPersona,
    showToolPolicy,
    setShowToolPolicy,
    showAgentMemory,
    setShowAgentMemory,
    schemaSettings,
    nodeType: node.type as string,
  };

  return (
    <motion.div
      initial={{ x: 320, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 320, opacity: 0 }}
      // Terminal Glass: the node inspector reads as a frosted slab over the
      // canvas/aurora — translucent surface + backdrop blur + soft left edge.
      // glass-surface supplies the frosted bg/blur/border from the ONE SOT; we
      // flatten its radius + drop the non-edge borders so it sits flush as a
      // right-side drawer with only its left hairline showing.
      className="glass-surface w-80 overflow-y-auto"
      data-has-schema={schemaSettings.hasSchema ? 'true' : 'false'}
      data-node-type={node?.type}
      style={{
        borderRadius: 0,
        borderTopWidth: 0,
        borderRightWidth: 0,
        borderBottomWidth: 0,
      }}
    >
      <div className="glass-surface-subtle sticky top-0 z-10 p-4 border-b backdrop-blur-sm"
        style={{ borderColor: 'var(--glass-border)' }}
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
            Node Properties
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="glass-surface-subtle text-xs px-2 py-1 rounded"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {node.type?.replace(/_/g, ' ').toUpperCase()}
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Validation Errors Banner */}
        {node.data?.validationErrors && (node.data.validationErrors as Array<{ field?: string; message: string }>).length > 0 && (
          <div style={{
            background: 'color-mix(in srgb, var(--color-warning) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)',
            borderRadius: 8,
            padding: '8px 10px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-warning)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertCircle style={{ width: 12, height: 12 }} />
              {(node.data.validationErrors as Array<{ field?: string; message: string }>).length} validation {(node.data.validationErrors as Array<{ field?: string; message: string }>).length === 1 ? 'issue' : 'issues'}
            </div>
            {(node.data.validationErrors as Array<{ field?: string; message: string }>).map((err: { field?: string; message: string }, i: number) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--color-warning)', lineHeight: 1.5, paddingLeft: 16 }}>
                {err.field ? `${err.field}: ` : ''}{err.message}
              </div>
            ))}
          </div>
        )}

        {/* Error banner for failed nodes */}
        {nodeData?.executionState === 'failed' && nodeData?.executionError && (
          <div style={{
            margin: '0 0 16px 0', padding: '10px 12px', borderRadius: 8,
            background: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 30%, transparent)',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-error)', marginBottom: 4 }}>
              Execution Error
            </div>
            <div style={{
              fontSize: 11, color: 'var(--color-text)', lineHeight: 1.5,
              maxHeight: 80, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              background: 'color-mix(in srgb, var(--glass-page-bg) 55%, transparent)', padding: '6px 8px', borderRadius: 4,
            }}>
              {String(nodeData.executionError).substring(0, 500)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('fixNodeWithAI', {
                    detail: {
                      nodeId: node?.id,
                      nodeLabel: nodeData?.label || node?.id,
                      nodeType: node?.type,
                      error: nodeData.executionError,
                      config: JSON.stringify(nodeData, null, 2).substring(0, 500),
                    }
                  }));
                }}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: 'linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 60%, var(--color-info)))', color: 'var(--color-on-accent)',
                  border: 'none', cursor: 'pointer',
                }}
              >
                Fix with AI
              </button>
              <button
                className="glass-btn glass-btn-secondary"
                onClick={() => {
                  if (node?.id) {
                    onUpdate(node.id, { executionState: undefined, executionError: undefined });
                  }
                }}
                style={{ padding: '4px 12px', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}
              >
                Clear Error
              </button>
            </div>
          </div>
        )}

        {/* Node Label */}
        <div>
          <label htmlFor="node-label" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Label
          </label>
          <input
            id="node-label"
            type="text"
            value={nodeData.label || ''}
            onChange={(e) => updateData('label', e.target.value)}
            className="glass-field px-3 py-2 focus:outline-none"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Display name shown on the canvas. Use a short, descriptive name.
          </p>
        </div>

        {/* Node Description */}
        <div>
          <label htmlFor="node-description" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Description (optional)
          </label>
          <textarea
            id="node-description"
            value={nodeData.description || ''}
            onChange={(e) => updateData('description', e.target.value)}
            rows={2}
            className="glass-field px-3 py-2 focus:outline-none"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Optional notes about this node's purpose. Shown as a tooltip on the canvas.
          </p>
        </div>

        {/* Node-specific config */}
        <div className="pt-4 border-t"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h4 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-secondary)' }}>
            Configuration
          </h4>
          <NodeConfigRouter node={node} ctx={configCtx} />
        </div>

        {/* Schema-driven docs panel — shows ai.shortDescription, whenToUse,
         * I/O ports, and outputAssertions for any node whose type is
         * registered in the schema-driven plugin registry. Pulled from the
         * same useNodeSchemas hook used by the schema-driven settings
         * fallback above; renders nothing when the type isn't registered. */}
        {schemaSettings.hasSchema && (
          <div
            className="border-t pt-4"
            style={{ borderColor: 'var(--color-border)' }}
            data-testid="node-docs-section"
          >
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Docs
            </h4>
            <NodeDocsPanel schema={fullSchema} />
          </div>
        )}

        {/* Universal Advanced Configuration */}
        <UniversalAdvancedConfig
          editor={editor}
          isDark={isDark}
          showUniversalAdvanced={showUniversalAdvanced}
          setShowUniversalAdvanced={setShowUniversalAdvanced}
        />

        {/* Action buttons */}
        <div className="pt-4 border-t space-y-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <motion.button
            whileHover={hasChanges ? { scale: 1.02 } : {}}
            whileTap={hasChanges ? { scale: 0.98 } : {}}
            onClick={handleSave}
            disabled={!hasChanges}
            className={`
              w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm
              transition-all duration-200
              ${showSaveConfirmation
                ? 'bg-success text-text'
                : hasChanges
                ? 'bg-accent-primary text-text hover:bg-accent-primary/90 shadow-lg shadow-accent-primary/20'
                : 'cursor-not-allowed opacity-50'
              }
            `}
            style={!hasChanges && !showSaveConfirmation ? {
              backgroundColor: 'var(--ctl-surf)',
              color: 'var(--color-text-tertiary)',
            } : undefined}
          >
            {showSaveConfirmation ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {hasChanges ? 'Save Changes' : 'No Changes'}
              </>
            )}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleDelete}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all duration-200 bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)] text-error hover:bg-[color-mix(in_srgb,var(--color-error)_20%,transparent)] border border-[color-mix(in_srgb,var(--color-error)_30%,transparent)]"
          >
            <Trash2 className="w-4 h-4" />
            Delete Node
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};
