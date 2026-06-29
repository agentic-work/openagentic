/**
 * Architecture-grep regression test: OllamaProvider must NOT log
 * `toolNames` truncated to the first 5. That field deceived us for hours
 * today — every MCP-using turn dispatches Task / compose_visual /
 * render_artifact / request_clarification / browser_sandbox_exec as the
 * first 5 tools, and slicing to 5 made the log line read identically
 * whether the array carried 6 meta tools or 6 meta + 30 azure_* tools.
 *
 * The log line MUST emit a structured `toolPrefixes` field — a count-by-
 * prefix tally — so a single log read tells you whether MCP tools are
 * actually present in the array sent to the model.
 *
 * Required shape:
 *   {
 *     toolCount: 36,
 *     toolPrefixes: { meta: 6, azure: 30, aws: 0, gcp: 0, k8s: 0, other: 0 }
 *   }
 *
 * Pinned forever — the slice-to-5 pattern must never return.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const OLLAMA_PROVIDER_PATH = resolve(
  __dirname,
  '../../services/llm-providers/OllamaProvider.ts',
);

function readSourceWithoutComments(p: string): string {
  return readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('ollama-provider-log-by-prefix', () => {
  it('OllamaProvider must NOT use slice(0, 5) on tools / request.tools', () => {
    const src = readSourceWithoutComments(OLLAMA_PROVIDER_PATH);
    // The forbidden pattern is `tools.slice(0, 5).map(...t.function?.name)`
    // or `request.tools?.slice(0, 5).map(...)` — the truncation that masks
    // MCP tool presence.
    const forbidden = /\.slice\(\s*0\s*,\s*5\s*\)\s*\.map\s*\(\s*\([^)]*\)\s*=>\s*[^)]*\.function\?\.\s*name/;
    expect(
      forbidden.test(src),
      [
        'OllamaProvider.ts contains the forbidden `.slice(0, 5).map(t => t.function?.name)`',
        'pattern. This truncation masked the cascade output as "only meta tools" for hours.',
        '',
        'Replace with a count-by-prefix tally:',
        '    const toolPrefixes = computeToolPrefixes(tools);',
        '    logger.info({ toolCount: tools.length, toolPrefixes }, "...");',
        '',
        'Where computeToolPrefixes returns {meta, azure, aws, gcp, k8s, github, other}',
        'with the 6 meta tool names recognised explicitly.',
      ].join('\n'),
    ).toBe(false);
  });

  it('OllamaProvider must emit `toolPrefixes` on the Native-tools-added log line', () => {
    const src = readSourceWithoutComments(OLLAMA_PROVIDER_PATH);
    // The Native-tools-added log line carries the model's tool array shape.
    // It MUST include `toolPrefixes:` as a structured field so debug
    // readers see counts-by-prefix at a glance.
    const hasToolPrefixes = /toolPrefixes\s*:/.test(src);
    expect(
      hasToolPrefixes,
      [
        'OllamaProvider.ts must emit a structured `toolPrefixes` field on its',
        'tool-array log lines. Without it, debug reading "[OllamaProvider]',
        'Native tools added" log line cannot tell whether MCP tools are',
        'present — the toolNames field gets sliced and looks identical for',
        'meta-only and meta+MCP arrays.',
        '',
        'Expected shape:',
        '    toolPrefixes: { meta: 6, azure: 30, aws: 0, gcp: 0, k8s: 0, github: 0, other: 0 }',
      ].join('\n'),
    ).toBe(true);
  });
});
