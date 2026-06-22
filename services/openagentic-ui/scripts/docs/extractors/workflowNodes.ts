import { resolve, relative, dirname } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';
import { regexMatchAll } from '../utils';

export interface WorkflowNodesConfig {
  /** Path (relative to repo root) to the node registry that calls register(...). */
  registryPath: string;
  /** Directory (relative to repo root) holding one sub-dir per node type with a schema.json. */
  schemaDir: string;
  /** Node `type` ids that are REMOVED features and must never surface in docs. */
  deny: string[];
}

interface NodeSchema {
  type?: string;
  category?: string;
  label?: string;
  description?: string;
  icon?: string;
}

/**
 * Source-derive the registered workflow node types.
 *
 * The registry imports one `<x>SchemaJson` per node from `./<dir>/schema.json`
 * and calls `register(<x>SchemaJson, ...)` for the nodes that actually ship.
 * We:
 *   1. Parse the import map: identifier → schema dir.
 *   2. Parse the register() call list to find which identifiers are live.
 *   3. Read each live node's schema.json for type/category/label/description.
 *   4. Drop anything on the deny list (removed Code-Mode / sandbox nodes) — by
 *      both the import-dir name AND the schema's `type`, so a renamed denied
 *      node still can't leak.
 *
 * Deterministic + offline: pure file reads, no module evaluation.
 */
export function workflowNodes(config: WorkflowNodesConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const registryAbs = resolve(basePath, config.registryPath);
    const registrySrc = await readFile(registryAbs, 'utf-8');
    const deny = new Set(config.deny);

    // 1. import <ident>SchemaJson from './<dir>/schema.json'
    const importMap = new Map<string, string>(); // ident -> dir
    const importPattern =
      /import\s+(\w+)\s+from\s+['"`]\.\/([\w-]+)\/schema\.json['"`]/g;
    for (const m of regexMatchAll(registrySrc, importPattern)) {
      importMap.set(m[1], m[2]);
    }

    // 2. register(<ident>, ...)
    const registered: string[] = [];
    const registerPattern = /register\(\s*(\w+)\s*,/g;
    for (const m of regexMatchAll(registrySrc, registerPattern)) {
      if (importMap.has(m[1])) registered.push(m[1]);
    }

    const schemaBaseRel = config.schemaDir;
    const schemaBaseAbs = resolve(basePath, schemaBaseRel);

    // 3. + 4. read schema, drop denied
    const byCategory = new Map<string, DocItem[]>();
    const sourceFiles: string[] = [];

    for (const ident of registered) {
      const dir = importMap.get(ident)!;
      if (deny.has(dir)) continue; // denied by dir name

      const schemaAbs = resolve(schemaBaseAbs, dir, 'schema.json');
      let schema: NodeSchema;
      try {
        schema = JSON.parse(await readFile(schemaAbs, 'utf-8')) as NodeSchema;
      } catch {
        continue;
      }
      const nodeType = schema.type ?? dir;
      if (deny.has(nodeType)) continue; // denied by node type

      const category = schema.category || 'other';
      const rel = relative(basePath, schemaAbs);
      sourceFiles.push(rel);

      const arr = byCategory.get(category) ?? [];
      arr.push({
        id: nodeType,
        name: schema.label || nodeType,
        description:
          (schema.description || `${nodeType} workflow node`)
            .split('\n')[0]
            .trim()
            .slice(0, 280),
        type: 'workflow-node',
        properties: { nodeType, category, icon: schema.icon ?? '' },
        sourceFile: rel,
      });
      byCategory.set(category, arr);
    }

    const sections: DocSection[] = [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        id: category,
        title: category.charAt(0).toUpperCase() + category.slice(1),
        description: `${items.length} ${category} node type${items.length === 1 ? '' : 's'}`,
        adminOnly: false,
        items: items.sort((a, b) => a.id.localeCompare(b.id)),
      }));

    return {
      domain: 'node-types',
      title: 'Workflow Node Types',
      description:
        'Registered Flow canvas node types, source-derived from the workflow-engine node registry.',
      icon: 'flow',
      category: 'workflows',
      generatedAt: new Date().toISOString(),
      sourceFiles: [config.registryPath, ...sourceFiles],
      sections,
    };
  };
}
