/**
 * Architecture gate (V3 Phase 5): EnrichedTool registry IS the SoT for
 * per-T1-tool outputTemplate + truncate_summary.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §5
 *
 * Pins two contracts:
 *   1. outputTemplate string literals appear ONLY in:
 *      - the seeder (EnrichedToolSeeder.ts — by design, ships defaults)
 *      - the FrameRendererRegistry (UI) — the consumer side
 *      - test files (we don't gate test scope)
 *      Any new occurrence in src/services or src/routes is a regression.
 *
 *   2. Every slug in EnrichedToolSeeder.SEED_ENRICHED_TOOLS_FOR_TESTS
 *      that has an outputTemplate set has a matching FrameRendererRegistry
 *      entry on the UI side, OR is documented as a known Phase-11 gap.
 *
 * The test reads files from disk (rather than importing) so it works
 * even when the schema can't compile — pure source-regression style.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const API_SRC = path.join(REPO_ROOT, 'services', 'openagentic-api', 'src');
const UI_SRC = path.join(REPO_ROOT, 'services', 'openagentic-ui', 'src');

/** Recursively walk a directory yielding .ts/.tsx files. */
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip noise dirs
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
      walk(full, out);
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** outputTemplate slugs canonical to seeded T1 tools. */
const KNOWN_OUTPUT_TEMPLATES = [
  'azure_subscription_list',
  'azure_rg_list',
  'azure_vm_list',
  'k8s_pod_list',
  'k8s_node_list',
  'aws_account_list',
  'aws_ec2_list',
  'gcp_project_list',
  'gcp_compute_list',
  'web_search_results',
  'kb_search_results',
  'tool_search_results',
  'agent_search_results',
  'request_clarification',
];

describe('EnrichedTool SoT — source regression', () => {
  it('outputTemplate slug literals are confined to the seeder + tests + UI registry', () => {
    // Only flag literals appearing in `output_template:` or `outputTemplate:`
    // assignment contexts. A slug name appearing in prose / prompt content
    // / tool-slug usage is fine — it's the SoT contract for the *template*
    // identifier we pin, not the tool name.
    const violations: Array<{ file: string; slug: string; line: number }> = [];
    const allowedFiles = new Set([
      path.join(API_SRC, 'services', 'EnrichedToolSeeder.ts'),
      path.join(UI_SRC, 'features', 'chat', 'components', 'v2', 'FrameRendererRegistry.ts'),
    ]);

    const allFiles = [
      ...walk(path.join(API_SRC, 'services')),
      ...walk(path.join(API_SRC, 'routes')),
    ];

    for (const file of allFiles) {
      // Skip allowed files + every file whose path includes /__tests__/ or .test.
      if (allowedFiles.has(file)) continue;
      if (file.includes('/__tests__/') || /\.test\.(ts|tsx)$/.test(file)) continue;

      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (const slug of KNOWN_OUTPUT_TEMPLATES) {
        // Match `output_template: 'slug'` or `outputTemplate: 'slug'` — the
        // assignment context that signals "this is a template literal for
        // EnrichedTool routing." Mere mention in prose / prompt body is OK.
        const re = new RegExp(`(?:output_template|outputTemplate)\\s*:\\s*['"\`]${slug}['"\`]`);
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) {
            violations.push({ file, slug, line: i + 1 });
          }
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map(v => `  ${v.file}:${v.line} — '${v.slug}'`)
        .join('\n');
      throw new Error(
        `EnrichedTool SoT violation — output_template literals in source MUST live only in ` +
          `EnrichedToolSeeder.ts (producer). Read from EnrichedToolService.toMetadata() instead:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });

  it('every seeded outputTemplate has a UI registry mapping (or is a known Phase-11 gap)', () => {
    const seederPath = path.join(API_SRC, 'services', 'EnrichedToolSeeder.ts');
    const registryPath = path.join(UI_SRC, 'features', 'chat', 'components', 'v2', 'FrameRendererRegistry.ts');

    expect(fs.existsSync(seederPath), 'EnrichedToolSeeder.ts must exist').toBe(true);
    expect(fs.existsSync(registryPath), 'FrameRendererRegistry.ts must exist').toBe(true);

    const seederSrc = fs.readFileSync(seederPath, 'utf8');
    const registrySrc = fs.readFileSync(registryPath, 'utf8');

    // Phase 11 gaps — these are documented in the spec as not-yet-built.
    // Phase 11 (UX primitives) builds the missing FrameRendererRegistry
    // entries for these slugs; for now they fall through to the
    // StreamingMarkdown fallback (rendering the structuredContent.summary).
    const phase11Gaps = new Set([
      'azure_subscription_list',
      'azure_rg_list',
      'aws_account_list',
      'aws_ec2_list',
      'gcp_project_list',
      'gcp_compute_list',
      'web_search_results',
      'kb_search_results',
      'tool_search_results',
      'agent_search_results',
      'request_clarification',
      'k8s_node_list',
    ]);

    // Pull every output_template literal from the seeder source.
    const tmplMatches = seederSrc.matchAll(/output_template:\s*['"]([^'"]+)['"]/g);
    const seededTemplates = new Set<string>();
    for (const m of tmplMatches) seededTemplates.add(m[1]);

    expect(seededTemplates.size).toBeGreaterThan(0);

    const missingFromRegistry: string[] = [];
    for (const slug of seededTemplates) {
      if (phase11Gaps.has(slug)) continue;
      // The UI registry maps slug → component as `slug: ComponentName,`.
      const re = new RegExp(`\\b${slug}\\s*:\\s*\\w+`);
      if (!re.test(registrySrc)) {
        missingFromRegistry.push(slug);
      }
    }

    if (missingFromRegistry.length > 0) {
      throw new Error(
        `Seeded outputTemplate slugs missing FrameRendererRegistry entry (and not on phase-11 gap list):\n` +
          missingFromRegistry.map(s => `  - ${s}`).join('\n'),
      );
    }
    expect(missingFromRegistry).toEqual([]);
  });
});
