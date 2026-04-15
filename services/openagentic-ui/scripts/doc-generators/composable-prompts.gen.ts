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
 * Composable Prompts Documentation Generator
 *
 * Parses two files:
 * 1. PromptComposer.ts - Composition pipeline stages and slider budget mapping
 * 2. ModuleSeeder.ts - Seed module definitions (name, category, description, priority)
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import {
  readFileIfExists,
  svcPath,
  relativePath,
  getLineNumber,
  regexMatchAll,
} from './utils.js';

export async function generateComposablePrompts(basePath: string): Promise<DocManifest | null> {
  const composerPath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'prompt', 'PromptComposer.ts');
  const seederPath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'prompt', 'ModuleSeeder.ts');

  const composerContent = await readFileIfExists(composerPath);
  const seederContent = await readFileIfExists(seederPath);

  if (!composerContent && !seederContent) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  // --- Section 1: Seed Modules ---
  if (seederContent) {
    sourceFiles.push(relativePath(seederPath, basePath));

    // Parse SEED_MODULES array entries
    // Each entry: { name: '...', category: '...', description: '...', priority: N, ... }
    const modulePattern = /\{\s*\n\s+name:\s*'([^']+)',\s*\n\s+category:\s*'([^']+)',\s*\n\s+description:\s*'([^']+)',\s*\n\s+priority:\s*(\d+)/g;
    const modules: Array<{ name: string; category: string; description: string; priority: number; line: number }> = [];

    for (const match of regexMatchAll(seederContent, modulePattern)) {
      modules.push({
        name: match[1],
        category: match[2],
        description: match[3],
        priority: parseInt(match[4], 10),
        line: getLineNumber(seederContent, match.index),
      });
    }

    // Group by category
    const categories = ['core', 'mode', 'capability', 'domain'];
    const categoryDescriptions: Record<string, string> = {
      core: 'Always-inject modules: identity, continuation, safety, response style',
      mode: 'Mode-specific modules injected based on chat/code/flow context',
      capability: 'Injected when the model supports specific capabilities (thinking, vision, tools)',
      domain: 'Domain-specific modules injected based on tool availability and user context',
    };

    for (const cat of categories) {
      const catModules = modules.filter(m => m.category === cat);
      if (catModules.length === 0) continue;

      sections.push({
        id: `seed-${cat}`,
        title: `${cat.charAt(0).toUpperCase() + cat.slice(1)} Modules`,
        description: `${categoryDescriptions[cat] || cat} (${catModules.length} modules)`,
        adminOnly: cat === 'core',
        items: catModules.map(m => ({
          id: `module-${m.name}`,
          name: m.name,
          description: m.description,
          type: 'prompt-module',
          properties: {
            category: m.category,
            priority: m.priority,
          },
          sourceLine: m.line,
          sourceFile: relativePath(seederPath, basePath),
        })),
      });
    }
  }

  // --- Section 2: Composition Pipeline ---
  if (composerContent) {
    const composerRelPath = relativePath(composerPath, basePath);
    if (!sourceFiles.includes(composerRelPath)) sourceFiles.push(composerRelPath);

    const pipelineStages: DocItem[] = [];

    // Extract numbered pipeline steps from comments in the compose() method
    // Pattern: // N. Description or // N. Get/Select/Apply/Calculate/Assemble
    const stagePattern = /\/\/\s*(\d+)\.\s*(.+)/g;
    const composeMethod = composerContent.match(/async compose\([\s\S]*?\n\s*\}/);
    if (composeMethod) {
      for (const match of regexMatchAll(composeMethod[0], stagePattern)) {
        const stepNum = match[1];
        const stepDesc = match[2].trim();

        pipelineStages.push({
          id: `stage-${stepNum}`,
          name: `Step ${stepNum}`,
          description: stepDesc,
          type: 'pipeline-stage',
          properties: { step: parseInt(stepNum, 10) },
        });
      }
    }

    sections.push({
      id: 'composition-pipeline',
      title: 'Composition Pipeline',
      description: `The PromptComposer assembles system prompts through a ${pipelineStages.length}-stage pipeline.`,
      adminOnly: true,
      items: pipelineStages,
    });

    // --- Section 3: Slider Budget Mapping ---
    const sliderItems: DocItem[] = [];

    // Extract slider position to budget percentage mapping
    const sliderBlock = composerContent.match(/sliderPosition[\s\S]*?domainBudgetPct\s*=\s*[\d.]+;/);
    if (sliderBlock) {
      // Find the if/else conditions
      const condPattern = /sliderPosition\s*<=?\s*(\d+)\)\s*\{\s*\n\s*domainBudgetPct\s*=\s*([\d.]+)/g;
      for (const match of regexMatchAll(sliderBlock[0], condPattern)) {
        sliderItems.push({
          id: `slider-lte-${match[1]}`,
          name: `Slider <= ${match[1]}`,
          description: `Domain budget: ${(parseFloat(match[2]) * 100).toFixed(0)}% of available tokens`,
          type: 'slider-mapping',
          properties: {
            threshold: parseInt(match[1], 10),
            budgetPct: parseFloat(match[2]),
          },
        });
      }

      // Get the else case
      const elseMatch = sliderBlock[0].match(/\}\s*else\s*\{\s*\n\s*domainBudgetPct\s*=\s*([\d.]+)/);
      if (elseMatch) {
        sliderItems.push({
          id: 'slider-max',
          name: 'Slider > 70',
          description: `Domain budget: ${(parseFloat(elseMatch[1]) * 100).toFixed(0)}% of available tokens`,
          type: 'slider-mapping',
          properties: {
            threshold: 100,
            budgetPct: parseFloat(elseMatch[1]),
          },
        });
      }
    }

    sections.push({
      id: 'slider-budget',
      title: 'Slider Budget Mapping',
      description: 'The system prompt slider controls how much token budget is allocated to domain-specific modules.',
      adminOnly: true,
      items: sliderItems,
    });
  }

  const totalModules = sections
    .filter(s => s.id.startsWith('seed-'))
    .reduce((sum, s) => sum + s.items.length, 0);

  return {
    domain: 'composable-prompts',
    title: 'Composable Prompt System',
    description: `Modular prompt composition with ${totalModules} seed modules, multi-stage pipeline, and slider-controlled budget allocation.`,
    icon: 'brain',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
