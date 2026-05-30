import { describe, it, expect } from 'vitest';
import { evaluateRagIntent } from './RagIntentGate.js';

describe('RagIntentGate V2 — explicit opt-in only', () => {
  it('empty / null / undefined → empty-message, no fetch', () => {
    expect(evaluateRagIntent('')).toEqual({ shouldFetchRag: false, reason: 'empty-message' });
    expect(evaluateRagIntent('   ')).toEqual({ shouldFetchRag: false, reason: 'empty-message' });
    expect(evaluateRagIntent(undefined)).toEqual({ shouldFetchRag: false, reason: 'empty-message' });
    expect(evaluateRagIntent(null)).toEqual({ shouldFetchRag: false, reason: 'empty-message' });
  });

  it('plain prose without @/ prefix → no-opt-in (the failing-prompt class)', () => {
    const messages = [
      'show me cloud resources and give me a sankey cost diagram for the last 6 months',
      'what are my Azure costs',
      'list my AWS subscriptions',
      'render a chart of monthly spend',
      'create a flowchart for the auth flow',
      'how does the smart router decide escalation',
      'explain artifact creation',
      'tell me about the platform',
      'what is the rag stage',
    ];
    for (const m of messages) {
      const d = evaluateRagIntent(m);
      expect(d.shouldFetchRag, `should NOT fetch for: ${m}`).toBe(false);
      expect(d.reason).toBe('no-opt-in');
      expect(d.matched).toBeUndefined();
    }
  });

  it('@docs prefix → fires with explicit-opt-in', () => {
    const d = evaluateRagIntent('@docs explain the rag stage');
    expect(d.shouldFetchRag).toBe(true);
    expect(d.reason).toBe('explicit-opt-in');
    expect(d.matched).toBe('@docs');
  });

  it('/docs prefix → fires', () => {
    const d = evaluateRagIntent('/docs how does the smart router decide escalation');
    expect(d.shouldFetchRag).toBe(true);
    expect(d.reason).toBe('explicit-opt-in');
    expect(d.matched).toBe('/docs');
  });

  it('@kb prefix → fires', () => {
    const d = evaluateRagIntent('@kb how does artifact strip work');
    expect(d.shouldFetchRag).toBe(true);
    expect(d.matched).toBe('@kb');
  });

  it('/kb prefix → fires', () => {
    const d = evaluateRagIntent('/kb show me the pipeline architecture');
    expect(d.shouldFetchRag).toBe(true);
    expect(d.matched).toBe('/kb');
  });

  it('case-insensitive prefix match', () => {
    expect(evaluateRagIntent('@DOCS hello').shouldFetchRag).toBe(true);
    expect(evaluateRagIntent('@Docs hello').shouldFetchRag).toBe(true);
    expect(evaluateRagIntent('/DOCS hello').shouldFetchRag).toBe(true);
    expect(evaluateRagIntent('/Kb hello').shouldFetchRag).toBe(true);
  });

  it('@docs token mid-message is honored as explicit marker (whitespace-bounded)', () => {
    // Task 1.9+1.13 contract widened the @docs marker: whitespace-bounded
    // anywhere in the message counts. Prior V2 contract restricted it to
    // message-start; that was tightened to allow inline use such as
    // "what does our @docs say about retries?".
    const d = evaluateRagIntent('please look up @docs for me');
    expect(d.shouldFetchRag).toBe(true);
    expect(d.reason).toBe('explicit-opt-in');
  });

  it('legacy positive prose ("docs" word, "documentation", platform names) → NO fetch (V1 keyword stack is gone)', () => {
    const cases = [
      'docs about the smart router',
      'documentation for the rag stage',
      'tutorial how to use openagentic',
      'what is the chat-mode pipeline',
      'explain openagentic',
      'how do I use the platform',
    ];
    for (const c of cases) {
      const d = evaluateRagIntent(c);
      expect(d.shouldFetchRag, `should NOT fire RAG on legacy keyword prose: ${c}`).toBe(false);
      expect(d.reason).toBe('no-opt-in');
    }
  });

  it('whitespace before opt-in prefix is tolerated (user typed a space first)', () => {
    expect(evaluateRagIntent('  @docs hello').shouldFetchRag).toBe(true);
    expect(evaluateRagIntent('\t/kb hello').shouldFetchRag).toBe(true);
  });
});
