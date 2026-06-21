import { resolve, relative } from 'path';
import { readdir, readFile, stat } from 'fs/promises';
import type { Extractor, DocManifest, DocItem } from '../types';

export interface PlatformSummaryConfig {
  /** Path (relative to repo root) to version.json. */
  versionPath: string;
  /** Parent dir holding the oap-*-mcp server dirs (relative to repo root). */
  mcpDir: string;
  /** Dir holding the seeded Flow template *.json files (relative to repo root). */
  flowTemplatesDir: string;
  /** docker-compose.yml path (relative to repo root). */
  composePath: string;
}

interface VersionJson {
  version?: string;
  codename?: string;
  releaseDate?: string;
  changelog?: Array<unknown>;
}

async function countDirsMatching(parent: string, re: RegExp): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await readdir(parent);
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (!re.test(e)) continue;
    try {
      if ((await stat(resolve(parent, e))).isDirectory()) n++;
    } catch {
      /* skip */
    }
  }
  return n;
}

async function countFiles(dir: string, suffix: string): Promise<number> {
  try {
    return (await readdir(dir)).filter((e) => e.endsWith(suffix)).length;
  } catch {
    return 0;
  }
}

/** Count top-level services in a docker-compose.yml (2-space-indented keys). */
async function countComposeServices(composeAbs: string): Promise<number> {
  let src = '';
  try {
    src = await readFile(composeAbs, 'utf-8');
  } catch {
    return 0;
  }
  let inServices = false;
  let n = 0;
  for (const raw of src.split('\n')) {
    if (/^\S/.test(raw)) {
      inServices = raw.startsWith('services:');
      continue;
    }
    if (!inServices) continue;
    if (/^ {2}[a-z0-9][a-z0-9_-]*:\s*$/.test(raw)) n++;
  }
  return n;
}

/**
 * Source-derive a single platform-summary manifest: the canonical headline
 * counts (MCP servers, Flow templates, deployed services) plus the current
 * version + codename. Emitted to public/docs/generated/platform-summary.json
 * on every build.
 *
 * Why: docs pages (Welcome / About / MCP overview) quote numbers like "9
 * built-in MCP servers" and a version string. Those were hand-typed and drift.
 * This makes them a generated FACT pinned to the real source on disk, and the
 * sync-guard test asserts each count matches what's actually in the repo.
 *
 * Deterministic + offline: dir listings + version.json read only.
 */
export function platformSummary(config: PlatformSummaryConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const versionAbs = resolve(basePath, config.versionPath);
    const mcpAbs = resolve(basePath, config.mcpDir);
    const flowAbs = resolve(basePath, config.flowTemplatesDir);
    const composeAbs = resolve(basePath, config.composePath);

    let parsed: VersionJson = {};
    try {
      parsed = JSON.parse(await readFile(versionAbs, 'utf-8')) as VersionJson;
    } catch {
      parsed = {};
    }

    const version = parsed.version ?? '0.0.0';
    const codename = parsed.codename ?? '';
    const releaseDate = parsed.releaseDate ?? '';
    const releaseCount = Array.isArray(parsed.changelog)
      ? parsed.changelog.length
      : 0;

    const mcpCount = await countDirsMatching(mcpAbs, /^oap-.*-mcp$/);
    const flowTemplateCount = await countFiles(flowAbs, '.json');
    const serviceCount = await countComposeServices(composeAbs);

    const num = (
      id: string,
      name: string,
      value: number,
      description: string,
      sourceFile: string,
    ): DocItem => ({
      id,
      name,
      description,
      type: 'summary-count',
      properties: { value, kind: 'count' },
      sourceFile,
    });

    const items: DocItem[] = [
      {
        id: 'version',
        name: 'Platform Version',
        description: `OpenAgentic ${version}${codename ? ` “${codename}”` : ''}${releaseDate ? ` (${releaseDate})` : ''}`,
        type: 'summary-version',
        properties: { version, codename, releaseDate },
        sourceFile: relative(basePath, versionAbs),
      },
      num(
        'mcp-server-count',
        'Built-in MCP Servers',
        mcpCount,
        `${mcpCount} built-in MCP server${mcpCount === 1 ? '' : 's'} under services/mcps/`,
        relative(basePath, mcpAbs),
      ),
      num(
        'flow-template-count',
        'Seeded Flow Templates',
        flowTemplateCount,
        `${flowTemplateCount} Flow template${flowTemplateCount === 1 ? '' : 's'} seeded into the workflow engine`,
        relative(basePath, flowAbs),
      ),
      num(
        'deployed-service-count',
        'Deployed Services',
        serviceCount,
        `${serviceCount} service${serviceCount === 1 ? '' : 's'} in the compose stack`,
        relative(basePath, composeAbs),
      ),
      num(
        'release-count',
        'Releases',
        releaseCount,
        `${releaseCount} release${releaseCount === 1 ? '' : 's'} recorded in version.json`,
        relative(basePath, versionAbs),
      ),
    ];

    return {
      domain: 'platform-summary',
      title: 'Platform Summary',
      description:
        'Canonical headline counts and version, source-derived from the repo on every build.',
      icon: 'brain',
      category: 'core',
      generatedAt: new Date().toISOString(),
      sourceFiles: [
        relative(basePath, versionAbs),
        relative(basePath, composeAbs),
      ],
      sections: [
        {
          id: 'summary',
          title: 'Platform Summary',
          description: 'Headline platform facts',
          adminOnly: false,
          items,
        },
      ],
    };
  };
}
