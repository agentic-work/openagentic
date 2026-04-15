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
 * OAT Framework Documentation Generator
 *
 * Scans the companion `oat` project — the Open Agent Tool framework that
 * ships with the platform as a vendor package (separate from the in-repo
 * `services/openagentic-synth` which is just the HTTP wrapper). The framework
 * lives at `oats/` inside the oat repo and contains:
 *   - capabilities/ — pluggable tool capabilities
 *   - cli/          — CLI commands
 *   - core/         — core orchestration primitives
 *   - grounding/    — output grounding / validation
 *   - hitl/         — human-in-the-loop approvals
 *   - mcp/          — Model Context Protocol client + server bridges
 *   - platform/     — platform integrations
 *   - sandbox/      — sandbox execution layer
 *
 * Like the other companion generators, this one resolves paths via
 * `companionPath(basePath, 'oat', ...)` which honors the
 * `DOCS_COMPANION_ROOT` env var (set by the CDC openagentic-ui Docker
 * build to `/companions`) and falls back to the sibling layout for
 * developer boxes.
 *
 * Each submodule becomes a DocSection whose items are the Python
 * classes + top-level functions + FastAPI-style routes discovered in
 * the module's .py files.
 */

import type { DocManifest, DocSection, DocItem } from './types.js';
import {
  readFileIfExists, relativePath, findFiles, companionPath,
  parsePyClasses, parsePyFunctions, parsePyRoutes,
} from './utils.js';

const SUBMODULES = [
  { id: 'core',         title: 'Core Orchestration',     dir: 'core' },
  { id: 'capabilities', title: 'Tool Capabilities',      dir: 'capabilities' },
  { id: 'cli',          title: 'CLI',                    dir: 'cli' },
  { id: 'grounding',    title: 'Output Grounding',       dir: 'grounding' },
  { id: 'hitl',         title: 'Human-in-the-Loop',      dir: 'hitl' },
  { id: 'mcp',          title: 'MCP Client/Server',      dir: 'mcp' },
  { id: 'platform',     title: 'Platform Integrations',  dir: 'platform' },
  { id: 'sandbox',      title: 'Sandbox Execution',      dir: 'sandbox' },
];

export async function generateOatFramework(basePath: string): Promise<DocManifest | null> {
  const projectDir = companionPath(basePath, 'oat');
  // Probe for any .py file under oats/ — if none, companion isn't staged.
  const oatsRoot = companionPath(basePath, 'oat', 'oats');
  const probeFiles = await findFiles(oatsRoot, /\.py$/);
  if (probeFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];

  for (const mod of SUBMODULES) {
    const modDir = companionPath(basePath, 'oat', 'oats', mod.dir);
    const pyFiles = (await findFiles(modDir, /\.py$/)).sort();
    if (pyFiles.length === 0) continue;

    const items: DocItem[] = [];

    for (const filePath of pyFiles) {
      const content = await readFileIfExists(filePath);
      if (!content) continue;
      const rel = relativePath(filePath, projectDir);
      sourceFiles.push(rel);

      // Classes
      for (const cls of parsePyClasses(content)) {
        items.push({
          id: `${mod.id}-class-${cls.name}`,
          name: cls.name,
          description: cls.docstring || `Class in ${rel}${cls.bases ? ` extends ${cls.bases}` : ''}`,
          type: 'class',
          sourceFile: rel,
          sourceLine: cls.line,
          properties: {
            bases: cls.bases || '',
            methods: cls.methods.slice(0, 12).join(', '),
          },
        });
      }

      // Top-level functions (skip dunders + privates)
      for (const fn of parsePyFunctions(content)) {
        if (fn.name.startsWith('_')) continue;
        items.push({
          id: `${mod.id}-fn-${fn.name}`,
          name: fn.name,
          description: fn.docstring || `Function in ${rel}`,
          type: 'function',
          sourceFile: rel,
          sourceLine: fn.line,
        });
      }

      // FastAPI-style routes (only in modules that expose HTTP surface)
      for (const route of parsePyRoutes(content)) {
        items.push({
          id: `${mod.id}-route-${route.method}-${route.path.replace(/[^\w]/g, '-')}`,
          name: `${route.method.toUpperCase()} ${route.path}`,
          description: route.docstring || `Handler: ${route.funcName}`,
          type: 'route',
          sourceFile: rel,
          sourceLine: 0,
          properties: {
            method: route.method,
            path: route.path,
            handler: route.funcName,
          },
        });
      }
    }

    if (items.length > 0) {
      sections.push({
        id: mod.id,
        title: mod.title,
        description: `${items.length} symbols discovered in ${pyFiles.length} files under oats/${mod.dir}/`,
        adminOnly: false,
        items,
        keywords: ['oat', 'framework', mod.id],
      });
    }
  }

  // README overview (if present)
  const readme = await readFileIfExists(companionPath(basePath, 'oat', 'README.md'));
  if (readme) {
    sections.unshift({
      id: 'overview',
      title: 'Framework Overview',
      description: 'Top-level README from the oat companion repo.',
      adminOnly: false,
      content: readme.slice(0, 8000),
    });
  }

  if (sections.length === 0) return null;

  return {
    domain: 'oat-framework',
    title: 'OAT Framework (Vendor)',
    category: 'tools',
    description: 'Open Agent Tool framework — vendor library that the openagentic-synth service wraps.',
    sections,
    sourceFiles,
  };
}
