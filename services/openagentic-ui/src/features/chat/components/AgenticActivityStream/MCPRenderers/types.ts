/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
