/**
 * B2 TDD: source-regression test — fastify.app typed via AppContext augmentation.
 *
 * Test 1: verifies AppContext.ts declares the FastifyInstance module augmentation.
 * Test 2: asserts no plugin source file uses (fastify as any).app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLUGINS_SRC = join(__dirname, '../../plugins'); // src/plugins/
const API_SRC = join(__dirname, '../..'); // src/

describe('Fix B2 — fastify.app typed via AppContext module augmentation', () => {
  it('AppContext.ts declares module augmentation for FastifyInstance.app', () => {
    const appContextPath = join(API_SRC, 'context', 'AppContext.ts');
    const content = readFileSync(appContextPath, 'utf-8');
    expect(content).toContain("declare module 'fastify'");
    expect(content).toContain('app: AppContext');
  });

  it('no plugin source file uses (fastify as any).app — all use fastify.app', () => {
    const pluginFiles = readdirSync(PLUGINS_SRC).filter(
      (f) => f.endsWith('.plugin.ts') && !f.endsWith('.test.ts'),
    );
    const violations: string[] = [];
    for (const file of pluginFiles) {
      const content = readFileSync(join(PLUGINS_SRC, file), 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Skip comment lines
        if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
        if (/\(fastify as any\)\.app/.test(line)) {
          violations.push(`${file}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(violations, `Found (fastify as any).app in:\n${violations.join('\n')}`).toHaveLength(0);
  });
});
