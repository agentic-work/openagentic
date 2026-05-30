/**
 * Real-provider NDJSON fixture loader for the chatmode wire-shape harness.
 *
 * Per [[feedback_no_synthetic_chunks_only_real_provider_captures]] — never
 * hand-author chunks. Every fixture under
 *   reports/verify-cadence/Q-loop-post-811-604acc6d/*.ndjson
 * is the actual NDJSON our /api/chat/stream emitted to a real customer
 * shaped prompt, captured against chat-dev with a real admin OBO key.
 *
 * If a fixture isn't present (operator hasn't captured it yet), the
 * harness SKIPS the test with a loud warn — same regime as the SDK
 * probe runner. We never substitute synthetic chunks.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface WireFrame {
  type: string;
  [k: string]: unknown;
}

export interface NDJSONFixture {
  /** Customer-shaped prompt this fixture was captured against. */
  prompt: string;
  /** Path to the .ndjson on disk (relative to repo root). */
  path: string;
  /** Parsed frames, in wire-emit order. */
  frames: WireFrame[];
}

/**
 * Resolve repo root by walking up from this file until we find a
 * `services/` sibling. Test harness must be portable across worktrees.
 */
function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'services')) && fs.existsSync(path.join(dir, 'mocks'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate repo root from ' + __dirname);
}

export function loadNDJSONFixture(
  relPath: string,
  prompt: string,
): NDJSONFixture | null {
  const abs = path.join(repoRoot(), relPath);
  if (!fs.existsSync(abs)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[wireShape] SKIP — fixture not present at ${relPath}.\n` +
        '          Re-capture via:\n' +
        '          curl -sk -N -X POST https://chat-dev.openagentic.io/api/chat/stream \\\n' +
        '            -H "Authorization: Bearer $ADMIN_KEY" \\\n' +
        `            -H "Content-Type: application/json" \\\n` +
        `            -d '{"sessionId":"<sid>","message":"${prompt}","stream":true}' \\\n` +
        `            -o ${relPath}`,
    );
    return null;
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const frames: WireFrame[] = [];
  for (const line of lines) {
    try {
      frames.push(JSON.parse(line));
    } catch {
      // tolerate trailing CR / stray newlines silently
    }
  }
  return { prompt, path: relPath, frames };
}

/**
 * Canonical Q1 capture: Azure subscriptions + resource groups via admin OBO.
 * Real wire from chat-dev, 2026-05-14, claude-sonnet-4-6 via Bedrock.
 * 815 frames · success=true.
 */
export const Q1_AZURE_SUBS_RGS_FIXTURE = {
  prompt: "show me my Azure subscriptions and what's in each resource group",
  path: 'reports/verify-cadence/Q-loop-post-811-604acc6d/Q1-admin-obo.ndjson',
} as const;
