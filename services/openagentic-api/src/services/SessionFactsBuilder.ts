/**
 * SessionFactsBuilder — Phase 7 (V3 Enterprise Chatmode).
 *
 * the design notes
 *
 * Builds a compact `<session-facts>` block injected ABOVE the user message
 * on turn 1 of every chat session. Mirrors Claude Code's `<env>` /
 * `<session>` tactic — gives the model ground truth for ambient context
 * (current ISO timestamp, user role, tenantId, session id, prior turn
 * count, model in use, optional knowledge cutoff).
 *
 * The XML wrapping signals "ambient context, not user input" to the model;
 * no additional framing prose is needed. Format kept minimal — every byte
 * counts on the first turn's prompt and the same block fires every session.
 *
 * Phase 7 is the first place this file lands. Phase 9 may extend the facts
 * with memory-snapshot pointers; the API contract stays additive (extra
 * optional fields don't break existing renderers).
 */

export interface SessionFacts {
  /** ISO 8601 current timestamp — stamped at build() time. */
  now: string;
  userId: string;
  userRole: 'admin' | 'member' | 'viewer';
  tenantId: string;
  sessionId: string;
  /** How many turns have elapsed in this session before this one (0 on turn 1). */
  priorTurnCount: number;
  /** Registry-resolved model id (e.g. provider:model:tag) being used this turn. */
  modelInUse: string;
  /** Optional, model-dependent. Resolved at runtime via the injected resolver. */
  knowledgeCutoff?: string;
}

export interface SessionFactsBuilderDeps {
  /**
   * Resolves a knowledge-cutoff string for a given model id. Implementations
   * typically read from the model registry's metadata. Returns `undefined`
   * for unknown models (the renderer then omits the attribute entirely).
   */
  knowledgeCutoffResolver?: (modelId: string) => string | undefined;
}

/**
 * Escape special XML chars in attribute values. Required because session
 * facts include user-controlled identifiers (tenantId, sessionId) that
 * MUST NOT be able to break out of an attribute and inject markup —
 * even though the consumer is a language model, the same XML the model
 * sees gets logged, displayed in admin tooling, and shipped to telemetry.
 */
function escapeXmlAttr(v: string): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class SessionFactsBuilder {
  constructor(private deps: SessionFactsBuilderDeps = {}) {}

  /**
   * Build a SessionFacts record from the per-turn input. Stamps `now`
   * with the current ISO timestamp and resolves `knowledgeCutoff` via
   * the injected resolver (when one was supplied at construction).
   */
  build(input: Omit<SessionFacts, 'now' | 'knowledgeCutoff'>): SessionFacts {
    return {
      now: new Date().toISOString(),
      ...input,
      knowledgeCutoff: this.deps.knowledgeCutoffResolver?.(input.modelInUse),
    };
  }

  /**
   * Render facts into a compact XML-ish block. Goes ABOVE the user message
   * on every turn-1 chat-loop invocation. The model treats this as ground
   * truth — never invents a different date / tenant / role.
   *
   * Format mirrors Claude Code's `<env>...</env>` blocks: small, predictable,
   * key=value attributes inside semantic tags. Example output:
   *
   *   <session-facts>
   *     <now>2026-05-09T12:34:56.000Z</now>
   *     <user id="u-1" role="admin"/>
   *     <tenant id="t-1"/>
   *     <session id="s-1" turn="3"/>
   *     <model name="some-model" knowledge_cutoff="2025-04"/>
   *   </session-facts>
   *
   * `knowledge_cutoff` is omitted entirely when undefined (no empty
   * attribute, no `="undefined"` literal — the model gets a clean signal
   * that the field is unknown vs. known-empty).
   */
  render(facts: SessionFacts): string {
    const cutoffAttr = facts.knowledgeCutoff
      ? ` knowledge_cutoff="${escapeXmlAttr(facts.knowledgeCutoff)}"`
      : '';
    const lines = [
      `<session-facts>`,
      `  <now>${escapeXmlAttr(facts.now)}</now>`,
      `  <user id="${escapeXmlAttr(facts.userId)}" role="${escapeXmlAttr(facts.userRole)}"/>`,
      `  <tenant id="${escapeXmlAttr(facts.tenantId)}"/>`,
      `  <session id="${escapeXmlAttr(facts.sessionId)}" turn="${facts.priorTurnCount}"/>`,
      `  <model name="${escapeXmlAttr(facts.modelInUse)}"${cutoffAttr}/>`,
      `</session-facts>`,
    ];
    return lines.join('\n');
  }
}
