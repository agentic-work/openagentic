/**
 * Specialized MCP Renderer Types
 *
 * Types for creating specialized renderers for different MCP tools.
 * Each renderer can display tool-specific UI instead of generic JSON.
 */

import type { ReactNode } from 'react';

// Base props that all MCP renderers receive
export interface MCPRendererProps {
  toolName: string;
  toolId: string;
  input: unknown;
  output?: unknown;
  status: 'calling' | 'success' | 'error';
  isComplete: boolean;
  duration?: number;
  theme?: 'light' | 'dark';
}

// Web search result structure
export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  favicon?: string;
}

// Web search output structure
export interface WebSearchOutput {
  results?: WebSearchResult[];
  query?: string;
  totalResults?: number;
}

// File read output structure
export interface FileReadOutput {
  content?: string;
  path?: string;
  lines?: number;
  language?: string;
}

// Search/grep output structure
export interface SearchOutput {
  matches?: Array<{
    file: string;
    line?: number;
    content?: string;
  }>;
  totalMatches?: number;
  pattern?: string;
}

// Symbol find output structure
export interface SymbolOutput {
  symbols?: Array<{
    name: string;
    kind?: string;
    location?: string;
    line?: number;
  }>;
  count?: number;
}

// Web fetch output structure
export interface WebFetchOutput {
  title?: string;
  content?: string;
  url?: string;
  wordCount?: number;
  sections?: string[];
}

// Registry type for specialized renderers
export type MCPRenderer = React.ComponentType<MCPRendererProps>;

export interface MCPRendererRegistry {
  [toolPattern: string]: MCPRenderer;
}
