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
 * Admin Portal Documentation Generator
 *
 * Parses services/openagentic-ui/src/features/admin/components/Shell/AdminPortal.tsx to extract:
 * - Sidebar items (id, label, children) from the sidebarItems array
 * - Navigation structure of the admin portal
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, getLineNumber, regexMatchAll } from './utils.js';

interface SidebarEntry {
  id: string;
  label: string;
  children: Array<{ id: string; label: string; badge?: string; externalUrl?: string }>;
  line: number;
}

export async function generateAdminPortal(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(
    basePath,
    'openagentic-ui',
    'src',
    'features',
    'admin',
    'components',
    'Shell',
    'AdminPortal.tsx',
  );
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // Find the sidebarItems array
  const arrayStart = content.indexOf('const sidebarItems: SidebarItem[] = [');
  if (arrayStart === -1) return null;

  // Extract the array contents (find the matching closing bracket)
  let depth = 0;
  let arrayEnd = -1;
  const searchStart = content.indexOf('[', arrayStart);
  for (let i = searchStart; i < content.length; i++) {
    if (content[i] === '[') depth++;
    if (content[i] === ']') {
      depth--;
      if (depth === 0) {
        arrayEnd = i + 1;
        break;
      }
    }
  }

  if (arrayEnd === -1) return null;

  const arrayContent = content.substring(searchStart, arrayEnd);

  // Parse top-level sidebar items using regex
  // Match: { id: 'xxx', label: 'Yyy', icon: ZzzIcon, children: [...] }
  // and also spread items: ...( condition ? [{ id: 'xxx', ... }] : [])
  const entries: SidebarEntry[] = [];

  // Strategy: find all id+label pairs at the top level of the sidebarItems array
  // Top-level items have id: 'xxx' that appear with certain indentation
  const itemPattern = /\{\s*\n?\s*id:\s*'([^']+)'\s*,\s*\n?\s*label:\s*'([^']+)'/g;
  const allMatches = regexMatchAll(arrayContent, itemPattern);

  // We need to determine which items are top-level vs children
  // Top-level items are those followed by `icon:` and optionally `children:`
  // Children items are nested inside a `children: [...]` block

  // Alternative approach: find all items with children arrays
  const topItemPattern = /\{\s*\n\s+id:\s*'([^']+)',\s*\n\s+label:\s*'([^']+)',\s*\n\s+icon:\s*\w+(?:,\s*\n\s+children:\s*\[([\s\S]*?)\]\s*\}|\s*\})/g;
  for (const match of regexMatchAll(arrayContent, topItemPattern)) {
    const id = match[1];
    const label = match[2];
    const childrenBlock = match[3] || '';
    const line = getLineNumber(content, arrayStart + match.index);

    const children: SidebarEntry['children'] = [];
    if (childrenBlock) {
      // Parse children: { id: 'xxx', label: 'Yyy', ... }
      const childPattern = /\{\s*id:\s*'([^']+)',\s*label:\s*'([^']+)'(?:.*?badge:\s*'([^']+)')?(?:.*?externalUrl:\s*'([^']+)')?/g;
      for (const cm of regexMatchAll(childrenBlock, childPattern)) {
        children.push({
          id: cm[1],
          label: cm[2],
          badge: cm[3],
          externalUrl: cm[4],
        });
      }
    }

    entries.push({ id, label, children, line });
  }

  // --- Section 1: Navigation Overview ---
  const totalLeafItems = entries.reduce((sum, e) => sum + (e.children.length > 0 ? e.children.length : 1), 0);
  sections.push({
    id: 'nav-overview',
    title: 'Admin Portal Navigation',
    description: `${entries.length} top-level sections with ${totalLeafItems} total navigation items.`,
    adminOnly: true,
    items: entries.map(e => ({
      id: `section-${e.id}`,
      name: e.label,
      description: e.children.length > 0
        ? `${e.children.length} sub-items: ${e.children.map(c => c.label).join(', ')}`
        : 'Single-page section (no children)',
      type: 'nav-section',
      properties: {
        sidebarId: e.id,
        childCount: e.children.length,
      },
      sourceLine: e.line,
      sourceFile: sourceFiles[0],
    })),
  });

  // --- Section 2+: Per-section details ---
  for (const entry of entries) {
    if (entry.children.length === 0) continue;

    sections.push({
      id: `section-${entry.id}`,
      title: entry.label,
      description: `${entry.children.length} admin views in the ${entry.label} section.`,
      adminOnly: true,
      items: entry.children.map(child => ({
        id: `nav-${child.id}`,
        name: child.label,
        description: [
          `Navigation ID: ${child.id}`,
          child.badge ? `Badge: ${child.badge}` : null,
          child.externalUrl ? `External: ${child.externalUrl}` : null,
        ].filter(Boolean).join(' | '),
        type: 'nav-item',
        properties: {
          sidebarId: child.id,
          parentSection: entry.id,
          badge: child.badge,
          externalUrl: child.externalUrl,
        },
      })),
    });
  }

  return {
    domain: 'admin-portal',
    title: 'Admin Portal',
    description: `Admin portal with ${entries.length} navigation sections and ${totalLeafItems} views.`,
    icon: 'code',
    category: 'ui',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
