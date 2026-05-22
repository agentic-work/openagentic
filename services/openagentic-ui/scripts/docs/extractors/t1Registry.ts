import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';

export interface T1RegistryConfig {
  path: string;
  exportName: string;
}

interface ToolDef {
  constName: string;
  name?: string;
  description?: string;
}

const SECTION_LABELS: Record<string, string> = {
  Discovery: 'Discovery primitives — find tools/agents at runtime',
  'Sub-agent lifecycle': 'Spawn, send, list, stop sub-agents',
  IO: 'Read/write the outside world — web, large results, synth tools',
  Memory: 'Save and recall exemplars across sessions',
  Visualization: 'Compose visuals, apps, and artifacts',
  Clarification: 'Ask the user when intent is ambiguous',
  Other: 'Other T1 primitives',
};

function classify(constName: string): keyof typeof SECTION_LABELS {
  const n = constName;
  // Order matters:
  //   1) WEB_ catches WEB_SEARCH_TOOL (IO, not Discovery) + WEB_FETCH_TOOL
  //   2) IO primitives that are non-discovery: SYNTH, READ_LARGE
  //   3) SEARCH catches TOOL_SEARCH + AGENT_SEARCH (Discovery)
  //   4) TASK_TOOL / AGENT_ remain → Sub-agent lifecycle
  if (n.includes('WEB_')) return 'IO';
  if (n.includes('SYNTH') || n.includes('READ_LARGE')) return 'IO';
  if (n.includes('SEARCH')) return 'Discovery';
  if (n.includes('TASK_TOOL') || n.toLowerCase() === 'tasktool' || n.includes('AGENT_'))
    return 'Sub-agent lifecycle';
  if (n.includes('PATTERN')) return 'Memory';
  if (n.includes('COMPOSE') || n.includes('RENDER') || n.includes('ARTIFACT'))
    return 'Visualization';
  if (n.includes('CLARIFICATION')) return 'Clarification';
  return 'Other';
}

function extractFunctionName(src: string, constName: string): string | undefined {
  // Find: `export const FOO_TOOL = { type: 'function' as const, function: { name: 'foo', ... } }`
  const re = new RegExp(
    `(?:export\\s+)?const\\s+${constName}\\s*[:=][\\s\\S]*?function\\s*:\\s*\\{[\\s\\S]*?name:\\s*['"\`]([^'"\`]+)['"\`]`,
    'm',
  );
  return src.match(re)?.[1];
}

function extractDescription(src: string, constName: string): string | undefined {
  // Try inline string description first
  const inlineRe = new RegExp(
    `(?:export\\s+)?const\\s+${constName}\\s*[:=][\\s\\S]*?description:\\s*['"\`]([\\s\\S]*?)['"\`]`,
    'm',
  );
  const inline = src.match(inlineRe);
  if (inline) return inline[1].split('\n')[0].trim();

  // Description is a variable reference: `description: DESCRIPTION`
  const refRe = new RegExp(
    `(?:export\\s+)?const\\s+${constName}\\s*[:=][\\s\\S]*?description:\\s*([A-Z_][A-Z0-9_]*)`,
    'm',
  );
  const refMatch = src.match(refRe);
  if (!refMatch) return undefined;
  const refName = refMatch[1];

  // Find `const REFNAME = ` — string literal or array.join()
  const strDef = new RegExp(`const\\s+${refName}\\s*=\\s*['"\`]([\\s\\S]*?)['"\`]`).exec(src);
  if (strDef) return strDef[1].split('\n')[0].trim();

  const arrDef = new RegExp(
    `const\\s+${refName}\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join`,
  ).exec(src);
  if (arrDef) {
    const firstStrMatch = arrDef[1].match(/['"\`]([\s\S]*?)['"\`]/);
    if (firstStrMatch) return firstStrMatch[1].split('\n')[0].trim();
  }

  return undefined;
}

async function resolveToolDef(
  basePath: string,
  registryAbs: string,
  registrySrc: string,
  constName: string,
): Promise<ToolDef> {
  // Try in-file first
  const localName = extractFunctionName(registrySrc, constName);
  const localDesc = extractDescription(registrySrc, constName);
  if (localName || localDesc) {
    return { constName, name: localName, description: localDesc };
  }

  // Follow `import { CONST } from './path'`
  const importRe = new RegExp(
    `import\\s*\\{[^}]*\\b${constName}\\b[^}]*\\}\\s*from\\s*['"\`]([^'"\`]+)['"\`]`,
  );
  const importMatch = registrySrc.match(importRe);
  if (!importMatch) return { constName };

  const importPathRaw = importMatch[1];
  const importPath = importPathRaw.endsWith('.js')
    ? importPathRaw.slice(0, -3) + '.ts'
    : importPathRaw.endsWith('.ts')
      ? importPathRaw
      : importPathRaw + '.ts';
  const importedAbs = resolve(dirname(registryAbs), importPath);

  let importedSrc: string;
  try {
    importedSrc = await readFile(importedAbs, 'utf-8');
  } catch {
    return { constName };
  }
  return {
    constName,
    name: extractFunctionName(importedSrc, constName),
    description: extractDescription(importedSrc, constName),
  };
}

export function t1Registry(config: T1RegistryConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const registryAbs = resolve(basePath, config.path);
    const registrySrc = await readFile(registryAbs, 'utf-8');

    // Find the function body and the constants it returns
    const fnRe = new RegExp(
      `export function ${config.exportName}[\\s\\S]*?return\\s*\\[([\\s\\S]*?)\\];`,
    );
    const fnMatch = registrySrc.match(fnRe);
    if (!fnMatch) {
      throw new Error(
        `t1Registry: could not find export function ${config.exportName} in ${config.path}`,
      );
    }
    // Match SCREAMING_CASE consts AND camelCase `*Tool` identifiers (e.g. `taskTool`).
    const refs = fnMatch[1].match(/\b([A-Z][A-Z0-9_]+|[a-z][a-zA-Z]*Tool)\b/g) ?? [];
    // Collapse aliases: `taskTool` is a runtime wrapper around TASK_TOOL — treat as TASK_TOOL.
    const normalized = refs.map((r) => (r === 'taskTool' ? 'TASK_TOOL' : r));
    const uniqConstNames = Array.from(new Set(normalized));

    const tools: ToolDef[] = [];
    for (const constName of uniqConstNames) {
      const def = await resolveToolDef(basePath, registryAbs, registrySrc, constName);
      tools.push(def);
    }

    // Group into sections
    const groups: Record<string, ToolDef[]> = {};
    for (const label of Object.keys(SECTION_LABELS)) groups[label] = [];
    for (const t of tools) groups[classify(t.constName)].push(t);

    const sections: DocSection[] = [];
    for (const [title, ts] of Object.entries(groups)) {
      if (ts.length === 0) continue;
      sections.push({
        id: title.toLowerCase().replace(/\s+/g, '-'),
        title,
        description: SECTION_LABELS[title],
        adminOnly: false,
        items: ts.map((t): DocItem => ({
          id: t.constName,
          name: t.name ?? t.constName.toLowerCase().replace(/_tool(_def)?$/, ''),
          description: t.description ?? `T1 primitive: ${t.constName}`,
          type: 't1-tool',
          sourceFile: config.path,
        })),
      });
    }

    return {
      domain: 't1-tools',
      title: 'T1 Primitives',
      description:
        'Canonical agentic primitives — the Layer-2 chatmode catalog. Every chat turn ships these 16 meta-tools.',
      icon: 'brain',
      category: 'core',
      generatedAt: new Date().toISOString(),
      sourceFiles: [config.path],
      sections,
    };
  };
}
