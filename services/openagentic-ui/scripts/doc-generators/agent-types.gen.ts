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
 * Agent Types Documentation Generator
 *
 * Parses AgentRegistry.ts to extract:
 * - AgentType union type (11 types with inline comments)
 * - DEFAULT_MODEL_CONFIGS object (config per type)
 * - AgentModelConfig interface fields
 * - AgentExecutionMetrics, AgentStats, AgentAdminConfig interfaces
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, getLineNumber, regexMatchAll } from './utils.js';

export async function generateAgentTypes(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'AgentRegistry.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Agent Types ---
  const typeItems: DocItem[] = [];
  const typePattern = /\| '(\w+)'\s*\/\/\s*(.+)/g;
  for (const match of regexMatchAll(content, typePattern)) {
    typeItems.push({
      id: match[1],
      name: match[1],
      description: match[2].trim(),
      type: 'agent-type',
      sourceLine: getLineNumber(content, match.index),
      sourceFile: sourceFiles[0],
    });
  }

  // Also check for the first type (no preceding |)
  const firstTypeMatch = content.match(/export type AgentType\s*=\s*\n\s*\| '(\w+)'\s*\/\/\s*(.+)/);
  if (!firstTypeMatch && typeItems.length === 0) {
    // Try alternate pattern
    const altPattern = /'(\w+)'\s*(?:\/\/\s*(.+))?/g;
    const typeBlock = content.match(/export type AgentType\s*=[\s\S]*?;/);
    if (typeBlock) {
      for (const m of regexMatchAll(typeBlock[0], altPattern)) {
        if (!typeItems.find(t => t.name === m[1])) {
          typeItems.push({
            id: m[1],
            name: m[1],
            description: m[2]?.trim() || m[1].replace(/_/g, ' '),
            type: 'agent-type',
          });
        }
      }
    }
  }

  // --- Parse DEFAULT_MODEL_CONFIGS to enrich agent type items ---
  const configMap = new Map<string, Record<string, unknown>>();
  const configBlock = content.match(/const DEFAULT_MODEL_CONFIGS[\s\S]*?^}/m);
  if (configBlock) {
    // Parse each agent config block
    const agentConfigPattern = /(\w+):\s*\{([^}]+)\}/g;
    for (const match of regexMatchAll(configBlock[0], agentConfigPattern)) {
      const agentType = match[1];
      const configBody = match[2];

      const props: Record<string, unknown> = {};
      const propPattern = /(\w+):\s*([^,\n]+)/g;
      for (const prop of regexMatchAll(configBody, propPattern)) {
        const key = prop[1].trim();
        let val: unknown = prop[2].trim().replace(/,\s*$/, '');
        // Parse numeric/boolean values
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(Number(val)) && val !== '') val = Number(val);
        else val = String(val).replace(/['"]/g, '');
        if (key !== 'agentType') props[key] = val;
      }

      configMap.set(agentType, props);
    }
  }

  // Merge config properties into agent type items
  for (const item of typeItems) {
    const config = configMap.get(item.name);
    if (config) {
      item.properties = config;
    }
  }

  sections.push({
    id: 'agent-types',
    title: 'Agent Types',
    description: `OpenAgentic supports ${typeItems.length} agent types, each optimized for specific task patterns.`,
    adminOnly: false,
    items: typeItems,
  });

  // --- Section 2: Default Model Configurations (full details) ---
  const configItems: DocItem[] = [];
  for (const [agentType, props] of configMap.entries()) {
    configItems.push({
      id: `config-${agentType}`,
      name: agentType,
      description: `Default model configuration for ${agentType} agents`,
      type: 'model-config',
      properties: props,
    });
  }

  sections.push({
    id: 'default-model-configs',
    title: 'Default Model Configurations',
    description: 'Each agent type has a default model configuration controlling temperature, token limits, thinking behavior, cost budgets, and timeouts.',
    adminOnly: true,
    items: configItems,
  });

  // --- Section 3: AgentModelConfig Interface ---
  const modelConfigFields: DocItem[] = [];
  const interfaceBlock = content.match(/export interface AgentModelConfig\s*\{([\s\S]*?)\}/);
  if (interfaceBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*(\w+);\s*(?:\/\/\s*(.+))?/g;
    for (const match of regexMatchAll(interfaceBlock[1], fieldPattern)) {
      modelConfigFields.push({
        id: `field-${match[1]}`,
        name: match[1],
        description: match[4]?.trim() || `${match[3]} field`,
        type: 'interface-field',
        properties: {
          type: match[3],
          optional: !!match[2],
        },
      });
    }
  }

  sections.push({
    id: 'model-config-schema',
    title: 'Model Configuration Schema',
    description: 'The AgentModelConfig interface defines all configurable parameters for agent model routing.',
    adminOnly: true,
    items: modelConfigFields,
  });

  // --- Section 4: Execution Metrics ---
  const metricsFields: DocItem[] = [];
  const metricsBlock = content.match(/export interface AgentExecutionMetrics\s*\{([\s\S]*?)\}/);
  if (metricsBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;\n]+);\s*$/gm;
    for (const match of regexMatchAll(metricsBlock[1], fieldPattern)) {
      metricsFields.push({
        id: `metric-${match[1]}`,
        name: match[1],
        description: match[3].trim(),
        type: 'metric-field',
      });
    }
  }

  sections.push({
    id: 'execution-metrics',
    title: 'Execution Metrics',
    description: 'Every agent execution records detailed metrics for observability and cost tracking.',
    adminOnly: true,
    items: metricsFields,
  });

  // --- Section 5: Admin Configuration ---
  const adminFields: DocItem[] = [];
  const adminBlock = content.match(/export interface AgentAdminConfig\s*\{([\s\S]*?)\n\}/);
  if (adminBlock) {
    // Extract top-level and nested fields
    const sectionPattern = /(\w+):\s*\{([^}]+)\}/g;
    for (const match of regexMatchAll(adminBlock[1], sectionPattern)) {
      const sectionName = match[1];
      const body = match[2];
      const nestedPattern = /(\w+):\s*(\w+);\s*(?:\/\/\s*(.+))?/g;
      for (const nested of regexMatchAll(body, nestedPattern)) {
        adminFields.push({
          id: `admin-${sectionName}-${nested[1]}`,
          name: `${sectionName}.${nested[1]}`,
          description: nested[3]?.trim() || `${nested[2]} setting`,
          type: 'admin-config',
          properties: { section: sectionName, type: nested[2] },
        });
      }
    }
  }

  sections.push({
    id: 'admin-configuration',
    title: 'Admin Configuration',
    description: 'Per-agent-type admin settings: rate limits, alerts, and logging.',
    adminOnly: true,
    items: adminFields,
  });

  return {
    domain: 'agent-types',
    title: 'Agent System',
    description: 'Agent types, model configurations, execution metrics, and admin settings for the OpenAgentic multi-agent platform.',
    icon: 'agent',
    category: 'agents',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
