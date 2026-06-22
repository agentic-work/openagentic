/**
 * Message Normalization Utility
 *
 * Ensures messages are rendered identically regardless of source (streaming vs. database)
 * Critical for consistent UX between live conversations and page reloads
 *
 * Architecture integration:
 * - Redis: Caches normalized messages for fast retrieval
 * - PostgreSQL: Stores raw messages with all metadata
 * - Frontend: Normalizes on display for consistency
 */

import { ChatMessage, VisualizationData, ThinkingStep } from '@/types/index';
import type { Message as StoreMessage } from '@/stores/useChatStore';

/**
 * Convert a single store-internal `Message` (useChatStore) into the canonical
 * `ChatMessage` shape (`@/types/index`) the render layer consumes.
 *
 * The two shapes are intentionally distinct: the store keeps a richer mutable
 * model (e.g. `timestamp: Date | string`, render-frame `visualizations`), while
 * `ChatMessage` is the SoT contract ChatMessages/MessageBubble render against
 * (`timestamp` is ALWAYS an ISO string). This adapter performs the real,
 * field-aware conversion that previously hid behind a `messages as any as
 * ChatMessage[]` double-cast in ChatContainer — normalizing `timestamp` to a
 * string and carrying the heterogeneous inline render-frame `visualizations`
 * across via a single localized field narrowing (the frames are typed
 * `{ type: string; data: unknown }` in the store but read structurally by the
 * `visualizations` fallback in ChatMessages).
 */
export function storeMessageToChatMessage(message: StoreMessage): ChatMessage {
  const timestamp =
    typeof message.timestamp === 'string'
      ? message.timestamp
      : message.timestamp instanceof Date
        ? message.timestamp.toISOString()
        : new Date().toISOString();

  // Inline render-frame visualizations are structurally compatible with the
  // `visualizations` fallback consumer but typed loosely in the store; narrow
  // through `unknown` here (one explicit field-level cast) rather than laundering
  // the whole message object through `any`.
  const visualizations = message.visualizations as unknown as VisualizationData[] | undefined;

  // The store's ThinkingStep union is a superset of the render-layer one (it
  // adds 'mcp' | 'thinking' kinds). MessageBubble renders steps structurally
  // (by content/timestamp), so widen the kind via a single field-level cast
  // rather than dropping the extra kinds or casting the whole object.
  const thinkingSteps = message.thinkingSteps as unknown as ThinkingStep[] | undefined;

  // The store's ReasoningTrace is structurally looser than the SoT one (it omits
  // a few fields the renderer treats as optional in practice). It's consumed
  // read-only by MessageBubble; narrow it at the field level here too.
  const reasoningTrace = message.reasoningTrace as ChatMessage['reasoningTrace'];

  return {
    ...message,
    timestamp,
    visualizations,
    thinkingSteps,
    reasoningTrace,
  };
}

/**
 * Array form of {@link storeMessageToChatMessage}. Returns `[]` for nullish /
 * non-array input so callers can use it directly in `useMemo` selectors.
 */
export function storeMessagesToChatMessages(messages: StoreMessage[]): ChatMessage[] {
  if (!messages || !Array.isArray(messages)) return [];
  return messages.map(storeMessageToChatMessage);
}

/**
 * Normalize a single message for consistent rendering
 *
 * Problems this solves:
 * 1. Tool calls stored in different locations (message.mcpCalls vs message.metadata.mcpCalls)
 * 2. Missing status indicators on reload
 * 3. Inconsistent message structure between streaming and loaded messages
 * 4. Animation inconsistencies
 */
export function normalizeMessage(message: ChatMessage): ChatMessage {
  // Early return for null/undefined
  if (!message) return message;

  // Extract tool calls from all possible locations
  const mcpCalls = message.mcpCalls || message.metadata?.mcpCalls || [];
  const toolCalls = message.toolCalls || message.metadata?.toolCalls || [];

  // Determine status based on message state
  // Live messages may have status='sending', 'executing', etc.
  // Loaded messages should always be 'completed' or 'error'
  const status = message.status || (message.error ? 'error' : 'completed');

  // Normalize timestamp to consistent format
  const timestamp = message.timestamp
    ? (typeof message.timestamp === 'string' ? message.timestamp : new Date(message.timestamp).toISOString())
    : new Date().toISOString();

  // Normalize content to always be a string (CRITICAL FIX for raw JSON rendering on reload)
  // Backend might return content as object, which would render as raw JSON
  // Use 'any' cast because at runtime content may not always be a string despite the type
  let normalizedContent: string = message.content || '';
  const rawContent = message.content as any;
  if (rawContent && typeof rawContent !== 'string') {
    // If content is an object, try to extract the actual text content
    if (rawContent.message) {
      normalizedContent = rawContent.message;
    } else if (rawContent.text) {
      normalizedContent = rawContent.text;
    } else if (rawContent.content) {
      normalizedContent = rawContent.content;
    } else if (rawContent.response) {
      normalizedContent = rawContent.response;
    } else {
      // Last resort: convert to string (this should rarely happen)
      try {
        normalizedContent = JSON.stringify(rawContent);
      } catch {
        normalizedContent = String(rawContent);
      }
    }
  }

  return {
    ...message,
    // Normalize tool calls to root level (not nested in metadata)
    mcpCalls,
    toolCalls,
    // Ensure status is always present
    status,
    // Normalize timestamp
    timestamp,
    // Clean metadata - remove duplicates now that they're at root
    metadata: message.metadata ? {
      ...message.metadata,
      mcpCalls: undefined,
      toolCalls: undefined
    } : undefined,
    // Ensure required fields are present
    id: message.id || `msg_${Date.now()}`,
    role: message.role || 'user',
    content: normalizedContent,
  };
}

/**
 * Normalize an array of messages
 * Optimized for bulk operations when loading conversation history
 * CRITICAL: Deduplicates FIRST, then sorts chronologically to prevent duplicate rendering and ensure proper order
 */
export function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || !Array.isArray(messages)) return [];

  // CRITICAL FIX: Deduplicate BEFORE normalizing to prevent duplicate messages in UI
  const deduplicated = deduplicateMessages(messages);

  // CRITICAL FIX: Sort by timestamp to ensure chronological order
  const sorted = sortMessagesByTimestamp(deduplicated);

  return sorted.map(normalizeMessage);
}

/**
 * Check if a message has tool calls (from any location)
 */
export function hasToolCalls(message: ChatMessage): boolean {
  return !!(
    (message.mcpCalls && message.mcpCalls.length > 0) ||
    (message.toolCalls && message.toolCalls.length > 0) ||
    (message.metadata?.mcpCalls && message.metadata.mcpCalls.length > 0) ||
    (message.metadata?.toolCalls && message.metadata.toolCalls.length > 0)
  );
}

/**
 * Get tool calls from a message (normalized location)
 */
export function getToolCalls(message: ChatMessage): any[] {
  const normalized = normalizeMessage(message);
  return [
    ...(normalized.mcpCalls || []),
    ...(normalized.toolCalls || [])
  ];
}

/**
 * Group consecutive messages by role for compact display
 * Useful for showing multiple tool calls together
 */
export function groupMessagesByRole(messages: ChatMessage[]): ChatMessage[][] {
  if (!messages || messages.length === 0) return [];

  const groups: ChatMessage[][] = [];
  let currentGroup: ChatMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === messages[i - 1].role) {
      currentGroup.push(messages[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [messages[i]];
    }
  }

  groups.push(currentGroup);
  return groups;
}

/**
 * Sort messages by timestamp with role-based secondary sorting
 * Ensures chronological order regardless of database retrieval order
 * CRITICAL UX FIX: User messages ALWAYS appear AFTER assistant messages when timestamps are identical
 * This ensures user messages render BELOW all tool execution boxes and assistant responses
 * Messages are sorted oldest-to-newest so latest user message appears at bottom
 */
export function sortMessagesByTimestamp(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : Date.now() + 999999;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : Date.now() + 999999;

    // Primary sort: by timestamp
    if (timeA !== timeB) {
      return timeA - timeB; // Keep chronological order
    }

    // Secondary sort: CRITICAL UX FIX - User messages MUST appear AFTER assistant messages
    // This ensures user messages visually render BELOW all tool boxes and assistant responses
    // When timestamps are identical (race condition), assistant messages render first, then user messages
    if (a.role === 'user' && b.role === 'assistant') {
      return 1; // User message comes AFTER assistant (renders below)
    }
    if (a.role === 'assistant' && b.role === 'user') {
      return -1; // Assistant message comes BEFORE user (renders above)
    }

    return 0; // Same role and timestamp, maintain existing order
  });
}

/**
 * Merge streaming message into existing messages array
 * Used during live streaming to update the UI
 */
export function mergeStreamingMessage(
  existingMessages: ChatMessage[],
  streamingContent: string,
  streamingMessageId?: string
): ChatMessage[] {
  const normalized = normalizeMessages(existingMessages);

  // Check if we already have a streaming message
  const streamingIndex = normalized.findIndex(
    m => m.id === streamingMessageId || m.status === 'streaming'
  );

  const streamingMessage: ChatMessage = {
    id: streamingMessageId || `streaming_${Date.now()}`,
    role: 'assistant',
    content: streamingContent,
    status: 'streaming',
    timestamp: new Date().toISOString(),
    mcpCalls: [],
    toolCalls: []
  };

  if (streamingIndex >= 0) {
    // Update existing streaming message
    const updated = [...normalized];
    updated[streamingIndex] = {
      ...updated[streamingIndex],
      content: streamingContent
    };
    return updated;
  } else {
    // Add new streaming message
    return [...normalized, streamingMessage];
  }
}

/**
 * Calculate total tokens used in conversation
 */
export function calculateTotalTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, msg) => {
    const usage = msg.tokenUsage;
    if (usage && typeof usage.totalTokens === 'number') {
      return total + usage.totalTokens;
    }
    return total;
  }, 0);
}

/**
 * Filter messages for display (exclude system messages, etc.)
 */
export function filterDisplayMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter(msg => {
    // Keep user and assistant messages
    if (msg.role === 'user' || msg.role === 'assistant') return true;

    // Keep tool messages only if they have visible content
    if (msg.role === 'tool' && msg.content) return true;

    // Exclude system messages
    return false;
  });
}

/**
 * Deduplicate messages by ID (Database-First Pattern)
 *
 * With Database-First, PostgreSQL is the single source of truth.
 * Messages are saved BEFORE streaming, so duplicates should be rare.
 *
 * This function now prioritizes database-confirmed messages over optimistic ones.
 *
 * Deduplication strategy:
 * 1. If two messages have the same ID, keep the one from database (source='database')
 * 2. Otherwise, keep the most recent version (last in array)
 * 3. Database IDs are authoritative - never deduplicate if different
 */
export function deduplicateMessages(messages: ChatMessage[]): ChatMessage[] {
  const messageMap = new Map<string, ChatMessage>();

  // Process messages in order, newer messages will overwrite older
  for (const msg of messages) {
    const existingMsg = messageMap.get(msg.id);

    if (!existingMsg) {
      // First occurrence of this ID
      messageMap.set(msg.id, msg);
    } else {
      // Duplicate ID found - decide which to keep
      const existingIsFromDb = (existingMsg as any).source === 'database' || (existingMsg as any).confirmed;
      const newIsFromDb = (msg as any).source === 'database' || (msg as any).confirmed;

      if (newIsFromDb && !existingIsFromDb) {
        // Prefer database-confirmed message over optimistic
        messageMap.set(msg.id, msg);
      } else if (!newIsFromDb && existingIsFromDb) {
        // Keep existing database message
        continue;
      } else {
        // Both from same source, keep newer (last in array)
        messageMap.set(msg.id, msg);
      }
    }
  }

  return Array.from(messageMap.values());
}
