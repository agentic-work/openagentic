/**
 * Specialized MCP Renderer Registry
 *
 * Maps MCP tool names to specialized renderers.
 * Falls back to GenericMCPRenderer for unmatched tools.
 */

import React from 'react';
import type { MCPRendererProps, MCPRenderer } from './types';
import { WebSearchRenderer } from './WebSearchRenderer';
import { WebFetchRenderer } from './WebFetchRenderer';
import { SerenaFileRenderer } from './SerenaFileRenderer';
import { SerenaSearchRenderer } from './SerenaSearchRenderer';
import { GenericMCPRenderer } from './GenericMCPRenderer';
import { WorkflowRenderer } from './WorkflowRenderer';

// Export all types
export type { MCPRendererProps, MCPRenderer } from './types';

// Export individual renderers for direct use
export { WebSearchRenderer } from './WebSearchRenderer';
export { WebFetchRenderer } from './WebFetchRenderer';
export { SerenaFileRenderer } from './SerenaFileRenderer';
export { SerenaSearchRenderer } from './SerenaSearchRenderer';
export { GenericMCPRenderer } from './GenericMCPRenderer';
export { WorkflowRenderer } from './WorkflowRenderer';

/**
 * Tool name patterns mapped to their specialized renderers.
 * Patterns are matched in order - first match wins.
 *
 * Pattern syntax:
 * - Exact match: "web_search"
 * - Contains: "*search*"
 * - Prefix: "serena__*"
 */
const RENDERER_PATTERNS: Array<{ pattern: RegExp; renderer: MCPRenderer }> = [
  // Web search tools
  { pattern: /web.*search|search.*web|websearch/i, renderer: WebSearchRenderer },
  { pattern: /brave.*search/i, renderer: WebSearchRenderer },
  { pattern: /google.*search/i, renderer: WebSearchRenderer },

  // Web fetch tools
  { pattern: /web.*fetch|fetch.*url|webfetch/i, renderer: WebFetchRenderer },
  { pattern: /get.*page|fetch.*page/i, renderer: WebFetchRenderer },

  // Serena file operations
  { pattern: /serena.*read.*file|read_file/i, renderer: SerenaFileRenderer },
  { pattern: /serena.*list.*dir|list_dir/i, renderer: SerenaFileRenderer },
  { pattern: /serena.*find.*file|find_file/i, renderer: SerenaFileRenderer },
  { pattern: /serena.*get.*symbols.*overview|get_symbols_overview/i, renderer: SerenaFileRenderer },

  // Serena search operations
  { pattern: /serena.*search.*pattern|search_for_pattern/i, renderer: SerenaSearchRenderer },
  { pattern: /serena.*find.*symbol|find_symbol/i, renderer: SerenaSearchRenderer },
  { pattern: /serena.*find.*referencing|find_referencing/i, renderer: SerenaSearchRenderer },

  // Generic code search
  { pattern: /grep|rg|ripgrep/i, renderer: SerenaSearchRenderer },
  { pattern: /glob|find.*files/i, renderer: SerenaSearchRenderer },

  // Workflow tools
  { pattern: /^workflow_/i, renderer: WorkflowRenderer },
];

/**
 * Get the appropriate renderer for a given tool name.
 * Returns specialized renderer if matched, otherwise GenericMCPRenderer.
 */
export const getRendererForTool = (toolName: string): MCPRenderer => {
  for (const { pattern, renderer } of RENDERER_PATTERNS) {
    if (pattern.test(toolName)) {
      return renderer;
    }
  }
  return GenericMCPRenderer;
};

/**
 * MCPToolRenderer - Automatically selects and renders the appropriate
 * specialized renderer based on tool name.
 */
export const MCPToolRenderer: React.FC<MCPRendererProps> = (props) => {
  const Renderer = getRendererForTool(props.toolName);
  return <Renderer {...props} />;
};

export default MCPToolRenderer;
