// B3 source-regression test: plugins, startup steps, services, and routes
// must not read MCP_PROXY_ENABLED, K8S_NAMESPACE, CODE_MANAGER_INTERNAL_KEY,
// OPENAGENTIC_INTERNAL_KEY, or INTERNAL_API_KEY directly from process.env.
// Use featureFlags.* for the boolean/string flags, getInternalKey() from
// utils/internalKeyReader for the rotated internal key (#416 + #424).
//
// Scopes: src/plugins, src/startup, src/services, src/routes (non-test
// files, excluding featureFlags.ts + internalKeyReader.ts).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const API_SRC = join(__dirname, '../..'); // src/

const BANNED_ENV_PATTERN =
  /process\.env\.(MCP_PROXY_ENABLED|K8S_NAMESPACE|CODE_MANAGER_INTERNAL_KEY|OPENAGENTIC_INTERNAL_KEY|INTERNAL_API_KEY)\b/;

/** Recursively collect all .ts files (non-test) from a directory. */
function collectTs(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
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
      // Skip __tests__ subdirectories
      if (entry === '__tests__') continue;
      results.push(...collectTs(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.spec.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('featureFlags consumers — no direct process.env reads in plugins/startup/services', () => {
  it('src/plugins/*.ts contains no direct process.env.{MCP_PROXY_ENABLED|K8S_NAMESPACE|CODE_MANAGER_INTERNAL_KEY}', () => {
    const files = readdirSync(join(API_SRC, 'plugins'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(API_SRC, 'plugins', f));

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, idx) => {
        if (BANNED_ENV_PATTERN.test(line) && !line.trimStart().startsWith('//')) {
          violations.push(`${file.replace(API_SRC + '/', '')}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('src/startup/*.ts contains no direct process.env.{MCP_PROXY_ENABLED|K8S_NAMESPACE|CODE_MANAGER_INTERNAL_KEY}', () => {
    const files = readdirSync(join(API_SRC, 'startup'))
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .map((f) => join(API_SRC, 'startup', f));

    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, idx) => {
        if (BANNED_ENV_PATTERN.test(line) && !line.trimStart().startsWith('//')) {
          violations.push(`${file.replace(API_SRC + '/', '')}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('src/services/**/*.ts (non-test) contains no direct process.env reads of the banned flags', () => {
    const files = collectTs(join(API_SRC, 'services'));

    const violations: string[] = [];
    for (const file of files) {
      // Skip featureFlags.ts itself (that's where definitions live)
      if (file.includes('featureFlags')) continue;
      const content = readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, idx) => {
        if (BANNED_ENV_PATTERN.test(line) && !line.trimStart().startsWith('//')) {
          violations.push(`${file.replace(API_SRC + '/', '')}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Violations:\n${violations.join('\n')}`).toHaveLength(0);
  });

  it('src/routes/**/*.ts (non-test) contains no direct process.env reads of the banned flags', () => {
    const files = collectTs(join(API_SRC, 'routes'));

    const violations: string[] = [];
    for (const file of files) {
      // utils/internalKeyReader.ts is the canonical fallback site for
      // INTERNAL_API_KEY / OPENAGENTIC_INTERNAL_KEY / CODE_MANAGER_INTERNAL_KEY.
      // routes/** must call getInternalKey() instead of reading env directly.
      if (file.includes('internalKeyReader')) continue;
      const content = readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, idx) => {
        // Skip pure comment lines and JSDoc lines that just *reference* the var.
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        if (BANNED_ENV_PATTERN.test(line)) {
          violations.push(`${file.replace(API_SRC + '/', '')}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Violations:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
