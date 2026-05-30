import { describe, it, expect } from 'vitest';
import { looksLikeDbRowId, pickAuditMessageId, pickAuditModelProvider } from '../auditHelpers.js';

describe('looksLikeDbRowId', () => {
  it('accepts nanoid-style ids', () => {
    expect(looksLikeDbRowId('AzLvFUfVnEQV6itKP0Q4Q')).toBe(true);
    expect(looksLikeDbRowId('Xpm91laowGnGNqnwueygt')).toBe(true);
  });

  it('accepts uuid v4', () => {
    expect(looksLikeDbRowId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects pipeline synthetic ids', () => {
    expect(looksLikeDbRowId('msg_1776811834086_pnwgox21a')).toBe(false);
    expect(looksLikeDbRowId('continuation_prompt_1')).toBe(false);
    expect(looksLikeDbRowId('cot_thinking_1776811834839')).toBe(false);
  });

  it('rejects null / empty / non-string', () => {
    expect(looksLikeDbRowId(null)).toBe(false);
    expect(looksLikeDbRowId(undefined)).toBe(false);
    expect(looksLikeDbRowId('')).toBe(false);
    expect(looksLikeDbRowId(123 as any)).toBe(false);
  });

  it('rejects very short strings', () => {
    expect(looksLikeDbRowId('abc')).toBe(false);
  });

  it('rejects timestamp-heavy ids like session_1776...', () => {
    expect(looksLikeDbRowId('session_1776805102235_h64or2mku')).toBe(false);
  });
});

describe('pickAuditMessageId', () => {
  it('returns confirmedDbId when it is a real-looking id', () => {
    const r = pickAuditMessageId({
      confirmedDbId: 'AzLvFUfVnEQV6itKP0Q4Q',
      pipelineId: 'msg_1776811834086_pnwgox21a',
    });
    expect(r).toBe('AzLvFUfVnEQV6itKP0Q4Q');
  });

  it('returns null when only pipelineId is provided (prevents FK violation)', () => {
    const r = pickAuditMessageId({
      pipelineId: 'msg_1776811834086_pnwgox21a',
    });
    expect(r).toBeNull();
  });

  it('returns null when both are missing', () => {
    expect(pickAuditMessageId({})).toBeNull();
  });

  it('returns null when confirmedDbId is itself a pipeline synthetic id', () => {
    // Defensive: if somebody passes the pipeline id into confirmedDbId, don't trust it.
    const r = pickAuditMessageId({
      confirmedDbId: 'msg_1776811834086_pnwgox21a',
    });
    expect(r).toBeNull();
  });
});

describe('pickAuditModelProvider', () => {
  it('prefers resolvedProvider (provider instance name)', () => {
    const r = pickAuditModelProvider({
      resolvedProvider: 'bedrock-main',
      resolvedProviderType: 'aws-bedrock',
      fallback: 'ollama',
    });
    expect(r).toBe('bedrock-main');
  });

  it('falls back to provider type when resolved name is absent', () => {
    const r = pickAuditModelProvider({
      resolvedProviderType: 'aws-bedrock',
      fallback: 'ollama',
    });
    expect(r).toBe('aws-bedrock');
  });

  it('uses fallback last', () => {
    const r = pickAuditModelProvider({ fallback: 'ollama' });
    expect(r).toBe('ollama');
  });

  it('trims whitespace', () => {
    const r = pickAuditModelProvider({ resolvedProvider: '  bedrock-main  ' });
    expect(r).toBe('bedrock-main');
  });

  it('returns null when nothing is provided', () => {
    expect(pickAuditModelProvider({})).toBeNull();
  });

  it('ignores empty-string resolvedProvider (falls through)', () => {
    const r = pickAuditModelProvider({
      resolvedProvider: '',
      resolvedProviderType: 'aws-bedrock',
    });
    expect(r).toBe('aws-bedrock');
  });
});
