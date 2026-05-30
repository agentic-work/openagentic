/**
 * LLM Providers Documentation Generator
 *
 * Parses ProviderManager.ts and scans for Provider files to extract:
 * - Provider types (azure-openai, aws-bedrock, google-vertex, etc.)
 * - ProviderConfig, ProviderManagerConfig, ProviderMetrics interfaces
 * - Load balancing strategies and failover configuration
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber, findFiles } from './utils.js';

export async function generateLlmProviders(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'llm-providers', 'ProviderManager.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Provider Types ---
  const providerTypes: DocItem[] = [];
  const typeMatch = content.match(/type:\s*'([^']+)'\s*\|\s*'([^']+)'/);
  if (typeMatch) {
    // Extract from the full union type in ProviderConfig
    const typeBlock = content.match(/type:\s*([^;]+);/);
    if (typeBlock) {
      const types = typeBlock[1].match(/'([^']+)'/g);
      if (types) {
        for (const t of types) {
          const typeName = t.replace(/'/g, '');
          providerTypes.push({
            id: `provider-${typeName}`,
            name: typeName,
            description: `LLM provider type: ${typeName}`,
            type: 'provider-type',
          });
        }
      }
    }
  }

  sections.push({
    id: 'provider-types',
    title: 'LLM Provider Types',
    description: `OpenAgentic supports ${providerTypes.length} LLM provider backends for model routing and failover.`,
    adminOnly: false,
    items: providerTypes,
  });

  // --- Section 2: ProviderConfig Interface ---
  const configFields: DocItem[] = [];
  const configBlock = content.match(/export interface ProviderConfig\s*\{([\s\S]*?)\}/);
  if (configBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(configBlock[1], fieldPattern)) {
      configFields.push({
        id: `config-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} field`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'provider-config',
    title: 'Provider Configuration',
    description: 'Configuration interface for individual LLM providers.',
    adminOnly: true,
    items: configFields,
  });

  // --- Section 3: ProviderManagerConfig ---
  const managerFields: DocItem[] = [];
  const managerBlock = content.match(/export interface ProviderManagerConfig\s*\{([\s\S]*?)\}/);
  if (managerBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(managerBlock[1], fieldPattern)) {
      managerFields.push({
        id: `manager-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} setting`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'manager-config',
    title: 'Provider Manager Configuration',
    description: 'Top-level configuration for the multi-provider LLM routing layer.',
    adminOnly: true,
    items: managerFields,
  });

  // --- Section 4: Provider Metrics ---
  const metricsFields: DocItem[] = [];
  const metricsBlock = content.match(/export interface ProviderMetrics\s*\{([\s\S]*?)\}/);
  if (metricsBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(metricsBlock[1], fieldPattern)) {
      metricsFields.push({
        id: `metric-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} metric`,
        type: 'metric-field',
        properties: { type: match[3].trim() },
      });
    }
  }

  sections.push({
    id: 'provider-metrics',
    title: 'Provider Metrics',
    description: 'Per-provider observability metrics for request tracking, latency, cost, and health.',
    adminOnly: true,
    items: metricsFields,
  });

  // --- Section 5: Failover Metadata ---
  const failoverFields: DocItem[] = [];
  const failoverBlock = content.match(/export interface FailoverMetadata\s*\{([\s\S]*?)\}/);
  if (failoverBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(failoverBlock[1], fieldPattern)) {
      failoverFields.push({
        id: `failover-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3].trim()} field`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'failover-metadata',
    title: 'Failover Metadata',
    description: 'Metadata returned when a provider fails and another takes over.',
    adminOnly: true,
    items: failoverFields,
  });

  // --- Section 6: Discovered Provider Implementations ---
  const providerDir = svcPath(basePath, 'openagentic-api', 'src', 'services', 'llm-providers');
  const providerFiles = await findFiles(providerDir, /Provider\.ts$/);
  const implItems: DocItem[] = [];

  for (const pf of providerFiles) {
    const pfContent = await readFileIfExists(pf);
    if (!pfContent) continue;
    const relPath = relativePath(pf, basePath);
    if (!sourceFiles.includes(relPath)) sourceFiles.push(relPath);

    // Extract class name
    const classMatch = pfContent.match(/export class (\w+Provider)/);
    if (classMatch) {
      const className = classMatch[1];
      implItems.push({
        id: `impl-${className}`,
        name: className,
        description: `Provider implementation: ${className.replace(/Provider$/, '').replace(/([a-z])([A-Z])/g, '$1 $2')}`,
        type: 'provider-impl',
        sourceFile: relPath,
      });
    }
  }

  if (implItems.length > 0) {
    sections.push({
      id: 'provider-implementations',
      title: 'Provider Implementations',
      description: `${implItems.length} provider implementations discovered in the codebase.`,
      adminOnly: false,
      items: implItems,
    });
  }

  return {
    domain: 'llm-providers',
    title: 'LLM Providers',
    description: `Multi-provider LLM routing with ${providerTypes.length} provider types, failover, load balancing, and per-provider metrics.`,
    icon: 'brain',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
