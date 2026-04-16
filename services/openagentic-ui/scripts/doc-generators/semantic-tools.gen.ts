/**
 * Semantic Tools Documentation Generator
 *
 * Parses mcp.stage.ts to extract:
 * - MAX_TOOLS limit and tool selection constants
 * - Search tiers (pgvector primary, Milvus fallback, Redis emergency)
 * - Intent routing (ACTION vs CONTENT servers)
 * - Score-gap cutoff and server-first routing logic
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateSemanticTools(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'routes', 'chat', 'pipeline', 'mcp.stage.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Tool Selection Constants ---
  const constantItems: DocItem[] = [];

  // MAX_TOOLS
  const maxToolsMatch = content.match(/const MAX_TOOLS\s*=\s*(\d+);\s*(?:\/\/\s*(.+))?/);
  if (maxToolsMatch) {
    constantItems.push({
      id: 'max-tools',
      name: 'MAX_TOOLS',
      description: maxToolsMatch[2]?.trim() || `Hard ceiling: never send more than ${maxToolsMatch[1]} tools to LLM`,
      type: 'constant',
      properties: { value: parseInt(maxToolsMatch[1], 10) },
      sourceLine: getLineNumber(content, maxToolsMatch.index!),
      sourceFile: sourceFiles[0],
    });
  }

  // RETRIEVAL_K and other constants
  const constPattern = /const (\w+_?K?)\s*=\s*(?:hasServerFilter\s*\?\s*(\d+)\s*:\s*(\d+)|(\d+));\s*(?:\/\/\s*(.+))?/g;
  for (const match of regexMatchAll(content, constPattern)) {
    const name = match[1];
    if (name === 'MAX_TOOLS') continue; // Already captured
    constantItems.push({
      id: `const-${name}`,
      name,
      description: match[5]?.trim() || `Retrieval constant: ${match[4] || `${match[2]}/${match[3]}`}`,
      type: 'constant',
      properties: {
        value: match[4] ? parseInt(match[4], 10) : undefined,
        withFilter: match[2] ? parseInt(match[2], 10) : undefined,
        withoutFilter: match[3] ? parseInt(match[3], 10) : undefined,
      },
    });
  }

  sections.push({
    id: 'tool-selection-constants',
    title: 'Tool Selection Constants',
    description: 'Hard limits and retrieval parameters for semantic tool selection.',
    adminOnly: true,
    items: constantItems,
  });

  // --- Section 2: Search Tiers ---
  const tierItems: DocItem[] = [
    {
      id: 'tier-pgvector',
      name: 'pgvector (Primary)',
      description: 'PostgreSQL pgvector with HNSW index — ACID-consistent tool embeddings, intent-priority routing, score-gap cutoff',
      type: 'search-tier',
      properties: { priority: 1, store: 'PostgreSQL pgvector' },
    },
    {
      id: 'tier-milvus',
      name: 'Milvus (Fallback)',
      description: 'GPU-accelerated vector search — used only if pgvector is DOWN',
      type: 'search-tier',
      properties: { priority: 2, store: 'Milvus' },
    },
    {
      id: 'tier-redis',
      name: 'Redis (Emergency)',
      description: 'Emergency all-tools dump — used only if BOTH vector stores are DOWN',
      type: 'search-tier',
      properties: { priority: 3, store: 'Redis' },
    },
  ];

  // Verify tiers exist in source
  const hasPgvector = content.includes('pgvector') || content.includes('pgvectorService');
  const hasMilvus = content.includes('milvus') || content.includes('Milvus');
  const hasRedis = content.includes('redis') || content.includes('Redis');

  const activeTiers = tierItems.filter(t => {
    if (t.id === 'tier-pgvector') return hasPgvector;
    if (t.id === 'tier-milvus') return hasMilvus;
    if (t.id === 'tier-redis') return hasRedis;
    return true;
  });

  sections.push({
    id: 'search-tiers',
    title: 'Search Tiers',
    description: 'Tiered semantic search with automatic fallback between vector stores.',
    adminOnly: false,
    items: activeTiers,
  });

  // --- Section 3: Intent Routing ---
  const intentItems: DocItem[] = [];

  // Look for intent routing logic
  const intentMatch = content.match(/detectTargetServersWithIntent/);
  if (intentMatch) {
    intentItems.push({
      id: 'intent-action',
      name: 'ACTION intent',
      description: 'Action verbs (create, deploy, delete, scale) route to primary servers with 2x similarity boost',
      type: 'intent-type',
      properties: { boostFactor: 2.0 },
    });
    intentItems.push({
      id: 'intent-content',
      name: 'CONTENT intent',
      description: 'Informational queries (list, describe, get, show) route to context servers as supplementary results',
      type: 'intent-type',
    });
  }

  // Look for the routing layers
  const layerPattern = /\/\/\s*Layer (\d+):\s*(.+)/g;
  for (const match of regexMatchAll(content, layerPattern)) {
    intentItems.push({
      id: `layer-${match[1]}`,
      name: `Layer ${match[1]}`,
      description: match[2].trim(),
      type: 'routing-layer',
      properties: { layer: parseInt(match[1], 10) },
    });
  }

  sections.push({
    id: 'intent-routing',
    title: 'Intent Routing',
    description: 'Server-first routing with intent classification distinguishes ACTION verbs from CONTENT queries.',
    adminOnly: false,
    items: intentItems,
  });

  // --- Section 4: Additional Tool Sources ---
  const toolSources: DocItem[] = [];

  // Check for data layer tools
  if (content.includes('getDataLayerTools')) {
    toolSources.push({
      id: 'source-data-layer',
      name: 'Data Layer Tools',
      description: 'query_data and list_datasets tools for drilling into large tool results (>16KB auto-stored)',
      type: 'tool-source',
    });
  }

  // Check for synth tools
  if (content.includes('getSynthToolDefinitions')) {
    toolSources.push({
      id: 'source-synth',
      name: 'Synth Tools',
      description: 'Dynamic tool synthesis definitions, conditionally visible to LLM',
      type: 'tool-source',
    });
  }

  // Check for memory tools
  if (content.includes('getMemoryToolDefinitions')) {
    toolSources.push({
      id: 'source-memory',
      name: 'Memory Tools',
      description: 'Agent memory retrieval and storage tools',
      type: 'tool-source',
    });
  }

  if (toolSources.length > 0) {
    sections.push({
      id: 'additional-tool-sources',
      title: 'Additional Tool Sources',
      description: 'Non-MCP tools injected into the LLM context alongside semantically selected MCP tools.',
      adminOnly: false,
      items: toolSources,
    });
  }

  return {
    domain: 'semantic-tools',
    title: 'Semantic Tool Selection',
    description: `Intelligent tool selection with ${activeTiers.length}-tier search, intent-priority routing, and score-gap cutoff (max ${maxToolsMatch?.[1] || '15'} tools per request).`,
    icon: 'tool',
    category: 'tools',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
