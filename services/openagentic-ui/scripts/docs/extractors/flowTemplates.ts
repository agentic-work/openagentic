import { resolve, relative, basename } from 'path';
import { readdir, readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocItem } from '../types';

export interface FlowTemplatesConfig {
  /** Directory (relative to repo root) holding seed Flow template *.json files. */
  dir: string;
}

interface FlowTemplateJson {
  slug?: string;
  name?: string;
  description?: string;
  category?: string;
  meta?: { tools_used?: string[] };
  definition?: { nodes?: Array<{ type?: string }> };
}

/**
 * Source-derive the seeded Flow templates from the workflow-engine seed dir.
 *
 * One DocItem per template JSON, carrying the node types + MCP tools it uses so
 * the Flows docs always list exactly what ships in the current release.
 * Deterministic + offline: JSON file reads only.
 */
export function flowTemplates(config: FlowTemplatesConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const dirAbs = resolve(basePath, config.dir);
    let entries: string[] = [];
    try {
      entries = await readdir(dirAbs);
    } catch {
      entries = [];
    }
    const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();

    const items: DocItem[] = [];
    const sourceFiles: string[] = [];

    for (const file of jsonFiles) {
      const abs = resolve(dirAbs, file);
      let tpl: FlowTemplateJson;
      try {
        tpl = JSON.parse(await readFile(abs, 'utf-8')) as FlowTemplateJson;
      } catch {
        continue;
      }
      const rel = relative(basePath, abs);
      sourceFiles.push(rel);

      const slug = tpl.slug || basename(file, '.json');
      const nodeTypes = Array.from(
        new Set((tpl.definition?.nodes ?? []).map((n) => n.type).filter(Boolean) as string[]),
      ).sort();
      const toolsUsed = Array.from(new Set(tpl.meta?.tools_used ?? [])).sort();

      items.push({
        id: slug,
        name: tpl.name || slug,
        description:
          (tpl.description || `${slug} flow template`).split('\n')[0].trim().slice(0, 400),
        type: 'flow-template',
        properties: {
          category: tpl.category || 'general',
          nodeTypesUsed: nodeTypes,
          toolsUsed,
        },
        sourceFile: rel,
      });
    }

    return {
      domain: 'flow-templates',
      title: 'Flow Templates',
      description:
        'Pre-built Flow templates seeded into the workflow engine, source-derived from the seed directory.',
      icon: 'flow',
      category: 'workflows',
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections: [
        {
          id: 'templates',
          title: 'Seeded Templates',
          description: `${items.length} Flow template${items.length === 1 ? '' : 's'} shipped with the release`,
          adminOnly: false,
          items,
        },
      ],
    };
  };
}
