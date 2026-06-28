import { resolve, relative } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';

export interface ComposeServicesConfig {
  /** Path (relative to repo root) to the docker-compose.yml. */
  path: string;
}

type Category = 'core' | 'data' | 'mcp' | 'auxiliary';

/**
 * Categorize a compose service by name. Deliberately has NO `code`/`codemode`/
 * `exec`/`sandbox` bucket — those services don't ship, and the
 * requireNoneMatching invariant forbids them ever reappearing.
 */
function categorize(name: string): Category {
  if (/^(postgres|redis|etcd|minio|milvus)$/.test(name)) return 'data';
  if (/(^|[-_])mcp([-_]|$)|^mcp-proxy$/.test(name)) return 'mcp';
  if (/^(api|ui|workflows|mcp-proxy)$/.test(name)) return 'core';
  return 'auxiliary';
}

const CATEGORY_LABELS: Record<Category, string> = {
  core: 'Core Platform',
  data: 'Datastores',
  mcp: 'MCP / Tooling',
  auxiliary: 'Auxiliary',
};

/**
 * Source-derive the deployed services from docker-compose.yml.
 *
 * Parses the top-level `services:` map by two-space indentation (no yaml dep —
 * deterministic, offline). Emits one DocItem per service with its image (when
 * present) and a derived category.
 */
export function composeServices(config: ComposeServicesConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const abs = resolve(basePath, config.path);
    const rel = relative(basePath, abs);
    let src = '';
    try {
      src = await readFile(abs, 'utf-8');
    } catch {
      src = '';
    }

    const lines = src.split('\n');
    let inServices = false;
    let current: { name: string; image?: string } | null = null;
    const services: Array<{ name: string; image?: string }> = [];

    const flush = () => {
      if (current) services.push(current);
      current = null;
    };

    for (const raw of lines) {
      // top-level key (col 0, no leading space) ends the services block
      if (/^\S/.test(raw)) {
        if (raw.startsWith('services:')) {
          inServices = true;
          continue;
        }
        if (inServices && current) flush();
        inServices = false;
        continue;
      }
      if (!inServices) continue;

      // service name: exactly two-space indent + `name:`
      const svc = raw.match(/^ {2}([a-z0-9][a-z0-9_-]*):\s*$/);
      if (svc) {
        flush();
        current = { name: svc[1] };
        continue;
      }
      // image line within a service (4-space indent)
      const img = raw.match(/^ {4}image:\s*(.+?)\s*$/);
      if (img && current && !current.image) {
        current.image = img[1].replace(/["']/g, '');
      }
    }
    flush();

    const byCategory = new Map<Category, DocItem[]>();
    for (const s of services) {
      const cat = categorize(s.name);
      const arr = byCategory.get(cat) ?? [];
      arr.push({
        id: s.name,
        name: s.name,
        description: s.image
          ? `Service \`${s.name}\` (image: ${s.image})`
          : `Service \`${s.name}\` (image built from source)`,
        type: 'compose-service',
        properties: { category: cat, image: s.image ?? '' },
        sourceFile: rel,
      });
      byCategory.set(cat, arr);
    }

    const order: Category[] = ['core', 'mcp', 'data', 'auxiliary'];
    const sections: DocSection[] = order
      .filter((cat) => byCategory.has(cat))
      .map((cat) => ({
        id: cat,
        title: CATEGORY_LABELS[cat],
        description: `${byCategory.get(cat)!.length} ${cat} service(s)`,
        adminOnly: false,
        items: byCategory.get(cat)!.sort((a, b) => a.id.localeCompare(b.id)),
      }));

    return {
      domain: 'deployed-services',
      title: 'Deployed Services',
      description:
        'Services deployed by the compose stack, source-derived from docker-compose.yml.',
      icon: 'infra',
      category: 'infrastructure',
      generatedAt: new Date().toISOString(),
      sourceFiles: [rel],
      sections,
    };
  };
}
