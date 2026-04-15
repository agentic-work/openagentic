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
 * OpenAgentic Synth Documentation Generator
 *
 * Scans the openagentic-synth service (Open Agent Tool synthesis) for:
 * - Python class definitions with docstrings
 * - FastAPI route decorators
 * - Tool synthesis functions
 */

import type { DocManifest, DocSection } from './types.js';
import {
  readFileIfExists, svcPath, relativePath, findFiles,
  parsePyClasses, parsePyRoutes, parsePyFunctions,
  type ParsedPyClass, type ParsedPyRoute, type ParsedPyFunction,
} from './utils.js';

export async function generateOpenAgenticSynth(basePath: string): Promise<DocManifest | null> {
  const svcDir = svcPath(basePath, 'openagentic-synth');
  const pyFiles = await findFiles(svcDir, /\.py$/);

  if (pyFiles.length === 0) return null;

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];
  const allClasses: (ParsedPyClass & { file: string })[] = [];
  const allRoutes: (ParsedPyRoute & { file: string })[] = [];
  const allFunctions: (ParsedPyFunction & { file: string })[] = [];

  for (const filePath of pyFiles.sort()) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const relPath = relativePath(filePath, basePath);
    sourceFiles.push(relPath);

    for (const cls of parsePyClasses(content)) {
      allClasses.push({ ...cls, file: relPath });
    }
    for (const route of parsePyRoutes(content)) {
      allRoutes.push({ ...route, file: relPath });
    }
    for (const fn of parsePyFunctions(content)) {
      allFunctions.push({ ...fn, file: relPath });
    }
  }

  if (allRoutes.length > 0) {
    sections.push({
      id: 'api-endpoints',
      title: 'API Endpoints',
      description: `${allRoutes.length} FastAPI endpoints for OAT tool synthesis and execution.`,
      adminOnly: false,
      items: allRoutes.map(route => ({
        id: `oat-route-${route.method.toLowerCase()}-${route.funcName}`,
        name: `${route.method} ${route.path}`,
        description: route.docstring,
        type: 'api-route',
        properties: { method: route.method, path: route.path, handler: route.funcName },
        sourceFile: route.file,
        sourceLine: route.line,
      })),
    });
  }

  if (allClasses.length > 0) {
    const synthClasses = allClasses.filter(c =>
      /synth|tool|generat|execut|template|render/i.test(c.name) ||
      /synth|tool|generat|execut/i.test(c.bases)
    );
    const otherClasses = allClasses.filter(c => !synthClasses.includes(c));

    if (synthClasses.length > 0) {
      sections.push({
        id: 'tool-synthesis-classes',
        title: 'Tool Synthesis Classes',
        description: `${synthClasses.length} classes for OAT tool generation and synthesis.`,
        adminOnly: false,
        items: synthClasses.map(cls => ({
          id: `oat-synth-${cls.name.toLowerCase()}`,
          name: cls.name,
          description: cls.docstring || (cls.bases ? `Extends ${cls.bases}` : `${cls.methods.length} methods`),
          type: 'python-class',
          properties: { bases: cls.bases || undefined, methods: cls.methods, methodCount: cls.methods.length },
          sourceFile: cls.file,
          sourceLine: cls.line,
        })),
      });
    }

    if (otherClasses.length > 0) {
      sections.push({
        id: 'support-classes',
        title: 'Supporting Classes',
        description: `${otherClasses.length} supporting classes in the OpenAgentic Synth.`,
        adminOnly: false,
        items: otherClasses.map(cls => ({
          id: `oat-cls-${cls.name.toLowerCase()}`,
          name: cls.name,
          description: cls.docstring || (cls.bases ? `Extends ${cls.bases}` : `${cls.methods.length} methods`),
          type: 'python-class',
          properties: { bases: cls.bases || undefined, methods: cls.methods, methodCount: cls.methods.length },
          sourceFile: cls.file,
          sourceLine: cls.line,
        })),
      });
    }
  }

  if (allFunctions.length > 0) {
    const synthFuncs = allFunctions.filter(f =>
      /synth|tool|generat|build|render|compile|transform/i.test(f.name)
    );
    const otherFuncs = allFunctions.filter(f => !synthFuncs.includes(f));

    if (synthFuncs.length > 0) {
      sections.push({
        id: 'synthesis-functions',
        title: 'Tool Synthesis Functions',
        description: `${synthFuncs.length} functions for tool generation and synthesis.`,
        adminOnly: false,
        items: synthFuncs.map(fn => ({
          id: `oat-synth-fn-${fn.name}`,
          name: fn.name,
          description: fn.docstring,
          type: 'function',
          properties: { params: fn.params, async: fn.isAsync },
          sourceFile: fn.file,
          sourceLine: fn.line,
        })),
      });
    }

    if (otherFuncs.length > 0) {
      sections.push({
        id: 'utility-functions',
        title: 'Utility Functions',
        description: `${otherFuncs.length} utility and helper functions.`,
        adminOnly: false,
        items: otherFuncs.map(fn => ({
          id: `oat-fn-${fn.name}`,
          name: fn.name,
          description: fn.docstring,
          type: 'function',
          properties: { params: fn.params, async: fn.isAsync },
          sourceFile: fn.file,
          sourceLine: fn.line,
        })),
      });
    }
  }

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  return {
    domain: 'openagentic-synth',
    title: 'OpenAgentic Synth',
    description: `Open Agent Tool executor with ${totalItems} documented components across ${pyFiles.length} source files.`,
    icon: 'tool',
    category: 'tools',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
