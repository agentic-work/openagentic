/**
 * Sev-0 #840 — MessageBubble memo MUST re-render when subAgentsByMessageId
 * reference changes.
 *
 * Bug surface (verified live on 2026-05-14 in session_1778779339525_gcw7g81os):
 *   - Server persists 3 `sub_agent_completed` viz frames on the assistant message.
 *   - On reload, ChatMessages.tsx:438 `mergePersistedSubAgents` lifts those
 *     into `effectiveSubAgentsByMessageId` and passes it to MessageBubble.
 *   - Initial render of ChatMessages may run with an empty
 *     `subAgentsByMessageId` (loadSessionMessages still in-flight) → the
 *     bubble mounts with `subAgentsByMessageId = {}`.
 *   - A subsequent render after messages hydrate produces the populated
 *     map, but MessageBubble's memo comparator (at MessageBubble.tsx:1256)
 *     never checks that prop. It returns true ("props equal → skip
 *     re-render") and the bubble stays stuck on the empty map — AAS
 *     sees `subAgents=[]` and renders zero SubAgentCards.
 *
 * GREEN signal: the exported comparator returns FALSE when
 * `subAgentsByMessageId` reference changes (re-render required).
 *
 * RED reproduction (before fix): comparator returns TRUE for the same
 * input, asserting the stale-memo bug.
 */
import { describe, it, expect } from 'vitest';
import { shouldSkipMessageBubbleRerender } from '../MessageBubble.memo';

const baseMessage = {
  id: 'msg-asst-1',
  role: 'assistant' as const,
  content: 'I dispatched three sub-agents',
  status: 'completed' as const,
  timestamp: '2026-05-14T17:24:00Z',
  mcpCalls: [],
  toolCalls: [],
  toolResults: [],
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    message: baseMessage,
    theme: 'dark',
    isEditing: false,
    editContent: '',
    activeMcpCalls: [],
    showMCPIndicators: true,
    showModelBadges: true,
    showThinkingInline: true,
    streamingContentBlocks: [],
    normalizedEvents: [],
    aggregatedMessages: undefined,
    turnInfo: undefined,
    thinkingContent: undefined,
    subAgents: [],
    subAgentsByMessageId: {},
    ...overrides,
  } as Record<string, unknown>;
}

describe('Sev-0 #840 — MessageBubble.memo subAgentsByMessageId tracking', () => {
  it('must re-render when subAgentsByMessageId reference flips', () => {
    const prev = makeProps({ subAgentsByMessageId: {} });
    const next = makeProps({
      subAgentsByMessageId: {
        'msg-asst-1': [
          { role: 'cloud_operations', model: null, status: 'ok' },
          { role: 'validation', model: null, status: 'ok' },
          { role: 'planning', model: null, status: 'ok' },
        ],
      },
    });
    // shouldSkipMessageBubbleRerender returns TRUE when props equal (skip
    // re-render). Sev-0 #840 fix: when subAgentsByMessageId reference
    // changes, the comparator MUST return false (re-render).
    expect(
      shouldSkipMessageBubbleRerender(prev as any, next as any),
    ).toBe(false);
  });

  it('still skips re-render when nothing relevant changed', () => {
    // Share every reference between the two prop bags — memo is shallow,
    // so equality on `message` and the array props is required.
    const sharedSubAgents = { 'msg-asst-1': [] as unknown[] };
    const sharedMcpCalls: unknown[] = [];
    const sharedToolCalls: unknown[] = [];
    const sharedToolResults: unknown[] = [];
    const sharedMessage = {
      ...baseMessage,
      mcpCalls: sharedMcpCalls,
      toolCalls: sharedToolCalls,
      toolResults: sharedToolResults,
    };
    const sharedNormalizedEvents: unknown[] = [];
    const sharedStreamingBlocks: unknown[] = [];
    const sharedActiveMcpCalls: unknown[] = [];
    const sharedSubAgentsArr: unknown[] = [];

    const makeStable = () => ({
      message: sharedMessage,
      theme: 'dark',
      isEditing: false,
      editContent: '',
      activeMcpCalls: sharedActiveMcpCalls,
      showMCPIndicators: true,
      showModelBadges: true,
      showThinkingInline: true,
      streamingContentBlocks: sharedStreamingBlocks,
      normalizedEvents: sharedNormalizedEvents,
      aggregatedMessages: undefined,
      turnInfo: undefined,
      thinkingContent: undefined,
      subAgents: sharedSubAgentsArr,
      subAgentsByMessageId: sharedSubAgents,
    });
    const same = makeStable();
    const sameAgain = makeStable();
    expect(
      shouldSkipMessageBubbleRerender(same as any, sameAgain as any),
    ).toBe(true);
  });

  it('treats new but reference-different empty map as a change (conservative)', () => {
    // Reference-based comparison: two distinct {} objects are NOT equal.
    // We accept the small over-fetch cost in exchange for never being
    // stuck stale — the parent passes a stable ref when nothing changed
    // (effectiveSubAgentsByMessageId is memoized).
    const prev = makeProps({ subAgentsByMessageId: {} });
    const next = makeProps({ subAgentsByMessageId: {} });
    expect(
      shouldSkipMessageBubbleRerender(prev as any, next as any),
    ).toBe(false);
  });
});
