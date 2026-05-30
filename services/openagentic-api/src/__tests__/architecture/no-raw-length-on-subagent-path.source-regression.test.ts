/**
 * Sev-0 #927 (2026-05-17) — regression pin for raw `.length` access on
 * sub-agent dispatch path fields that may legitimately be undefined.
 *
 * Live failure on `0.7.1-87b85a9b`: `cloud_operations` sub-agent crashed
 * at 4.6s with `Cannot read properties of undefined (reading 'length')`
 * because the chat-side `OpenAgenticProxyClient` shipped a body to openagentic-proxy
 * WITHOUT `userGroups`, and the proxy's `AgentRunner.buildAuthHeaders`
 * accessed `ctx.userGroups.length` without an optional chain.
 *
 * Defense-in-depth contract pinned here:
 *
 *   (1) api side — `OpenAgenticProxyClient.ts` MUST forward safe defaults for
 *       `userGroups`, `authMethod`, and `isAdmin` in the body it sends
 *       to /api/agents/execute-sync. Pinned via string-presence grep so
 *       a future refactor that drops the defaults trips this test.
 *
 *   (2) Any chatmode-side source file that accesses `.length` on a
 *       known-risky field name (the field names live-caught in prior
 *       length-crash fixes — see TaskTool.ts:286/453/459,
 *       TaskJustificationValidator.ts:108, makeRunSubagentViaRecursor.ts:329,
 *       chatLoopRecursor.ts:271) MUST either (a) guard with optional
 *       chain `?.length`, (b) precede the access with an `Array.isArray`
 *       or truthy check on the same identifier in the same expression,
 *       or (c) carry a `// SAFE-LENGTH:` marker comment within 2 lines.
 *
 * Scope is intentionally narrow: only chatmode sub-agent dispatch files
 * + the api-side proxy client. Broader length-hygiene is out of scope —
 * this regression pin guards the exact class of bug live-caught in
 * #927.
 */
import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiSrc = resolve(__dirname, '../..');

describe('arch #927: OpenAgenticProxyClient body ships safe identity defaults', () => {
  // Pinned to the exact field names. Refactor that renames userGroups
  // would also need to update this test — that's the point: the contract
  // gets re-considered, not silently dropped.
  const REQUIRED_DEFAULTS = ['userGroups', 'authMethod', 'isAdmin'] as const;

  it('OpenAgenticProxyClient.ts source forwards safe defaults to /api/agents/execute-sync', () => {
    const path = `${apiSrc}/services/OpenAgenticProxyClient.ts`;
    expect(existsSync(path)).toBe(true);
    const src = readFileSync(path, 'utf8');
    for (const field of REQUIRED_DEFAULTS) {
      expect(
        src,
        `OpenAgenticProxyClient.ts must forward a safe default for ${field} in the body it sends to openagentic-proxy. ` +
          `Without it, AgentRunner.buildAuthHeaders crashes on a length-on-undefined access mid-tool-loop ` +
          `(Sev-0 #927, observed live on 0.7.1-87b85a9b).`,
      ).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});

describe('arch #927: no raw .length access on chatmode sub-agent path fields', () => {
  // Field names that have historically been live-caught producing
  // undefined-.length crashes on the sub-agent path. New entries here are
  // the load-bearing signal — if a field gets added to the path that can
  // be undefined, list it here so the grep catches it.
  const RISKY_FIELDS = [
    'userGroups',
    'toolCalls',
    'toolResults',
    'tool_uses',
    'toolsUsed',
    'toolCallsExecuted',
    'errors',
    'related_alerts',
    'discoveredTools',
    'discoveredAgents',
  ] as const;

  // Files in scope. The list is narrow on purpose — this test gates the
  // chatmode sub-agent dispatch path, not the whole codebase.
  const FILES_IN_SCOPE = [
    'services/TaskTool.ts',
    'services/TaskJustificationValidator.ts',
    'services/makeRunSubagentViaRecursor.ts',
    'services/chatLoopRecursor.ts',
    'services/OpenAgenticProxyClient.ts',
    'services/taskOutputSchemas.ts',
  ];

  for (const rel of FILES_IN_SCOPE) {
    it(`${rel} — no raw .length access on risky fields`, () => {
      const path = `${apiSrc}/${rel}`;
      if (!existsSync(path)) return; // file may have been moved; gate is best-effort
      const src = readFileSync(path, 'utf8');
      const lines = src.split('\n');

      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        for (const field of RISKY_FIELDS) {
          // Match BARE `.field.length` (no leading optional chain) AND
          // also `.field.length[!?]` (no trailing `??` / `||` to soften).
          // The `(?<!\?)` lookbehind rejects `?.field.length` and
          // `.field?.length` — those are already safe.
          const rawAccess = new RegExp(`(?<!\\?)\\.${field}\\.length\\b`);
          if (!rawAccess.test(line)) continue;

          // Window of ±2 lines for a SAFE-LENGTH marker OR a same-line
          // truthy guard on the same identifier (e.g. `if (x.field && x.field.length...)`).
          const windowStart = Math.max(0, i - 2);
          const windowEnd = Math.min(lines.length, i + 3);
          const windowText = lines.slice(windowStart, windowEnd).join('\n');
          const hasMarker = /\/\/\s*SAFE-LENGTH\b/.test(windowText);
          // Same-line truthy guard on the field. Matches:
          //   if (x.field && x.field.length...)
          //   if (Array.isArray(x.field) && x.field.length...)
          //   x.field && x.field.length
          const sameLineGuard = new RegExp(
            `(?:Array\\.isArray\\([^)]*${field}[^)]*\\)|\\.${field}\\b[^.])\\s*&&\\s*[^\\n]*\\.${field}\\.length`,
          );
          const hasGuard = sameLineGuard.test(line);
          if (!hasMarker && !hasGuard) {
            violations.push(`${rel}:${i + 1}: raw .${field}.length — ${line.trim()}`);
          }
        }
      }

      expect(
        violations,
        `Raw .length access on risky sub-agent path fields detected. ` +
          `Either (a) use optional chain (\`.field?.length\`), (b) precede the access with a truthy guard ` +
          `on the same line (e.g. \`x.${RISKY_FIELDS[0]} && x.${RISKY_FIELDS[0]}.length > 0\`), or ` +
          `(c) add a \`// SAFE-LENGTH: <reason>\` marker within 2 lines explaining why the field cannot be undefined. ` +
          `Violations:\n${violations.join('\n')}`,
      ).toEqual([]);
    });
  }
});
