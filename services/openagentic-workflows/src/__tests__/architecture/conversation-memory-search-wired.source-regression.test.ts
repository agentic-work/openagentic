/**
 * conversation_memory `search` operation — source-regression guard.
 *
 * Pins the V1.1 vector-backend wire-up:
 *   1. schema.json declares `search` in the operation enum + `query` setting
 *   2. executor.ts handles the case
 *   3. types.ts exposes the hook on NodeExecutionContext.conversationMemory
 *   4. ConversationMemoryService exposes a `search` method
 *   5. WorkflowExecutionEngine wires svc.search() into the hook
 *
 * Without this, an unrelated refactor could drop one of the 5 sites and
 * the others would still typecheck — search would silently return
 * `undefined operation` or `hook not wired` at runtime.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

describe('conversation_memory search operation — all 5 wire-up sites', () => {
  it('schema.json includes `search` in the operation enum', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/shared/workflow-engine/src/nodes/conversation_memory/schema.json'),
      'utf8',
    );
    expect(text).toMatch(/"values"\s*:\s*\[\s*"read"[\s\S]*?"search"\s*\]/);
    expect(text).toMatch(/"name"\s*:\s*"query"/);
  });

  it('executor.ts handles the search case', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/shared/workflow-engine/src/nodes/conversation_memory/executor.ts'),
      'utf8',
    );
    expect(text).toMatch(/case\s+['"]search['"]\s*:/);
    expect(text).toMatch(/hook\.search\s*\(/);
  });

  it('types.ts declares the search hook signature', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/shared/workflow-engine/src/nodes/types.ts'),
      'utf8',
    );
    expect(text).toMatch(/search\?:\s*\(args:\s*\{[\s\S]*?query:\s*string[\s\S]*?\}\)/);
  });

  it('ConversationMemoryService exposes search()', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-workflows/src/services/ConversationMemoryService.ts'),
      'utf8',
    );
    expect(text).toMatch(/async\s+search\s*\(/);
    expect(text).toMatch(/\/api\/embeddings/);
    expect(text).toMatch(/cosineSimilarity/);
  });

  it('WorkflowExecutionEngine wires svc.search() into the hook', () => {
    const text = readFileSync(
      join(REPO_ROOT, 'services/openagentic-workflows/src/services/WorkflowExecutionEngine.ts'),
      'utf8',
    );
    expect(text).toMatch(/search:\s*async\s*\(args\)/);
    expect(text).toMatch(/svc\.search\(args\)/);
  });
});
