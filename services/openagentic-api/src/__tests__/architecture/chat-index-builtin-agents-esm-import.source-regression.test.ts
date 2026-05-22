/**
 * Architecture gate: chat/index.ts MUST import getBuiltInAgents via
 * top-of-file ESM `import`, not via runtime `require()`.
 *
 * Live regression captured 2026-05-01:
 *   The Task tool dispatched `subagent_type: "cloud-operations"`. Under
 *   Node 22's CJS↔ESM interop, calling `require()` from an ESM file on
 *   an ESM module returns a SEPARATE module instance from the one the
 *   startup step (`startup/12-agent-registry.ts`) ran
 *   `initializeAgentRegistry()` against. The fresh instance's private
 *   `_state` was therefore null, and `getBuiltInAgents()` threw
 *     "[BuiltInAgentRegistry] not initialized — call
 *      initializeAgentRegistry() at api startup before reading the
 *      registry."
 *   That throw was swallowed by `try { … } catch { cachedFn = () => [] }`
 *   in the wave2BuiltInDispatch closure. Result: the chat-loop's
 *   `runSubagent` resolver saw zero built-in agents, the agent-tool
 *   wildcard expander never fired, and `cloud-operations` fell through
 *   to the orchestrator's legacy task-analysis path which mis-classified
 *   the prompt as `domain: "research"` and attached the phantom tools
 *   `web_search / analyze_document / summarize` (none of which exist on
 *   the live MCP proxy). That is the smoking gun behind
 *     [Subagent] dropping unknown / phantom tool names not present in
 *      MCP proxy: ['web_search','analyze_document','summarize']
 *   in the prod log on api 8331b5c1.
 *
 * Fix: import `getBuiltInAgents` at the top of chat/index.ts so the same
 * ESM module instance the startup step initialized is the one the
 * dispatch resolver reads from. NEVER use `require('.../BuiltInAgentRegistry')`.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

const CHAT_INDEX = join(API_SRC, 'routes/chat/index.ts');

describe('Architecture: chat/index.ts uses ESM import for BuiltInAgentRegistry (not require)', () => {
  it('has a top-of-file ESM import for getBuiltInAgents', () => {
    expect(existsSync(CHAT_INDEX)).toBe(true);
    const content = readFileSync(CHAT_INDEX, 'utf8');

    // Top-of-file import — must appear in the import block, before any
    // function or const declaration. We look for the literal import line.
    const importRe = /^import\s+\{[^}]*\bgetBuiltInAgents\b[^}]*\}\s+from\s+['"][^'"]*BuiltInAgentRegistry(?:\.js)?['"];?\s*$/m;
    expect(
      importRe.test(content),
      'chat/index.ts must `import { getBuiltInAgents } from "../../services/BuiltInAgentRegistry.js";` at the top of the file. ' +
        'Lazy `require(...)` opens a separate module instance whose registry state is uninitialized; ' +
        'getBuiltInAgents() throws and the swallowed catch returns []. Sub-agent tool resolution dies.',
    ).toBe(true);
  });

  it('does NOT call require() to load BuiltInAgentRegistry', () => {
    const content = readFileSync(CHAT_INDEX, 'utf8');

    // Match `require('.../BuiltInAgentRegistry...')` or
    //       `require("../...BuiltInAgentRegistry...")` — any string form.
    const requireRe = /require\(\s*['"][^'"]*BuiltInAgentRegistry[^'"]*['"]\s*\)/;
    expect(
      requireRe.test(content),
      'chat/index.ts must NOT call `require("...BuiltInAgentRegistry...")`. ' +
        'Use the top-of-file ESM `import` so the dispatch resolver reads the SAME ' +
        'module instance the startup step initialized. Otherwise sub-agents ' +
        'dispatched as `cloud-operations` fall through to legacy domain inference, ' +
        'are tagged `domain: research`, and load phantom tools.',
    ).toBe(false);
  });
});
