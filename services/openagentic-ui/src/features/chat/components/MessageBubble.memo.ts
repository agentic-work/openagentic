/**
 * Sev-0 #840 — pure memo comparator for MessageBubble.
 *
 * Extracted into its own module so tests can import it without dragging
 * the full MessageBubble component tree (Lottie, Shiki, etc.) into the
 * jsdom test runtime.
 *
 * Contract: returns TRUE to skip re-render (props equal), FALSE to force
 * re-render. The comparator is shallow / reference-based for object
 * props — parent components are expected to pass stable references via
 * useMemo when the underlying data hasn't changed.
 *
 * Adding a new prop check? Add it here AND extend
 * `__tests__/MessageBubble.memoSubAgentsByMessageId.test.ts` (or a new
 * sibling test) so future contributors can't drop the check accidentally
 * — that's how #840 (3 persisted sub-agent cards never rendering on
 * reload) actually happened.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function shouldSkipMessageBubbleRerender(
  prevProps: any,
  nextProps: any,
): boolean {
  // Always re-render if the message itself changed
  if (prevProps.message !== nextProps.message) {
    if (
      prevProps.message.id !== nextProps.message.id ||
      prevProps.message.content !== nextProps.message.content ||
      prevProps.message.status !== nextProps.message.status ||
      prevProps.message.role !== nextProps.message.role ||
      prevProps.message.mcpCalls !== nextProps.message.mcpCalls ||
      prevProps.message.toolCalls !== nextProps.message.toolCalls ||
      prevProps.message.toolResults !== nextProps.message.toolResults ||
      prevProps.message.thinkingSteps !== nextProps.message.thinkingSteps ||
      prevProps.message.reasoningTrace !== nextProps.message.reasoningTrace ||
      prevProps.message.model !== nextProps.message.model ||
      prevProps.message.attachedImages !== nextProps.message.attachedImages
    ) {
      return false;
    }
  }

  if (prevProps.isEditing !== nextProps.isEditing) return false;
  if (nextProps.isEditing && prevProps.editContent !== nextProps.editContent) return false;
  if (prevProps.theme !== nextProps.theme) return false;
  if (
    nextProps.message.status === 'streaming' &&
    prevProps.thinkingContent !== nextProps.thinkingContent
  ) {
    return false;
  }
  if (prevProps.activeMcpCalls !== nextProps.activeMcpCalls) return false;
  if (
    prevProps.showMCPIndicators !== nextProps.showMCPIndicators ||
    prevProps.showModelBadges !== nextProps.showModelBadges ||
    prevProps.showThinkingInline !== nextProps.showThinkingInline
  ) {
    return false;
  }
  if (prevProps.turnInfo !== nextProps.turnInfo) return false;
  if (prevProps.aggregatedMessages !== nextProps.aggregatedMessages) return false;

  if (prevProps.streamingContentBlocks !== nextProps.streamingContentBlocks) {
    const prevBlocks = prevProps.streamingContentBlocks || [];
    const nextBlocks = nextProps.streamingContentBlocks || [];
    if (prevBlocks.length !== nextBlocks.length) return false;
    for (let i = 0; i < nextBlocks.length; i++) {
      if (
        prevBlocks[i]?.content !== nextBlocks[i]?.content ||
        prevBlocks[i]?.type !== nextBlocks[i]?.type
      ) {
        return false;
      }
    }
  }

  if (prevProps.normalizedEvents !== nextProps.normalizedEvents) {
    const prevLen = prevProps.normalizedEvents?.length ?? 0;
    const nextLen = nextProps.normalizedEvents?.length ?? 0;
    if (prevLen !== nextLen) return false;
  }

  // Sev-0 #840 — persisted sub-agent cards land via this prop after
  // mergePersistedSubAgents lifts them out of visualizations[]. Without
  // this check the bubble stays stuck on the empty initial map and AAS
  // renders zero SubAgentCards on reload.
  if (prevProps.subAgentsByMessageId !== nextProps.subAgentsByMessageId) {
    return false;
  }
  // Sev-0 #840 — live sub-agent reducer state can also flip without the
  // map changing (e.g., during streaming). Track its reference too.
  if (prevProps.subAgents !== nextProps.subAgents) {
    return false;
  }

  return true;
}
