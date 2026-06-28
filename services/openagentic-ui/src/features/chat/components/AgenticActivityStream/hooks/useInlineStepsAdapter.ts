/**
 * useInlineStepsAdapter - Bridge InlineSteps data to AgenticActivityStream format
 *
 * Converts existing InlineStep data format to the ContentBlock/ToolCall/AgenticTask
 * format used by AgenticActivityStream. This allows gradual migration from
 * InlineSteps to AgenticActivityStream.
 *
 * Usage:
 * ```tsx
 * const { contentBlocks, toolCalls, tasks, streamingState } = useInlineStepsAdapter({
 *   steps,
 *   currentThinking,
 *   isStreaming,
 *   thinkingDuration,
 * });
 *
 * <AgenticActivityStream
 *   contentBlocks={contentBlocks}
 *   toolCalls={toolCalls}
 *   tasks={tasks}
 *   streamingState={streamingState}
 *   isStreaming={isStreaming}
 * />
 * ```
 */

import { useMemo } from 'react';
import type {
  ContentBlock,
  ToolCall,
  AgenticTask,
  StreamingState,
  ToolCallStatus,
  InlineStep,
} from '../types/activity.types';

interface UseInlineStepsAdapterOptions {
  steps: InlineStep[];
  currentThinking?: string;
  isStreaming?: boolean;
  thinkingDuration?: number;
  currentModel?: string;
  /** Override: force thinking state even when currentThinking not passed (for interleaved mode) */
  isActivelyThinking?: boolean;
}

interface UseInlineStepsAdapterReturn {
  contentBlocks: ContentBlock[];
  toolCalls: ToolCall[];
  tasks: AgenticTask[];
  streamingState: StreamingState;
}

/**
 * Map InlineStep status to ToolCallStatus
 */
const mapStepStatusToToolStatus = (status: InlineStep['status']): ToolCallStatus => {
  switch (status) {
    case 'running':
      return 'calling';
    case 'complete':
    case 'completed':
      return 'success';
    case 'error':
      return 'error';
    default:
      return 'calling';
  }
};

/**
 * Map InlineStep status to AgenticTask status
 */
const mapStepStatusToTaskStatus = (status: InlineStep['status']): AgenticTask['status'] => {
  switch (status) {
    case 'running':
      return 'in_progress';
    case 'complete':
    case 'completed':
      return 'completed';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
};

/**
 * Convert InlineStep type to a display name
 */
const getToolDisplayName = (step: InlineStep): string => {
  const typeDisplayNames: Record<InlineStep['type'], string> = {
    thinking: 'Thinking',
    tool: 'Tool',
    search: 'Search',
    read: 'Read File',
    write: 'Write File',
    bash: 'Run Command',
    edit: 'Edit File',
    glob: 'Find Files',
    grep: 'Search Code',
    handoff: 'Handoff',
    web_search: 'Web Search',
    mcp: 'MCP Tool',
  };

  return typeDisplayNames[step.type] || 'Tool';
};

export function useInlineStepsAdapter({
  steps,
  currentThinking,
  isStreaming = false,
  thinkingDuration = 0,
  currentModel,
  isActivelyThinking = false,
}: UseInlineStepsAdapterOptions): UseInlineStepsAdapterReturn {
  // Convert steps to content blocks
  const contentBlocks = useMemo<ContentBlock[]>(() => {
    const blocks: ContentBlock[] = [];
    let blockIndex = 0;

    // Add current streaming thinking as a content block
    // CRITICAL FIX: Use stable ID - Date.now() causes new IDs on every re-render!
    if (currentThinking) {
      blocks.push({
        id: `thinking-streaming-adapter`, // Stable ID - same thinking block throughout streaming
        type: 'thinking',
        content: currentThinking,
        timestamp: Date.now(), // timestamp can change, id should not
      });
      blockIndex++;
    }

    // Process ALL steps in a SINGLE pass to preserve interleaved order.
    // Previously thinking and tool steps were processed in two separate loops,
    // which bunched all thinking at the top and all tools at the bottom.
    const seenContent = new Set<string>();
    steps.forEach((step, idx) => {
      if (step.type === 'thinking') {
        const thinkingContent = step.content || step.details?.content;
        if (thinkingContent && !seenContent.has(thinkingContent)) {
          seenContent.add(thinkingContent);
          const isDone = step.status === 'complete' || step.status === 'completed';
          blocks.push({
            id: step.id || `thinking-${idx}-${blockIndex}`,
            type: 'thinking',
            content: thinkingContent,
            isComplete: isDone,
            timestamp: step.startTime || Date.now(),
          });
          blockIndex++;
        }
      } else {
        const isComplete = step.status === 'complete' || step.status === 'completed';
        blocks.push({
          id: step.id || `tool-${idx}-${blockIndex}`,
          type: 'tool_use',
          toolId: step.id,
          toolName: step.title || getToolDisplayName(step),
          content: step.request || step.details?.args ? JSON.stringify(step.details?.args || step.request) : '',
          isComplete,
          timestamp: step.startTime || Date.now(),
          agentId: step.agentId,
          agentRole: step.agentRole,
        });
        blockIndex++;
      }
    });

    return blocks;
  }, [steps, currentThinking]);

  // Convert tool steps to ToolCall format
  const toolCalls = useMemo<ToolCall[]>(() => {
    return steps
      .filter(step => step.type !== 'thinking')
      .map(step => ({
        id: step.id,
        toolName: step.type,
        displayName: step.title || step.content || getToolDisplayName(step),
        status: mapStepStatusToToolStatus(step.status),
        input: step.request || step.details?.args,
        output: step.response || step.details?.result || step.summary,
        duration: step.duration,
        startTime: step.startTime || Date.now(),
        progressMessage: step.progressMessage,
        isCollapsed: step.status === 'complete' || step.status === 'completed',
      }));
  }, [steps]);

  // Create tasks from steps for the task progress view
  // This provides a high-level view of what the agent is working on
  const tasks = useMemo<AgenticTask[]>(() => {
    // Only show tasks if there are multiple steps (indicates a complex operation)
    if (steps.length < 2) return [];

    return steps
      .filter(step => step.type !== 'thinking')
      .map(step => ({
        id: `task-${step.id}`,
        title: step.title || step.content || getToolDisplayName(step),
        activeForm: step.type === 'thinking'
          ? 'Analyzing...'
          : `Running ${getToolDisplayName(step).toLowerCase()}...`,
        status: mapStepStatusToTaskStatus(step.status),
        progress: step.status === 'complete' || step.status === 'completed' ? 100 : undefined,
        startedAt: step.startTime,
        completedAt: step.endTime,
      }));
  }, [steps]);

  // Determine streaming state
  const streamingState = useMemo<StreamingState>(() => {
    if (!isStreaming) return 'complete';

    // Check if actively thinking (either from currentThinking or explicit flag)
    const hasActiveThinking = (currentThinking && currentThinking.length > 0) || isActivelyThinking;
    const hasRunningTool = steps.some(s => s.status === 'running');
    const hasError = steps.some(s => s.status === 'error');

    if (hasError) return 'error';
    if (hasRunningTool) return 'tool_use';
    if (hasActiveThinking) return 'thinking';

    return 'streaming';
  }, [isStreaming, currentThinking, steps, isActivelyThinking]);

  return {
    contentBlocks,
    toolCalls,
    tasks,
    streamingState,
  };
}

export default useInlineStepsAdapter;
