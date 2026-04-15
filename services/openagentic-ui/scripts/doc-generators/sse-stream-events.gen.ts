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
 * SSE Stream Events Documentation Generator
 *
 * Parses services/openagentic-api/src/services/NormalizedStreamTypes.ts to extract:
 * - All event types from the NormalizedStreamEvent discriminated union
 * - Event fields per type
 * - Type guard helper functions
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, getLineNumber, regexMatchAll } from './utils.js';

export async function generateSseStreamEvents(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-api', 'src', 'services', 'NormalizedStreamTypes.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Parse the discriminated union members ---
  // Each member: | { type: 'xxx'; field1: Type1; field2: Type2; ... }
  const memberPattern = /\|\s*\{\s*type:\s*'(\w+)';\s*([^}]*)\}/g;
  const events: Array<{
    type: string;
    fields: Array<{ name: string; tsType: string; optional: boolean }>;
    category: string;
    line: number;
  }> = [];

  // Get the union block
  const unionBlock = content.match(/export type NormalizedStreamEvent\s*=([\s\S]*?);/);
  if (!unionBlock) return null;

  const unionContent = unionBlock[1];
  const unionStartIdx = unionBlock.index!;

  for (const match of regexMatchAll(unionContent, memberPattern)) {
    const eventType = match[1];
    const fieldsStr = match[2];

    // Parse fields
    const fields: Array<{ name: string; tsType: string; optional: boolean }> = [];
    const fieldPattern = /(\w+)(\?)?:\s*([^;]+)/g;
    for (const fm of regexMatchAll(fieldsStr, fieldPattern)) {
      fields.push({
        name: fm[1],
        tsType: fm[3].trim(),
        optional: !!fm[2],
      });
    }

    // Determine category from surrounding comment
    // Look for the comment above (--- Category ---)
    const beforeMatch = unionContent.substring(0, match.index);
    const categoryComment = beforeMatch.match(/\/\/\s*---\s*(\w[\w\s-]*?)\s*---\s*$/m);
    const category = categoryComment ? categoryComment[1].trim() : 'Other';

    events.push({
      type: eventType,
      fields,
      category,
      line: getLineNumber(content, unionStartIdx + match.index),
    });
  }

  // Group events by category
  const categoryOrder = ['Envelope', 'Thinking', 'Tools', 'Text', 'Agents', 'Human-in-the-loop', 'Artifacts', 'Usage', 'Errors'];
  const categoryGroups = new Map<string, typeof events>();
  for (const event of events) {
    if (!categoryGroups.has(event.category)) categoryGroups.set(event.category, []);
    categoryGroups.get(event.category)!.push(event);
  }

  // Overview section
  sections.push({
    id: 'sse-overview',
    title: 'Stream Event Overview',
    description: `${events.length} event types in the NormalizedStreamEvent union, grouped into ${categoryGroups.size} categories. All LLM providers normalize to this format before sending to the frontend.`,
    adminOnly: false,
    items: events.map(e => ({
      id: `event-${e.type}`,
      name: e.type,
      description: `${e.fields.length} fields (${e.category})`,
      type: 'stream-event',
      properties: {
        category: e.category,
        fieldCount: e.fields.length,
        fields: e.fields.map(f => `${f.name}${f.optional ? '?' : ''}: ${f.tsType}`),
      },
      sourceLine: e.line,
      sourceFile: sourceFiles[0],
    })),
  });

  // Per-category sections
  for (const cat of categoryOrder) {
    const catEvents = categoryGroups.get(cat);
    if (!catEvents) continue;

    sections.push({
      id: `sse-${cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `${cat} Events`,
      description: `${catEvents.length} event type(s) in the ${cat} category.`,
      adminOnly: false,
      items: catEvents.map(e => ({
        id: `detail-${e.type}`,
        name: e.type,
        description: e.fields.map(f => `${f.name}${f.optional ? '?' : ''}: ${f.tsType}`).join(', '),
        type: 'stream-event-detail',
        properties: {
          fields: e.fields,
        },
        sourceLine: e.line,
        sourceFile: sourceFiles[0],
      })),
    });
  }

  // --- Section: Type Guards ---
  const guardItems: DocItem[] = [];
  const guardPattern = /export function (is\w+Event)\(\s*event:\s*NormalizedStreamEvent/g;
  for (const match of regexMatchAll(content, guardPattern)) {
    const funcName = match[1];
    const line = getLineNumber(content, match.index);

    // Get the JSDoc comment
    const before = content.substring(0, match.index);
    const docMatch = before.match(/\/\*\*\s*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*$/);
    let description = `Type guard: ${funcName}`;
    if (docMatch) {
      const firstLine = docMatch[1].trim().replace(/^\*\s*/, '').split('\n')[0].trim();
      if (firstLine) description = firstLine;
    }

    guardItems.push({
      id: `guard-${funcName}`,
      name: funcName,
      description,
      type: 'type-guard',
      sourceLine: line,
      sourceFile: sourceFiles[0],
    });
  }

  sections.push({
    id: 'type-guards',
    title: 'Type Guard Helpers',
    description: `${guardItems.length} type guard functions for narrowing NormalizedStreamEvent.`,
    adminOnly: false,
    items: guardItems,
  });

  return {
    domain: 'sse-stream-events',
    title: 'SSE Stream Events',
    description: `${events.length} normalized stream event types across ${categoryGroups.size} categories, with ${guardItems.length} type guards.`,
    icon: 'code',
    category: 'core',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
