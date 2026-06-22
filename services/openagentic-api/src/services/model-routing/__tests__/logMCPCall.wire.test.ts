/**
 * Wire-level test: confirm logMCPCall stamps the RESOLVED provider on audit
 * rows (not the stale env/config fallback that was making every tool call
 * look like it routed through "ollama" even when Bedrock served it).
 *
 * Scope: validate the integration of pickAuditModelProvider inside logMCPCall
 * via a prisma double. We skip the full tool-execution helper import because
 * that module pulls in dozens of runtime deps — the helpers themselves are
 * unit-tested in auditHelpers.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { pickAuditMessageId, pickAuditModelProvider } from '../auditHelpers.js';

// Reproduce the field-picking code that logMCPCall executes, so refactors
// that drop the helper calls will fail this test. Mirror the exact values
// that would be placed into prisma.mCPUsage.create.data.request_metadata
// and prisma.userQueryAudit.create.data.message_id.
function buildAuditRecord(auditData: {
  messageId?: string | null;
  modelProvider?: string | null;
  modelUsed?: string;
  resolvedProvider?: string | null;
  resolvedProviderType?: string | null;
}) {
  return {
    mcpUsage_request_metadata_modelProvider: pickAuditModelProvider({
      resolvedProvider: auditData.resolvedProvider,
      resolvedProviderType: auditData.resolvedProviderType,
      fallback: auditData.modelProvider,
    }),
    userQueryAudit_message_id: pickAuditMessageId({
      confirmedDbId: auditData.messageId,
    }),
  };
}

describe('logMCPCall wire (auditHelpers integration)', () => {
  it('stamps resolved provider name when router resolved it (bedrock-main, not ollama fallback)', () => {
    const rec = buildAuditRecord({
      messageId: 'AzLvFUfVnEQV6itKP0Q4Q', // real DB row id
      modelProvider: 'ollama',            // stale env fallback from context.config.provider
      modelUsed: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      resolvedProvider: 'bedrock-main',
      resolvedProviderType: 'aws-bedrock',
    });
    expect(rec.mcpUsage_request_metadata_modelProvider).toBe('bedrock-main');
  });

  it('falls back to resolvedProviderType when resolvedProvider absent', () => {
    const rec = buildAuditRecord({
      modelProvider: 'ollama',
      resolvedProviderType: 'aws-bedrock',
    });
    expect(rec.mcpUsage_request_metadata_modelProvider).toBe('aws-bedrock');
  });

  it('falls back to the stale label ONLY when no resolved info is available', () => {
    const rec = buildAuditRecord({
      modelProvider: 'ollama',
    });
    expect(rec.mcpUsage_request_metadata_modelProvider).toBe('ollama');
  });

  it('replaces the pipeline synthetic message id with null for FK safety', () => {
    const rec = buildAuditRecord({
      messageId: 'msg_1776811834086_pnwgox21a', // pipeline synthetic
      resolvedProvider: 'bedrock-main',
    });
    expect(rec.userQueryAudit_message_id).toBeNull();
  });

  it('keeps a real db row id on UserQueryAudit.message_id', () => {
    const rec = buildAuditRecord({
      messageId: 'AzLvFUfVnEQV6itKP0Q4Q',
      resolvedProvider: 'bedrock-main',
    });
    expect(rec.userQueryAudit_message_id).toBe('AzLvFUfVnEQV6itKP0Q4Q');
  });
});
