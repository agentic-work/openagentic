/**
 * Phase 7 — SessionFactsBuilder (TDD RED first).
 *
 * the design notes
 *
 * Builds a `<session-facts>` block injected ABOVE the user message on
 * turn 1 of every chat session. Mirrors Claude Code's `<env>` / `<session>`
 * tactic — gives the model ground truth for things it otherwise hallucinates
 * (current ISO timestamp, user role, tenantId, session id, prior turn count,
 * model in use, optional knowledge cutoff).
 *
 * The model treats this as ambient context (the XML wrapping signals
 * "environment hint, not user input"). Format kept minimal — every byte
 * counts on the first turn's prompt.
 */
import { describe, it, expect } from 'vitest';
import { SessionFactsBuilder, type SessionFacts } from '../SessionFactsBuilder.js';

describe('SessionFactsBuilder.build', () => {
  it('stamps current ISO 8601 timestamp into now', () => {
    const before = new Date().toISOString();
    const builder = new SessionFactsBuilder();
    const facts = builder.build({
      userId: 'u-1',
      userRole: 'admin',
      tenantId: 't-1',
      sessionId: 's-1',
      priorTurnCount: 0,
      modelInUse: 'some-chat-model',
    });
    const after = new Date().toISOString();
    expect(facts.now).toBeDefined();
    expect(typeof facts.now).toBe('string');
    // ISO 8601 format
    expect(facts.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Falls between before/after
    expect(facts.now >= before).toBe(true);
    expect(facts.now <= after).toBe(true);
  });

  it('populates all required fields from input', () => {
    const builder = new SessionFactsBuilder();
    const facts = builder.build({
      userId: 'u-42',
      userRole: 'member',
      tenantId: 'tenant-acme',
      sessionId: 'sess-abc',
      priorTurnCount: 7,
      modelInUse: 'configured-chat-model',
    });
    expect(facts.userId).toBe('u-42');
    expect(facts.userRole).toBe('member');
    expect(facts.tenantId).toBe('tenant-acme');
    expect(facts.sessionId).toBe('sess-abc');
    expect(facts.priorTurnCount).toBe(7);
    expect(facts.modelInUse).toBe('configured-chat-model');
  });

  it('resolves knowledgeCutoff via injected resolver', () => {
    const builder = new SessionFactsBuilder({
      knowledgeCutoffResolver: (modelId: string) => {
        if (modelId === 'has-cutoff') return '2025-04';
        return undefined;
      },
    });
    const withCutoff = builder.build({
      userId: 'u', userRole: 'admin', tenantId: 't',
      sessionId: 's', priorTurnCount: 0, modelInUse: 'has-cutoff',
    });
    expect(withCutoff.knowledgeCutoff).toBe('2025-04');

    const withoutCutoff = builder.build({
      userId: 'u', userRole: 'admin', tenantId: 't',
      sessionId: 's', priorTurnCount: 0, modelInUse: 'unknown-model',
    });
    expect(withoutCutoff.knowledgeCutoff).toBeUndefined();
  });

  it('leaves knowledgeCutoff undefined when no resolver supplied', () => {
    const builder = new SessionFactsBuilder();
    const facts = builder.build({
      userId: 'u', userRole: 'admin', tenantId: 't',
      sessionId: 's', priorTurnCount: 0, modelInUse: 'any-model',
    });
    expect(facts.knowledgeCutoff).toBeUndefined();
  });
});

describe('SessionFactsBuilder.render', () => {
  it('produces deterministic XML-ish block with expected shape', () => {
    const builder = new SessionFactsBuilder();
    const facts: SessionFacts = {
      now: '2026-05-09T12:34:56.000Z',
      userId: 'u-1',
      userRole: 'admin',
      tenantId: 't-1',
      sessionId: 's-1',
      priorTurnCount: 3,
      modelInUse: 'configured-chat-model',
    };
    const out = builder.render(facts);
    expect(out).toContain('<session-facts>');
    expect(out).toContain('</session-facts>');
    expect(out).toContain('<now>2026-05-09T12:34:56.000Z</now>');
    expect(out).toContain('<user id="u-1" role="admin"/>');
    expect(out).toContain('<tenant id="t-1"/>');
    expect(out).toContain('<session id="s-1" turn="3"/>');
    expect(out).toMatch(/<model name="configured-chat-model"\s*\/>/);
  });

  it('escapes special XML chars in attribute values (XSS-style hardening)', () => {
    const builder = new SessionFactsBuilder();
    const facts: SessionFacts = {
      now: '2026-05-09T00:00:00.000Z',
      userId: 'u',
      userRole: 'admin',
      tenantId: 'evil"<script>&"more',
      sessionId: 'sess<&>"end',
      priorTurnCount: 0,
      modelInUse: 'm"<x>&',
    };
    const out = builder.render(facts);
    // Escaped values appear in the output…
    expect(out).toContain('&quot;');
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).toContain('&amp;');
    // …and the raw chars do NOT appear inside attribute values (we'd see
    // an unescaped ">" closing the tag prematurely if escaping were broken).
    expect(out).not.toContain('"<script>');
    expect(out).not.toMatch(/tenant id="[^"]*<[^"]*"/);
  });

  it('omits knowledge_cutoff attribute when undefined', () => {
    const builder = new SessionFactsBuilder();
    const facts: SessionFacts = {
      now: '2026-05-09T00:00:00.000Z',
      userId: 'u', userRole: 'member', tenantId: 't',
      sessionId: 's', priorTurnCount: 0, modelInUse: 'm',
    };
    const out = builder.render(facts);
    expect(out).not.toContain('knowledge_cutoff');
  });

  it('includes knowledge_cutoff attribute when defined', () => {
    const builder = new SessionFactsBuilder();
    const facts: SessionFacts = {
      now: '2026-05-09T00:00:00.000Z',
      userId: 'u', userRole: 'admin', tenantId: 't',
      sessionId: 's', priorTurnCount: 0, modelInUse: 'm',
      knowledgeCutoff: '2025-04',
    };
    const out = builder.render(facts);
    expect(out).toContain('knowledge_cutoff="2025-04"');
  });
});
