import { resolve, relative, basename } from 'path';
import { readdir, readFile, stat } from 'fs/promises';
import type { Extractor, DocManifest, DocSection, DocItem } from '../types';

export interface UserGuidesConfig {
  /**
   * Directories (relative to the repo root) holding hand-written prose guides.
   * Scanned non-recursively for `*.md`. The first dir is the primary guide
   * tree; the rest are sibling guide locations. Order is preserved so the
   * primary guide section sorts first.
   */
  dirs: string[];
  /** domain id (e.g. 'user-guides') */
  domain: string;
  title: string;
  description: string;
  icon: string;
  category: string;
}

/**
 * Parse a leading YAML-ish frontmatter block (`--- ... ---`) if present.
 *
 * The repo's guides currently start with a `# Heading` (no frontmatter), so
 * this returns `{}` for them and the title/description fall back to the markdown
 * body. We still parse frontmatter so a guide that later adds `title:` /
 * `description:` is honoured. Supports the same small `key: value` + block-scalar
 * subset as the built-in agent frontmatter parser.
 */
function parseFrontmatter(md: string): { fm: Record<string, string>; body: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: md };
  const fm: Record<string, string> = {};
  const lines = m[1].split('\n');
  let i = 0;
  while (i < lines.length) {
    const kv = lines[i].match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1];
    const value = kv[2];
    if (value === '|' || value === '>') {
      const block: string[] = [];
      i++;
      while (i < lines.length && (/^\s+/.test(lines[i]) || lines[i].trim() === '')) {
        block.push(lines[i].trim());
        i++;
      }
      fm[key] = block.join(' ').trim();
      continue;
    }
    fm[key] = value.replace(/^['"]|['"]$/g, '').trim();
    i++;
  }
  return { fm, body: md.slice(m[0].length) };
}

/** First `# ` (h1) heading in the markdown body, if any. */
function firstH1(body: string): string | null {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

/**
 * First real prose paragraph: the first block of non-blank lines that is not a
 * heading, list, code-fence, blockquote, table, or horizontal rule. Markdown
 * emphasis/link syntax is lightly stripped and the result is capped for a
 * sidebar-friendly summary.
 */
function firstParagraph(body: string): string | null {
  const blocks = body.split(/\n\s*\n/);
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const first = block.split('\n')[0].trim();
    if (
      first.startsWith('#') ||
      first.startsWith('```') ||
      first.startsWith('>') ||
      first.startsWith('|') ||
      first.startsWith('---') ||
      first.startsWith('***') ||
      /^[-*+]\s/.test(first) ||
      /^\d+\.\s/.test(first)
    ) {
      continue;
    }
    const flat = block
      .replace(/\n/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/\*([^*]*)\*/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (flat) return flat;
  }
  return null;
}

function capDescription(text: string): string {
  return text.length > 280 ? text.slice(0, 277).trimEnd() + '…' : text;
}

/**
 * Source-derive the hand-written prose guides (docs/guide/*.md + sibling
 * top-level guides) so the documentation manifests reflect ALL source — not just
 * the system-generated facts. One DocItem per guide `.md`, carrying the derived
 * title, a short description, and the FULL markdown content (in
 * `properties.content`) so the doc RAG agent ingests the prose verbatim.
 *
 * Guides are grouped into sections by their directory. The on-disk `*.md` set is
 * the single source of truth.
 *
 * Strict contract (matches the generator's fail-hard mode): throws if no guides
 * are found, or if any guide is empty / yields no derivable title — a malformed
 * guide must fail the build rather than ship a blank doc entry.
 *
 * Deterministic + offline: markdown file reads only, no network.
 */
export function userGuides(config: UserGuidesConfig): Extractor {
  return async (basePath: string): Promise<DocManifest> => {
    const sections: DocSection[] = [];
    const sourceFiles: string[] = [];
    let totalItems = 0;

    for (const dir of config.dirs) {
      const dirAbs = resolve(basePath, dir);
      let entries: string[];
      try {
        entries = await readdir(dirAbs);
      } catch {
        // A configured guide dir that doesn't exist is skipped (graceful) — the
        // overall "no guides at all" case is the hard failure below.
        continue;
      }

      const mdFiles: string[] = [];
      for (const e of entries) {
        if (!e.endsWith('.md')) continue;
        const s = await stat(resolve(dirAbs, e));
        if (s.isFile()) mdFiles.push(e);
      }
      mdFiles.sort((a, b) => a.localeCompare(b));
      if (mdFiles.length === 0) continue;

      const items: DocItem[] = [];
      for (const file of mdFiles) {
        const abs = resolve(dirAbs, file);
        const rel = relative(basePath, abs);
        const content = await readFile(abs, 'utf-8');

        if (content.trim().length === 0) {
          throw new Error(`userGuides: empty guide file: ${rel}`);
        }

        const { fm, body } = parseFrontmatter(content);
        const slug = basename(file, '.md');

        const title = (fm.title || firstH1(body) || slug).trim();
        if (!title) {
          throw new Error(`userGuides: could not derive a title for guide: ${rel}`);
        }

        const descSource = fm.description || firstParagraph(body) || title;
        const description = capDescription(descSource.trim());
        if (!description) {
          throw new Error(`userGuides: could not derive a description for guide: ${rel}`);
        }

        sourceFiles.push(rel);
        items.push({
          id: `${dir.replace(/\//g, '-')}--${slug}`,
          name: title,
          description,
          type: 'user-guide',
          properties: {
            slug,
            dir,
            // The full markdown so the doc RAG agent ingests the prose verbatim.
            content,
          },
          sourceFile: rel,
        });
      }

      totalItems += items.length;
      const sectionDir = basename(dir);
      sections.push({
        id: dir.replace(/\//g, '-'),
        title:
          sectionDir.charAt(0).toUpperCase() + sectionDir.slice(1).replace(/[-_]/g, ' '),
        description: `${items.length} hand-written guide${items.length === 1 ? '' : 's'} from ${dir}/`,
        adminOnly: false,
        items,
      });
    }

    if (totalItems === 0) {
      throw new Error(
        `userGuides: no guide *.md files found under any of: ${config.dirs.join(', ')}`,
      );
    }

    return {
      domain: config.domain,
      title: config.title,
      description: config.description,
      icon: config.icon,
      category: config.category,
      generatedAt: new Date().toISOString(),
      sourceFiles,
      sections,
    };
  };
}
