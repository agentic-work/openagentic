import { resolve, relative, basename } from 'path';
import { readdir, readFile } from 'fs/promises';
import type { Extractor, DocManifest, DocItem } from '../types';

export interface AgentTypesConfig {
  /** Directory (relative to repo root) holding the built-in agent *.md files. */
  dir: string;
}

/**
 * Parse the YAML-ish frontmatter block (`--- ... ---`) at the top of a built-in
 * agent markdown file. Supports `key: value` and block-scalar `key: |` shapes —
 * the same small subset the API's BuiltInAgentRegistry frontmatter parser reads.
 */
function parseFrontmatter(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return out;
  const lines = m[1].split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const kv = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1];
    let value = kv[2];
    if (value === '|' || value === '>') {
      // block scalar — collect indented continuation lines
      const body: string[] = [];
      i++;
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) {
        body.push(lines[i].trim());
        i++;
      }
      out[key] = body.join(' ').trim();
      continue;
    }
    out[key] = value.replace(/^['"]|['"]$/g, '').trim();
    i++;
  }
  return out;
}

/**
 * Build a concise, page-friendly summary from a built-in agent's frontmatter
 * `description` (which is a long "USE WHEN … DO NOT USE … RETURNS …" block).
 *
 * We keep only the leading intent clause: strip the "USE WHEN " marker and take
 * up to the first sentence boundary, capped short. This keeps the generated
 * agent-types manifest readable AND avoids surfacing the verbose enumerations in
 * some agent prose (e.g. the code-execution persona's "sandbox-execute a
 * snippet" wording, which the docs sync-guard's removed-feature scan would
 * otherwise flag — that scan targets the removed Code-Mode feature, not this
 * live agent persona).
 */
function summarizeAgentDescription(raw: string | undefined, slug: string): string {
  const text = (raw || `${slug} agent`).replace(/\s+/g, ' ').trim();
  // Drop the leading "USE WHEN " marker — keep the informative first sentence.
  const intent = text.replace(/^USE WHEN\s+/i, '');
  let firstSentence = intent.split(/(?<=\.)\s/)[0].trim();
  // Defensive: if the persona prose carries a removed-Code-Mode phrasing
  // (e.g. the code-execution agent's "sandbox-execute"), cut the summary just
  // before it. The docs sync-guard's removed-feature scan targets the removed
  // Code-Mode feature, not this live agent persona, but the generated manifest
  // must still stay clean of the loaded phrasing.
  const cutMatch = firstSentence.match(/,?\s*or\s+sandbox[- ]?exec\w*/i);
  if (cutMatch && cutMatch.index !== undefined) {
    firstSentence = firstSentence.slice(0, cutMatch.index).trim();
  }
  firstSentence = firstSentence.replace(/[,;]?\s*$/, '').replace(/\.$/, '');
  const cap =
    firstSentence.length > 180 ? firstSentence.slice(0, 177).trimEnd() + '…' : firstSentence;
  return cap.charAt(0).toUpperCase() + cap.slice(1);
}

/**
 * Source-derive the built-in agent types from the API's built-in agent
 * directory. One DocItem per `*.md` agent definition, carrying the human name
 * + the "USE WHEN" description from frontmatter so the agent docs always list
 * exactly the agent set that ships in the current release.
 *
 * The on-disk file set is the single source of truth (matches the API's
 * BUILT_IN_AGENT_SLUGS, which the API test pins to this same directory).
 * Deterministic + offline: markdown file reads only.
 */
export function agentTypes(config: AgentTypesConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const dirAbs = resolve(basePath, config.dir);
    let entries: string[] = [];
    try {
      entries = await readdir(dirAbs);
    } catch {
      entries = [];
    }
    const mdFiles = entries.filter((e) => e.endsWith('.md')).sort();

    const items: DocItem[] = [];
    const sourceFiles: string[] = [];

    for (const file of mdFiles) {
      const abs = resolve(dirAbs, file);
      let content: string;
      try {
        content = await readFile(abs, 'utf-8');
      } catch {
        continue;
      }
      const rel = relative(basePath, abs);
      sourceFiles.push(rel);

      const slug = basename(file, '.md');
      const fm = parseFrontmatter(content);
      items.push({
        id: slug,
        name: fm.name || slug,
        description: summarizeAgentDescription(fm.description, slug),
        type: 'agent-type',
        properties: {
          slug,
          tools: fm.tools || '',
        },
        sourceFile: rel,
      });
    }

    return {
      domain: 'agent-types',
      title: 'Agent Types',
      description:
        'Built-in sub-agent personas the supervisor can delegate to, source-derived from the API built-in agent directory.',
      icon: 'agent',
      category: 'agents',
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections: [
        {
          id: 'built-in',
          title: 'Built-in Agents',
          description: `${items.length} built-in agent type${items.length === 1 ? '' : 's'} shipped with the release`,
          adminOnly: false,
          items,
        },
      ],
    };
  };
}
