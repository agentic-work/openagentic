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
 * Agent Configuration Documentation Generator
 *
 * Parses AgentSpawnManager.ts to extract:
 * - ROLE_SYSTEM_PROMPTS (default prompts per agent role)
 * - SubAgentConfig, SubAgentResult, SpawnOptions interfaces
 * - Tier routing and model selection
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateAgentConfiguration(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'AgentSpawnManager.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Role System Prompts ---
  const promptItems: DocItem[] = [];
  const promptsBlock = content.match(/const ROLE_SYSTEM_PROMPTS[\s\S]*?\{([\s\S]*?)\n\};/);
  if (promptsBlock) {
    const promptPattern = /(\w+):\s*'([^']+)'/g;
    for (const match of regexMatchAll(promptsBlock[1], promptPattern)) {
      const role = match[1];
      const prompt = match[2];
      promptItems.push({
        id: `prompt-${role}`,
        name: role,
        description: prompt.substring(0, 120) + (prompt.length > 120 ? '...' : ''),
        type: 'system-prompt',
        properties: { fullPrompt: prompt },
        sourceLine: getLineNumber(content, match.index),
        sourceFile: sourceFiles[0],
      });
    }
  }

  sections.push({
    id: 'role-system-prompts',
    title: 'Role System Prompts',
    description: `Default system prompts for ${promptItems.length} agent roles, used when no custom prompt is configured.`,
    adminOnly: true,
    items: promptItems,
  });

  // --- Section 2: SubAgentConfig Interface ---
  const configFields: DocItem[] = [];
  const configBlock = content.match(/export interface SubAgentConfig\s*\{([\s\S]*?)\}/);
  if (configBlock) {
    const fieldPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;]+);/g;
    for (const match of regexMatchAll(configBlock[1], fieldPattern)) {
      const jsdoc = match[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
      configFields.push({
        id: `config-${match[2]}`,
        name: match[2],
        description: jsdoc || `${match[4].trim()} field`,
        type: 'interface-field',
        properties: { type: match[4].trim(), optional: !!match[3] },
      });
    }
  }

  sections.push({
    id: 'sub-agent-config',
    title: 'Sub-Agent Configuration',
    description: 'The SubAgentConfig interface defines parameters for spawning individual sub-agents.',
    adminOnly: false,
    items: configFields,
  });

  // --- Section 3: SubAgentResult Interface ---
  const resultFields: DocItem[] = [];
  const resultBlock = content.match(/export interface SubAgentResult\s*\{([\s\S]*?)\n\}/);
  if (resultBlock) {
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+);/g;
    for (const match of regexMatchAll(resultBlock[1], fieldPattern)) {
      resultFields.push({
        id: `result-${match[1]}`,
        name: match[1],
        description: `${match[3].trim()}`,
        type: 'interface-field',
        properties: { type: match[3].trim(), optional: !!match[2] },
      });
    }
  }

  sections.push({
    id: 'sub-agent-result',
    title: 'Sub-Agent Result',
    description: 'The SubAgentResult interface returned after each sub-agent completes.',
    adminOnly: false,
    items: resultFields,
  });

  // --- Section 4: SpawnOptions Interface ---
  const spawnFields: DocItem[] = [];
  const spawnBlock = content.match(/export interface SpawnOptions\s*\{([\s\S]*?)\n\}/);
  if (spawnBlock) {
    const fieldPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\?)?:\s*([^;]+);/g;
    for (const match of regexMatchAll(spawnBlock[1], fieldPattern)) {
      const jsdoc = match[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
      spawnFields.push({
        id: `spawn-${match[2]}`,
        name: match[2],
        description: jsdoc || `${match[4].trim()} option`,
        type: 'interface-field',
        properties: { type: match[4].trim(), optional: !!match[3] },
      });
    }
  }

  sections.push({
    id: 'spawn-options',
    title: 'Spawn Options',
    description: 'Options controlling concurrency, aggregation, and auth context when spawning sub-agents.',
    adminOnly: false,
    items: spawnFields,
  });

  // --- Section 5: Tier Routing ---
  const tierItems: DocItem[] = [];

  // Look for tier/slider references
  const tierPattern = /(?:sliderTier|tiers?|registryTiers)\b[^;]*(?:=|:)\s*([^;]+);/g;
  const seenTiers = new Set<string>();
  for (const match of regexMatchAll(content, tierPattern)) {
    const tierRef = match[0].trim();
    const idKey = tierRef.substring(0, 40);
    if (seenTiers.has(idKey)) continue;
    seenTiers.add(idKey);
    tierItems.push({
      id: `tier-${seenTiers.size}`,
      name: `Tier routing ${seenTiers.size}`,
      description: tierRef.substring(0, 150),
      type: 'tier-routing',
      sourceLine: getLineNumber(content, match.index),
      sourceFile: sourceFiles[0],
    });
  }

  // Look for model selection patterns
  const modelSelPattern = /ModelConfigurationService|getSliderTiers|SmartRouter/g;
  const modelSelItems: DocItem[] = [];
  const seenModelSel = new Set<string>();
  for (const match of regexMatchAll(content, modelSelPattern)) {
    const name = match[0];
    if (seenModelSel.has(name)) continue;
    seenModelSel.add(name);
    modelSelItems.push({
      id: `model-sel-${name}`,
      name,
      description: `Model selection service used for agent tier routing`,
      type: 'model-selection',
      sourceLine: getLineNumber(content, match.index),
      sourceFile: sourceFiles[0],
    });
  }

  const allTierItems = [...tierItems, ...modelSelItems];
  if (allTierItems.length > 0) {
    sections.push({
      id: 'tier-routing',
      title: 'Tier Routing & Model Selection',
      description: 'Agent model selection uses DB-configured tiers from the Admin Console, with Smart Router fallback.',
      adminOnly: true,
      items: allTierItems,
    });
  }

  return {
    domain: 'agent-configuration',
    title: 'Agent Configuration',
    description: `Agent spawn configuration with ${promptItems.length} role prompts, sub-agent lifecycle, and tier-based model routing.`,
    icon: 'agent',
    category: 'agents',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
