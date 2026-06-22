/**
 * Skill sources — public Git repositories of SKILL.md-format agent skills that
 * the admin console can browse and import from. Ships with three curated public
 * sources (agenticwork-skills, Anthropic's skills, OpenClaw's agent-skills);
 * override the whole list with the SKILL_SOURCE_REPOS env var (a JSON array).
 *
 * Skills are discovered with the GitHub trees API (one request per repo, any
 * layout — every `**​/SKILL.md` is found) and the file bytes are read from
 * raw.githubusercontent (un-rate-limited). GITHUB_TOKEN, when set, lifts the
 * 60/hr anonymous API limit. No clone, no write — read-only fetch.
 */

export interface SkillSource {
  id: string;
  name: string;
  repo: string; // owner/name
  branch: string;
  description: string;
}

export interface RepoSkill {
  name: string;
  displayName: string;
  description: string;
  path: string; // path to the SKILL.md within the repo
}

const DEFAULT_SKILL_SOURCES: SkillSource[] = [
  {
    id: 'agenticwork',
    name: 'Agenticwork Skills',
    repo: 'agentic-work/agenticwork-skills',
    branch: 'main',
    description: 'The OpenAgentic house skill library — artifact authoring, ops runbooks, and meta-skills.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Skills',
    repo: 'anthropics/skills',
    branch: 'main',
    description: "Anthropic's official agent skills (document, artifact, and tool skills).",
  },
  {
    id: 'openclaw',
    name: 'OpenClaw Agent Skills',
    repo: 'openclaw/agent-skills',
    branch: 'main',
    description: 'Community SKILL.md skills for agents and claws (shared coding/ops workflows).',
  },
];

/** The configured skill sources. SKILL_SOURCE_REPOS (JSON array) overrides the defaults. */
export function getSkillSources(): SkillSource[] {
  const raw = process.env.SKILL_SOURCE_REPOS;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed as SkillSource[];
    } catch {
      /* fall through to defaults */
    }
  }
  return DEFAULT_SKILL_SOURCES;
}

export function getSkillSource(id: string): SkillSource | undefined {
  return getSkillSources().find((s) => s.id === id);
}

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'openagentic-skill-sources',
  };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

function rawUrl(source: SkillSource, path: string): string {
  return `https://raw.githubusercontent.com/${source.repo}/${source.branch}/${path}`;
}

/** Pull just the name + description out of a SKILL.md's YAML frontmatter, cheaply. */
function frontmatterPreview(markdown: string): { name?: string; description?: string } {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: { name?: string; description?: string } = {};
  const fm = m[1];
  const nameM = fm.match(/^name:\s*(.+)$/m);
  if (nameM) out.name = nameM[1].trim().replace(/^["']|["']$/g, '');
  // description may be a folded scalar (`>-`) spanning multiple indented lines
  const descM = fm.match(/^description:\s*(>[-+]?|\|[-+]?)?\s*([\s\S]*?)(?=^\w[\w-]*:|\Z)/m);
  if (descM) {
    out.description = descM[2]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/^["']|["']$/g, '')
      .slice(0, 400);
  }
  return out;
}

/** Discover every SKILL.md in a source repo and return name + description for each. */
export async function listRepoSkills(source: SkillSource): Promise<RepoSkill[]> {
  const treeUrl = `https://api.github.com/repos/${source.repo}/git/trees/${encodeURIComponent(source.branch)}?recursive=1`;
  const res = await fetch(treeUrl, { headers: githubHeaders() });
  if (!res.ok) {
    const hint = res.status === 403 ? ' (GitHub rate limit — set GITHUB_TOKEN to raise it)' : '';
    throw new Error(`GitHub API ${res.status} for ${source.repo}${hint}`);
  }
  const data: any = await res.json();
  const paths: string[] = (data.tree || [])
    .filter((t: any) => t.type === 'blob' && /(^|\/)SKILL\.md$/i.test(t.path))
    .map((t: any) => t.path);

  // Fetch each SKILL.md's frontmatter from raw.githubusercontent (no rate limit),
  // bounded so a huge repo doesn't fan out unboundedly.
  const limited = paths.slice(0, 200);
  const results = await Promise.allSettled(
    limited.map(async (path) => {
      const dir = path.replace(/\/?SKILL\.md$/i, '').split('/').pop() || path;
      try {
        const r = await fetch(rawUrl(source, path));
        if (!r.ok) return { name: dir, displayName: dir, description: '', path };
        const fm = frontmatterPreview(await r.text());
        return {
          name: fm.name || dir,
          displayName: fm.name || dir,
          description: fm.description || '',
          path,
        } as RepoSkill;
      } catch {
        return { name: dir, displayName: dir, description: '', path } as RepoSkill;
      }
    }),
  );
  // Dedup by skill name (a repo may vendor the same SKILL.md under multiple
  // plugin dirs) — keep the shallowest path as the canonical one.
  const byName = new Map<string, RepoSkill>();
  for (const rs of results
    .filter((r): r is PromiseFulfilledResult<RepoSkill> => r.status === 'fulfilled')
    .map((r) => r.value)) {
    const existing = byName.get(rs.name);
    if (!existing || rs.path.split('/').length < existing.path.split('/').length) byName.set(rs.name, rs);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch the raw SKILL.md bytes for a specific skill path in a source repo. */
export async function fetchRepoSkillMarkdown(source: SkillSource, path: string): Promise<string> {
  // Guard against path traversal / cross-repo fetches — only repo-relative SKILL.md paths.
  if (path.includes('..') || !/SKILL\.md$/i.test(path)) {
    throw new Error('Invalid skill path');
  }
  const r = await fetch(rawUrl(source, path));
  if (!r.ok) throw new Error(`Could not fetch ${path} from ${source.repo} (${r.status})`);
  return r.text();
}

/** Parse a SKILL.md (YAML frontmatter + body) into an AgentSkill create payload. */
export function parseSkillMarkdown(markdown: string): {
  name: string;
  display_name: string;
  description: string;
  type: string;
  definition: any;
  parameters: any;
  required_tools: string[];
  tags: string[];
} {
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) throw new Error('Invalid SKILL.md: expected YAML frontmatter between --- delimiters.');
  const frontmatterText = fmMatch[1];
  const bodyContent = fmMatch[2].trim();

  const meta: Record<string, any> = {};
  for (const line of frontmatterText.split('\n')) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let val: any = kv[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (/^\d+$/.test(val)) val = Number.parseInt(val, 10);
    else val = val.replace(/^["']|["']$/g, '');
    meta[key] = val;
  }
  if (!meta.name) throw new Error('SKILL.md frontmatter must include a "name" field.');

  return {
    name: meta.name,
    display_name: meta.display_name || meta.displayName || meta.name,
    description: meta.description || bodyContent.substring(0, 200),
    type: meta.type || 'prompt_injection',
    definition: { systemPrompt: bodyContent, ...meta },
    parameters: meta.parameters || {},
    required_tools: Array.isArray(meta.required_tools || meta.requiredTools) ? meta.required_tools || meta.requiredTools : [],
    tags: Array.isArray(meta.tags) ? meta.tags : [],
  };
}
