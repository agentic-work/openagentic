/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
