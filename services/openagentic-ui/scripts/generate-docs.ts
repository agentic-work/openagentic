#!/usr/bin/env npx tsx
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
 * OpenAgentic Documentation Generator
 *
 * Scans the entire codebase and generates structured JSON manifests
 * for the in-app documentation system.
 *
 * Usage: npx tsx scripts/generate-docs.ts
 *   or:  pnpm run generate:docs
 */

import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { DocManifest, DocsIndex } from './doc-generators/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(__dirname, '..');
const AGENTIC_ROOT = resolve(UI_ROOT, '..', '..');
const OUTPUT_DIR = resolve(UI_ROOT, 'public', 'docs', 'generated');

// Category definitions for the sidebar navigation
const CATEGORIES = [
  { id: 'core', title: 'Core Platform', icon: 'brain' },
  { id: 'agents', title: 'Agents', icon: 'agent' },
  { id: 'tools', title: 'MCP & Tools', icon: 'tool' },
  { id: 'workflows', title: 'Workflows', icon: 'flow' },
  { id: 'security', title: 'Security', icon: 'shield' },
  { id: 'infrastructure', title: 'Infrastructure', icon: 'infra' },
  { id: 'ui', title: 'UI & Modes', icon: 'code' },
];

interface GeneratorEntry {
  name: string;
  generate: (basePath: string) => Promise<DocManifest | null>;
}

async function loadGenerators(): Promise<GeneratorEntry[]> {
  // Dynamically import all generators — each may fail independently
  const generators: GeneratorEntry[] = [];

  const modules = [
    ['agent-types', 'generateAgentTypes'],
    ['dlp-scanner', 'generateDlpScanner'],
    ['mcp-servers', 'generateMcpServers'],
    ['chat-pipeline', 'generateChatPipeline'],
    ['llm-providers', 'generateLlmProviders'],
    ['authentication', 'generateAuthentication'],
    ['agent-orchestration', 'generateAgentOrchestration'],
    ['agent-configuration', 'generateAgentConfiguration'],
    ['semantic-tools', 'generateSemanticTools'],
    ['oat-synth', 'generateOatSynth'],
    ['workflow-engine', 'generateWorkflowEngine'],
    ['workflow-scheduling', 'generateWorkflowScheduling'],
    ['hitl-approvals', 'generateHitlApprovals'],
    ['audit-trail', 'generateAuditTrail'],
    ['api-routes', 'generateApiRoutes'],
    ['database-schema', 'generateDatabaseSchema'],
    ['env-variables', 'generateEnvVariables'],
    ['deployment', 'generateDeployment'],
    ['observability', 'generateObservability'],
    ['code-mode', 'generateCodeMode'],
    ['admin-portal', 'generateAdminPortal'],
    ['composable-prompts', 'generateComposablePrompts'],
    ['sse-stream-events', 'generateSseStreamEvents'],
    // Companion projects — CI stages checkouts of these into /companions
    // before the UI Docker build; DOCS_COMPANION_ROOT env var points
    // utils.ts companionPath() at the staged location. Dev boxes without
    // staging fall back to the legacy sibling layout.
    ['openagentic-cli', 'generateOpenagenticCli'],
    ['llm-sdk', 'generateLlmSdk'],
    ['oat-framework', 'generateOatFramework'],
    // Additional services
    ['mcp-proxy', 'generateMcpProxy'],
    ['openagentic-synth', 'generateOpenAgenticSynth'],
    // Helm chart templates
    ['helm-templates', 'generateHelmTemplates'],
  ] as const;

  for (const [name, funcName] of modules) {
    try {
      const mod = await import(`./doc-generators/${name}.gen.js`);
      if (typeof mod[funcName] === 'function') {
        generators.push({ name, generate: mod[funcName] });
      } else {
        console.warn(`  [WARN] ${name}: export ${funcName} not found`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only warn about missing generators — they'll be implemented incrementally
      if (msg.includes('Cannot find module') || msg.includes('ERR_MODULE_NOT_FOUND')) {
        console.log(`  [SKIP] ${name}: generator not yet implemented`);
      } else {
        console.warn(`  [WARN] ${name}: failed to load — ${msg}`);
      }
    }
  }

  return generators;
}

async function main() {
  const startTime = Date.now();
  console.log('=== OpenAgentic Documentation Generator ===');
  console.log(`  Base path: ${AGENTIC_ROOT}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log('');

  // Ensure output directory
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Load generators
  console.log('Loading generators...');
  const generators = await loadGenerators();
  console.log(`  ${generators.length} generators loaded\n`);

  // Run all generators in parallel
  console.log('Generating documentation...');
  const results = await Promise.allSettled(
    generators.map(async ({ name, generate }) => {
      const genStart = Date.now();
      try {
        const manifest = await generate(AGENTIC_ROOT);
        const duration = Date.now() - genStart;
        if (manifest) {
          console.log(`  [OK]   ${name} (${manifest.sections.length} sections, ${duration}ms)`);
          return { name, manifest };
        } else {
          console.log(`  [SKIP] ${name}: source files not found (${duration}ms)`);
          return null;
        }
      } catch (err: unknown) {
        const duration = Date.now() - genStart;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [FAIL] ${name}: ${msg} (${duration}ms)`);
        return null;
      }
    })
  );

  // Write manifests
  const manifests: DocManifest[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value?.manifest) {
      const { name, manifest } = result.value;
      const outputPath = resolve(OUTPUT_DIR, `${name}.json`);
      await writeFile(outputPath, JSON.stringify(manifest, null, 2));
      manifests.push(manifest);
    }
  }

  // Read version from package.json
  let version = '0.0.0';
  try {
    const pkg = await import(resolve(UI_ROOT, 'package.json'), { with: { type: 'json' } });
    version = pkg.default?.version || '0.0.0';
  } catch {
    // Fallback
  }

  // Write index.json
  const index: DocsIndex = {
    generatedAt: new Date().toISOString(),
    version,
    categories: CATEGORIES,
    manifests: manifests.map(m => ({
      domain: m.domain,
      title: m.title,
      description: m.description,
      category: m.category,
      file: `${m.domain}.json`,
      sectionCount: m.sections.length,
      itemCount: m.sections.reduce((sum, s) => sum + s.items.length, 0),
      adminOnly: m.sections.every(s => s.adminOnly),
    })),
  };

  await writeFile(resolve(OUTPUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

  // Summary
  const totalSections = manifests.reduce((sum, m) => sum + m.sections.length, 0);
  const totalItems = manifests.reduce((sum, m) => sum + m.sections.reduce((s, sec) => s + sec.items.length, 0), 0);
  const totalTime = Date.now() - startTime;
  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value)).length;

  console.log('');
  console.log('=== Summary ===');
  console.log(`  Generated: ${manifests.length} manifests`);
  console.log(`  Sections:  ${totalSections}`);
  console.log(`  Items:     ${totalItems}`);
  console.log(`  Skipped:   ${generators.length - manifests.length - failed}`);
  console.log(`  Failed:    ${failed}`);
  console.log(`  Time:      ${totalTime}ms`);
  console.log(`  Output:    ${OUTPUT_DIR}/index.json`);

  // Exit with error if ALL generators failed
  if (manifests.length === 0) {
    console.error('\nERROR: No manifests generated!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
