/**
 * Phase 6 source-regression — chatmode dispatches Task ONLY via
 * openagentic-proxy. Phase E.8.g+h (2026-05-11) finalized the rip: the in-api
 * orchestrator class is deleted. This file's "no imports" gate is now
 * subsumed by phase-e8gh-subagent-orchestrator-deleted; this file
 * retains only the runChat.ts adapter-wiring assertions.
 *
 * Pin shape:
 *   1. runChat.ts MUST import OpenAgenticProxyClient (the new boundary).
 *   2. The runChat.ts file MUST construct the OpenAgenticProxyClient + adapter
 *      so deps.runSubagent is overridden before the v2Deps bundle is built.
 *
 * the design notes
 */
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiSrc = resolve(__dirname, '../..');

describe('arch: chatmode dispatches Task ONLY via openagentic-proxy', () => {
  it('runChat.ts imports OpenAgenticProxyClient', () => {
    const path = `${apiSrc}/routes/chat/pipeline/chat/runChat.ts`;
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, 'utf8');
    expect(src).toMatch(/OpenAgenticProxyClient/);
  });

  it('runChat.ts wires deps.runSubagent through the OpenAgenticProxyClient adapter', () => {
    const path = `${apiSrc}/routes/chat/pipeline/chat/runChat.ts`;
    const src = readFileSync(path, 'utf8');
    // The override pattern: a local function or const that adapts
    // OpenAgenticProxyClient.executeAgent to the runSubagent signature.
    expect(src).toMatch(/runSubagent[\s:]+(openagenticProxyAdapter|proxyRunSubagent|makeOpenAgenticProxyRunSubagent)/);
  });
});
