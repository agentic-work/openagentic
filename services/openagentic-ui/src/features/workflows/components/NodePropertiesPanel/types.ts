/**
 * Shared types for the decomposed Node Properties Panel.
 *
 * The panel's data-editing backbone (useNodeDataEditor) and every per-node-type
 * config group import their contracts from here so the seam between the thin
 * main shell and the extracted groups is explicit and `any`-free.
 */

import type { ChangeEvent, Dispatch, RefObject, SetStateAction } from 'react';
import type { NodeData } from '../../types/workflow.types';
import type { NodeSchemaSettingsResult } from '../../hooks/useNodeSchemaSettings';
import type { AgentRegistryEntry } from '../../services/agentRegistryApi';

// Minimal JSON-Schema shapes for the MCP tool argument builder. `default` is
// genuinely arbitrary (any JSON value), so it is typed `unknown` rather than `any`.
export interface JsonSchemaProp {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}
export interface JsonSchema {
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

/** Shape of an entry in the panel's `availableTools` prop. */
export interface ToolDescriptor {
  name: string;
  server: string;
  description?: string;
  inputSchema?: JsonSchema;
}

/**
 * The data-editing backbone returned by useNodeDataEditor. Carries the working
 * copy of the node's data plus the typed setters/readers the config groups use.
 * Every `field*` reader preserves the original `field || fallback` truthiness
 * semantics exactly.
 */
export interface NodeDataEditor {
  nodeData: NodeData;
  hasChanges: boolean;
  setHasChanges: Dispatch<SetStateAction<boolean>>;
  updateData: <K extends keyof NodeData>(key: K, value: NodeData[K]) => void;
  selectValue: <K extends keyof NodeData>(
    e: ChangeEvent<HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement>,
    key: K,
  ) => NodeData[K];
  asField: <K extends keyof NodeData>(value: string, key: K) => NodeData[K];
  fieldStr: (key: string, fallback?: string) => string;
  fieldNum: (key: string, fallback: number) => number;
  fieldBool: (key: string) => boolean;
  fieldRaw: (key: string) => unknown;
}

/**
 * The full prop bundle handed to every per-node-type config group. Groups
 * destructure the subset they need — the single shared shape keeps the router
 * wiring uniform (`<Group {...ctx} />`).
 */
export interface NodeConfigContext {
  editor: NodeDataEditor;
  isDark: boolean;
  availableModels: string[];
  availableTools: ToolDescriptor[];
  // Shared "Show Advanced" toggle — one instance across all groups, so it stays
  // open when switching between node types (matches the pre-split behaviour).
  showAdvanced: boolean;
  setShowAdvanced: Dispatch<SetStateAction<boolean>>;
  // Agent-node collapsible sections + the searchable agent dropdown.
  agentOptions: AgentRegistryEntry[];
  agentSearchQuery: string;
  setAgentSearchQuery: Dispatch<SetStateAction<string>>;
  agentDropdownOpen: boolean;
  setAgentDropdownOpen: Dispatch<SetStateAction<boolean>>;
  agentDropdownRef: RefObject<HTMLDivElement>;
  showPersona: boolean;
  setShowPersona: Dispatch<SetStateAction<boolean>>;
  showToolPolicy: boolean;
  setShowToolPolicy: Dispatch<SetStateAction<boolean>>;
  showAgentMemory: boolean;
  setShowAgentMemory: Dispatch<SetStateAction<boolean>>;
  // Schema-driven fallback renderer inputs.
  schemaSettings: NodeSchemaSettingsResult;
  nodeType: string;
}

/** Props for the universal "Advanced Configuration" section (own toggle state). */
export interface UniversalAdvancedConfigProps {
  editor: NodeDataEditor;
  isDark: boolean;
  showUniversalAdvanced: boolean;
  setShowUniversalAdvanced: Dispatch<SetStateAction<boolean>>;
}
