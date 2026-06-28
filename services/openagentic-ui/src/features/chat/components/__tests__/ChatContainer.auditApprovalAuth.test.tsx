/**
 * Wave-2 approval+audit UI — ChatContainer wiring for the MUTATING-tool
 * approval gate (backend commit 7e6637539).
 *
 * Source-regression style (matches ChatContainer.hitlApproveAuth.test.tsx):
 * ChatContainer is far too heavy to mount, so we read the source and assert
 * the load-bearing wiring is present.
 *
 * Asserts:
 *   - the resolve handler POSTs to /api/approvals/:auditId/{approve|deny}
 *   - it sends an `Authorization: Bearer ${token}` header (this deployment's
 *     AAD auth is Bearer, not cookie — pinned by the sibling HITL test)
 *   - the useSSEChat({...}) options wire onAuditApprovalRequired
 *   - <ApprovalModal is mounted in the JSX
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = join(__dirname, '..', 'ChatContainer.tsx');

describe('ChatContainer — mutating-tool approval gate wiring', () => {
  const src = readFileSync(SRC, 'utf8');

  it('POSTs to the /approvals/:auditId/<verb> resolve route', () => {
    // template-literal form: apiEndpoint(`/approvals/${head.auditId}/${verb}`)
    expect(src).toMatch(/\/approvals\/\$\{[^}]*auditId\}\/\$\{verb\}/);
  });

  it('sends an Authorization: Bearer header from the resolve handler', () => {
    const idx = src.indexOf('/approvals/${');
    expect(idx).toBeGreaterThan(-1);
    const slice = src.slice(idx - 600, idx + 600);
    expect(slice).toContain('Bearer ${token}');
  });

  it('wires onAuditApprovalRequired in the useSSEChat options', () => {
    expect(src).toMatch(/onAuditApprovalRequired\s*:/);
  });

  it('mounts the ApprovalModal in JSX', () => {
    expect(src).toContain('<ApprovalModal');
    expect(src).toMatch(/import\s+ApprovalModal\b/);
  });
});
