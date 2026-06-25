#!/usr/bin/env npx tsx
/**
 * Unified docs generator.
 *
 * Replaces scripts/generate-docs.ts and scripts/doc-generators/*.gen.ts.
 *
 * Flow:
 *   1. Iterate DOMAINS from manifest.ts
 *   2. For each: run extractor → run invariants → write JSON if all pass
 *   3. After all domains: write index.json + _version.json
 *   4. Exit non-zero if any extractor or invariant failed (FAIL HARD)
 *
 * The fail-hard mode is the entire point: broken docs cannot ship. If a new
 * MCP / T1 tool / chat pipeline file lands and the docs don't auto-include
 * it, `npm run build` fails — CI rejects the PR.
 */

import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import type { DocManifest, DocsIndex } from './types';
import { DOMAINS } from './manifest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(__dirname, '..', '..');
const AGENTIC_ROOT = resolve(UI_ROOT, '..', '..');
const OUTPUT_DIR = resolve(UI_ROOT, 'public', 'docs', 'generated');

const CATEGORIES = [
  { id: 'core', title: 'Core Platform', icon: 'brain' },
  { id: 'agents', title: 'Agents', icon: 'agent' },
  { id: 'tools', title: 'MCP & Tools', icon: 'tool' },
  { id: 'workflows', title: 'Workflows', icon: 'flow' },
  { id: 'security', title: 'Security', icon: 'shield' },
  { id: 'infrastructure', title: 'Infrastructure', icon: 'infra' },
  { id: 'ui', title: 'UI & Modes', icon: 'code' },
];

/**
 * Remove volatile fields before hashing — preserves the content-addressable
 * property from the legacy generator. Without this, `new Date().toISOString()`
 * timestamps in every manifest flip the hash on every build, defeating the
 * API-side reconcile skip path (RAGInitService re-embeds only on hash change).
 */
function stripVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'generatedAt') continue;
      out[k] = stripVolatileFields(v);
    }
    return out;
  }
  return value;
}

interface DomainFailure {
  domain: string;
  kind: 'extractor' | 'invariant';
  message: string;
  missing?: string[];
}

async function main() {
  const startTime = Date.now();
  console.log('=== OpenAgentic Unified Docs Generator ===');
  console.log(`  Base path: ${AGENTIC_ROOT}`);
  console.log(`  Output:    ${OUTPUT_DIR}`);
  console.log(`  Domains:   ${DOMAINS.length}`);
  console.log('');

  await mkdir(OUTPUT_DIR, { recursive: true });

  const manifests: DocManifest[] = [];
  const failures: DomainFailure[] = [];
  const manifestFingerprints: Array<{
    name: string;
    hash: string;
    bytes: number;
    generatedAt: string;
  }> = [];

  for (const domain of DOMAINS) {
    const t = Date.now();
    let manifest: DocManifest;
    try {
      manifest = await domain.extractor(AGENTIC_ROOT);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ domain: domain.domain, kind: 'extractor', message: msg });
      console.log(`  [FAIL] ${domain.domain}: extractor — ${msg}`);
      continue;
    }

    let domainOk = true;
    for (const invariant of domain.invariants) {
      const result = await invariant(manifest, AGENTIC_ROOT);
      if (!result.ok) {
        failures.push({
          domain: domain.domain,
          kind: 'invariant',
          message: result.message,
          missing: result.missing,
        });
        domainOk = false;
      }
    }

    if (!domainOk) {
      console.log(`  [FAIL] ${domain.domain}: invariant(s) failed`);
      continue;
    }

    const outputPath = resolve(OUTPUT_DIR, `${domain.domain}.json`);
    const payload = JSON.stringify(manifest, null, 2);
    await writeFile(outputPath, payload);
    manifests.push(manifest);
    manifestFingerprints.push({
      name: domain.domain,
      hash:
        'sha256:' +
        createHash('sha256')
          .update(JSON.stringify(stripVolatileFields(manifest)))
          .digest('hex'),
      bytes: Buffer.byteLength(payload, 'utf8'),
      generatedAt: manifest.generatedAt,
    });
    console.log(
      `  [OK]   ${domain.domain} (${manifest.sections.length} sections, ${manifest.sections.reduce((s, sec) => s + sec.items.length, 0)} items, ${Date.now() - t}ms)`,
    );
  }

  if (failures.length > 0) {
    console.error('');
    console.error('=== FAILURES ===');
    for (const f of failures) {
      console.error(`[${f.domain}] (${f.kind}) ${f.message}`);
      if (f.missing?.length) {
        console.error(
          `  missing: ${f.missing.slice(0, 10).join(', ')}${
            f.missing.length > 10 ? ` (+${f.missing.length - 10} more)` : ''
          }`,
        );
      }
    }
    console.error('');
    console.error(
      `Generator FAILED — ${failures.length} failure(s) across ${new Set(failures.map((f) => f.domain)).size} domain(s).`,
    );
    console.error('Broken docs cannot ship. Fix the extractors or invariants above.');
    process.exit(1);
  }

  // ---------- index.json (sidebar + manifest list) ----------
  let version = '0.0.0';
  let codename = '';
  const versionJsonCandidates = [
    resolve(AGENTIC_ROOT, 'version.json'),
    resolve(UI_ROOT, 'version.json'),
    '/repo/version.json',
  ];
  for (const path of versionJsonCandidates) {
    try {
      const raw = await import(path, { with: { type: 'json' } });
      if (raw.default?.version) {
        version = raw.default.version;
        codename = raw.default.codename || '';
        break;
      }
    } catch {
      /* try next */
    }
  }

  const index: DocsIndex = {
    generatedAt: new Date().toISOString(),
    version,
    codename,
    categories: CATEGORIES,
    manifests: manifests.map((m) => ({
      domain: m.domain,
      title: m.title,
      description: m.description,
      category: m.category,
      file: `${m.domain}.json`,
      sectionCount: m.sections.length,
      itemCount: m.sections.reduce((sum, s) => sum + (s.items?.length ?? 0), 0),
      adminOnly: m.sections.every((s) => s.adminOnly),
    })),
  };
  await writeFile(
    resolve(OUTPUT_DIR, 'index.json'),
    JSON.stringify(index, null, 2),
  );

  // ---------- _version.json (manifest fingerprint for API RAG reconcile) ----------
  const sortedPairs = manifestFingerprints
    .map(({ name, hash }) => ({ name, hash }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const manifestHash =
    'sha256:' +
    createHash('sha256').update(JSON.stringify(sortedPairs)).digest('hex');

  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse --short HEAD', {
      cwd: AGENTIC_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    /* no git available */
  }

  await writeFile(
    resolve(OUTPUT_DIR, '_version.json'),
    JSON.stringify(
      {
        version: `v${version}-${gitSha}`,
        generatedAt: index.generatedAt,
        manifestHash,
        manifestCount: manifestFingerprints.length,
        manifests: manifestFingerprints
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
      null,
      2,
    ),
  );

  const totalSections = manifests.reduce((s, m) => s + m.sections.length, 0);
  const totalItems = manifests.reduce(
    (s, m) => s + m.sections.reduce((ss, sec) => ss + sec.items.length, 0),
    0,
  );
  console.log('');
  console.log('=== Summary ===');
  console.log(`  Generated: ${manifests.length} manifests`);
  console.log(`  Sections:  ${totalSections}`);
  console.log(`  Items:     ${totalItems}`);
  console.log(`  Hash:      ${manifestHash}`);
  console.log(`  Time:      ${Date.now() - startTime}ms`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
