/**
 * #2026-04-30 — docker-entrypoint must probe the configured CHAT default
 * model on Ollama (not just the embedding model). The previous probe only
 * checked nomic-embed-text, which silently passed even when gpt-oss:20b was
 * never pulled — every chat ask then quietly fell through to whatever
 * cloud model survived the route, burning tokens nobody intended to spend.
 *
 * The probe mirrors the existing embedding-probe shape but reads:
 *   CHAT_MODEL_PROBE_BASE_URL = OLLAMA_BASE_URL (the chat-pool Ollama, hal)
 *   CHAT_MODEL                = DEFAULT_CHAT_MODEL or env-resolved default
 * and curls `/api/show` (cheaper than /api/generate; doesn't load weights).
 *
 * Source-regression: read docker-entrypoint.sh as text and assert the
 * chat-model probe block exists, runs BEFORE `exec node dist/server.js`,
 * and supports a CHAT_MODEL_PROBE_REQUIRED=true escalation to non-zero
 * exit (matches the EMBEDDING_PROBE_REQUIRED pattern at line 173).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '../../../../..');
const ENTRYPOINT = resolve(REPO_ROOT, 'services/openagentic-api/docker-entrypoint.sh');

describe('docker-entrypoint probes chat default model', () => {
  const text = readFileSync(ENTRYPOINT, 'utf8');

  it('contains a chat-model probe block (via CHAT_MODEL_PROBE_REQUIRED env or curl /api/show)', () => {
    // Accept either the explicit gate variable or the API endpoint a probe
    // would use. /api/show is cheaper than /api/generate (no load) and is
    // ollama's standard "is the model on disk" check.
    const hasGateVar = /CHAT_MODEL_PROBE_REQUIRED/.test(text);
    const hasShowEndpoint = /\/api\/show/.test(text);
    expect(hasGateVar || hasShowEndpoint).toBe(true);
  });

  it('runs the chat-model probe BEFORE `exec node dist/server.js`', () => {
    const probeIdx = Math.max(
      text.search(/CHAT_MODEL_PROBE_REQUIRED/),
      text.search(/\/api\/show/),
    );
    const execIdx = text.search(/exec\s+node\s+dist\/server\.js/);
    expect(probeIdx).toBeGreaterThan(-1);
    expect(execIdx).toBeGreaterThan(-1);
    expect(probeIdx).toBeLessThan(execIdx);
  });

  it('supports CHAT_MODEL_PROBE_REQUIRED=true escalation to exit 1', () => {
    // Match the embedding-probe shape: when the gate var is true and the
    // probe fails, the script must exit non-zero so a bad chat-model
    // configuration is caught at startup, not at first user prompt.
    const reqIdx = text.search(/CHAT_MODEL_PROBE_REQUIRED/);
    expect(reqIdx).toBeGreaterThan(-1);
    // After the gate-var read site, there must be at least one `exit 1`
    // before exec. We can't exhaustively prove the conditional, but we
    // can prove an exit exists in the right region (matches the
    // existing migrate-deploy pattern's invariant at line 198).
    const tailFromGate = text.slice(reqIdx);
    const execLocal = tailFromGate.search(/exec\s+node\s+dist\/server\.js/);
    const exitLocal = tailFromGate.search(/exit\s+1/);
    expect(exitLocal).toBeGreaterThan(-1);
    expect(exitLocal).toBeLessThan(execLocal);
  });

  it('reads OLLAMA_BASE_URL or CHAT_MODEL_PROBE_BASE_URL for chat target', () => {
    // The probe must target the chat-pool Ollama (hal) — distinct from
    // the embedding pool URL set in EMBEDDING_OLLAMA_BASE_URL. Either
    // env name is acceptable.
    const matches = /(?:CHAT_MODEL_PROBE_BASE_URL|OLLAMA_BASE_URL)/.test(text);
    expect(matches).toBe(true);
  });
});
