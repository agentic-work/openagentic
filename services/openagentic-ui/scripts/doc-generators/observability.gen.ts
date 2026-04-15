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
 * Observability Documentation Generator
 *
 * Parses JSON dashboard files in helm/openagentic/dashboards/ to extract:
 * - Dashboard titles
 * - Panel names and types (graph, stat, table, row, etc.)
 * - Panel grouping by row
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, helmPath, relativePath, findFiles } from './utils.js';
import { basename } from 'path';

interface DashboardPanel {
  title: string;
  type: string;
  id?: number;
}

function extractPanels(content: string): DashboardPanel[] {
  const panels: DashboardPanel[] = [];

  // Parse panel objects from the JSON using regex to find "title" + "type" pairs
  const panelPattern = /"title"\s*:\s*"([^"]+)"[\s\S]*?"type"\s*:\s*"([^"]+)"/g;

  let match: RegExpExecArray | null;
  const globalPattern = new RegExp(panelPattern.source, 'g');
  while ((match = globalPattern.exec(content)) !== null) {
    const title = match[1];
    const type = match[2];
    // Skip internal Grafana types
    if (title && type && title !== 'Annotations & Alerts') {
      panels.push({ title, type });
    }
  }

  // Deduplicate by title (some panels appear in nested structures)
  const seen = new Set<string>();
  return panels.filter(p => {
    if (seen.has(p.title)) return false;
    seen.add(p.title);
    return true;
  });
}

export async function generateObservability(basePath: string): Promise<DocManifest | null> {
  const dashDir = helmPath(basePath, 'dashboards');
  const dashFiles = await findFiles(dashDir, /\.json$/);

  if (dashFiles.length === 0) return null;

  dashFiles.sort();

  const sourceFiles: string[] = [];
  const sections: DocSection[] = [];
  let totalPanels = 0;

  for (const filePath of dashFiles) {
    const content = await readFileIfExists(filePath);
    if (!content) continue;

    const relPath = relativePath(filePath, basePath);
    sourceFiles.push(relPath);
    const fileName = basename(filePath, '.json');

    // Try to extract the dashboard title from the JSON
    const titleMatch = content.match(/"title"\s*:\s*"([^"]+)"/);
    const dashTitle = titleMatch ? titleMatch[1] : fileName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const panels = extractPanels(content);
    totalPanels += panels.length;

    // Group panels by type
    const typeGroups = new Map<string, DashboardPanel[]>();
    for (const panel of panels) {
      if (!typeGroups.has(panel.type)) typeGroups.set(panel.type, []);
      typeGroups.get(panel.type)!.push(panel);
    }

    const typeSummary = [...typeGroups.entries()]
      .map(([type, items]) => `${items.length} ${type}`)
      .join(', ');

    const items: DocItem[] = panels.map(panel => ({
      id: `${fileName}-${panel.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: panel.title,
      description: `Panel type: ${panel.type}`,
      type: 'grafana-panel',
      properties: {
        panelType: panel.type,
        dashboard: fileName,
      },
      sourceFile: relPath,
    }));

    sections.push({
      id: `dash-${fileName}`,
      title: dashTitle,
      description: `${panels.length} panels (${typeSummary})`,
      adminOnly: true,
      items,
    });
  }

  // Add overview section at the beginning
  sections.unshift({
    id: 'observability-overview',
    title: 'Observability Overview',
    description: `${dashFiles.length} Grafana dashboards with ${totalPanels} total panels for monitoring the OpenAgentic platform.`,
    adminOnly: true,
    items: dashFiles.map(f => {
      const name = basename(f, '.json');
      return {
        id: `overview-${name}`,
        name: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: `Dashboard: ${name}.json`,
        type: 'grafana-dashboard',
        sourceFile: relativePath(f, basePath),
      };
    }),
  });

  return {
    domain: 'observability',
    title: 'Observability Dashboards',
    description: `${dashFiles.length} Grafana dashboards with ${totalPanels} panels covering service health, LLM performance, logs, and platform metrics.`,
    icon: 'infra',
    category: 'infrastructure',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
