/**
 * Architecture gate — no regex risk tiers in production code.
 *
 * ToolApprovalGate was ripped 2026-05-11 and replaced with the simpler
 * PermissionService (Claude-Code-style allow/deny/ask globs). This gate
 * prevents any of the old regex-tier symbols from being reintroduced:
 *
 *   - DEFAULT_LOW_RISK_PATTERNS / DEFAULT_MEDIUM_RISK_PATTERNS /
 *     DEFAULT_HIGH_RISK_PATTERNS / DEFAULT_CRITICAL_RISK_PATTERNS
 *   - DANGEROUS_ARG_PATTERNS
 *   - classifyRisk (method name)
 *   - mediumRiskRequiresApproval
 *   - the class name ToolApprovalGate
 *   - the singleton accessor getToolApprovalGate
 *
 * Allowed locations are migration tombstones (none yet) + this test file.
 *
 * If a PR fails this, port the use site to PermissionService.evaluate /
 * classifyName / addRule / mode-based behavior instead of resurrecting
 * the old tiered model.
 */
import { describe, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');

function collectTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      // Skip test directories — historical tests can mention removed symbols
      // in their descriptions. This gate governs PRODUCTION source only.
      if (entry === '__tests__' || entry === 'tests') continue;
      out.push(...collectTs(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

const RIP_TARGETS = [
  // Old regex-tier constants
  'DEFAULT_LOW_RISK_PATTERNS',
  'DEFAULT_MEDIUM_RISK_PATTERNS',
  'DEFAULT_HIGH_RISK_PATTERNS',
  'DEFAULT_CRITICAL_RISK_PATTERNS',
  'DANGEROUS_ARG_PATTERNS',
  // Old method name (now classifyName)
  'classifyRisk',
  // Old config knob
  'mediumRiskRequiresApproval',
  // Old class + singleton
  'ToolApprovalGate',
  'getToolApprovalGate',
];

const ALLOWLIST = new Set<string>([
  // This file documents the rip target list.
  'src/__tests__/architecture/no-regex-risk-tiers.source-regression.test.ts',
]);

describe('PermissionService — no regex risk tiers in production code', () => {
  it('no .ts file outside the allowlist mentions the legacy regex-tier symbols', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (ALLOWLIST.has(rel)) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const hits: string[] = [];
      for (const sym of RIP_TARGETS) {
        if (content.includes(sym)) hits.push(sym);
      }
      if (hits.length > 0) offenders.push({ file: rel, matches: hits });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Legacy ToolApprovalGate regex-tier references found:\n${report}\n\n` +
          'Replace with PermissionService.evaluate / classifyName / addRule. ' +
          'Use the Claude-Code-style allow/deny/ask + 5-mode permission shape.',
      );
    }
  });

  it('ToolApprovalGate.ts file no longer exists', () => {
    const path = join(API_SRC, 'services/ToolApprovalGate.ts');
    let exists = false;
    try {
      statSync(path);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      throw new Error(
        'services/ToolApprovalGate.ts still exists. The rip 2026-05-11 deletes it. ' +
          'Run `git rm services/openagentic-api/src/services/ToolApprovalGate.ts` ' +
          '(and `src/tests/ToolApprovalGate.test.ts`), then re-run.',
      );
    }
  });

  it('PermissionService.ts exists and exports the expected surface', () => {
    const path = join(API_SRC, 'services/PermissionService.ts');
    let content = '';
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      throw new Error('services/PermissionService.ts not found — the rip replaces ToolApprovalGate.ts with this file.');
    }
    const expected = [
      'export class PermissionService',
      'getPermissionService',
      'classifyName',
      'addRule',
      'removeRule',
      'listRules',
      "type PermissionBehavior = 'allow' | 'deny' | 'ask'",
    ];
    const missing = expected.filter((s) => !content.includes(s));
    if (missing.length > 0) {
      throw new Error(
        `PermissionService.ts missing expected exports: ${missing.join(', ')}`,
      );
    }
  });
});
