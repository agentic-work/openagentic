/**
 * AgenticActivityStream - Claude.ai-style Agentic Activity Display
 *
 * This is the SOURCE OF TRUTH for displaying AI agent activity.
 *
 * Features:
 * - "X steps" collapsible container with step count
 * - Vertical timeline connector between steps
 * - Nested thinking blocks
 * - Tool result previews with summaries
 * - Auto-collapse when complete
 * - Summary line for completed steps
 *
 * Usage:
 * ```tsx
 * import { AgenticActivityStream } from '@/features/chat/components/AgenticActivityStream';
 *
 * <AgenticActivityStream
 *   contentBlocks={blocks}
 *   toolCalls={toolCalls}
 *   isStreaming={true}
 *   streamingState="tool_use"
 *   onInterrupt={() => handleInterrupt()}
 * />
 * ```
 */

export { AgenticActivityStream, AgenticActivityStream as default } from './AgenticActivityStream';

// Re-export types
export * from './types/activity.types';

// Re-export hooks
export { useActivityParser, useInlineStepsAdapter } from './hooks';
