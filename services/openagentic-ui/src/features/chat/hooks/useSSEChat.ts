/**
 * useSSEChat Hook
 * Server-Sent Events (SSE) implementation for real-time chat streaming
 * Features: Message streaming, pipeline state tracking, error recovery, MCP tool handling
 * Pipeline stages: auth → validation → prompt → mcp → completion → response
 * Methods:
 * - sendMessage: Sends user message and initiates SSE stream
 * - stopStreaming: Aborts current stream
 * - resetError: Clears error state
 * Handles: Token usage tracking, thinking blocks, tool calls, message formatting
 * @see docs/chat/streaming-architecture.md
 */

import { useState, useCallback, useRef, useEffect } from 'react';
// flushSync removed - React 18 batching is sufficient for streaming updates
import { apiEndpoint } from '@/utils/api';
import type { NormalizedStreamEvent } from '../../../types/NormalizedStreamTypes';

import { formatAgentMessage, addVisualEnhancements } from '@/utils/messageFormatter';
import { useAuth } from '@/app/providers/AuthContext';
import { ChatMessage } from '@/types/index';
import { useChatStore } from '@/stores/useChatStore';
import { useAgentTreeStore } from '@/stores/useAgentTreeStore';

// Pipeline stages from ChatPipeline backend
export type PipelineStage = 'auth' | 'validation' | 'prompt' | 'mcp' | 'completion' | 'response';

// Pipeline state to track current processing phase
export interface PipelineState {
  currentStage: PipelineStage | null;
  stageStartTime: number | null;
  stageTiming: Record<string, number>;
  isToolExecutionPhase: boolean;
  activeToolRound: number;
  maxToolRounds: number;
  bufferedContent: string;
  shouldSuppressContent: boolean;
}

// Animation modes for streaming - simplified
export type AnimationMode = 'smooth' | 'none';

// Content block for interleaved thinking
// Each block can be either thinking or text, rendered in order
export interface ContentBlock {
  id: string;            // Unique ID for React key (block-{index}-{timestamp})
  index: number;         // Server block index + offset
  type: 'thinking' | 'text' | 'tool_use';
  content: string;
  isComplete: boolean;
  toolName?: string;
  toolId?: string;
  timestamp?: number;    // For activity.types.ts compatibility
  agentId?: string;      // Sub-agent ID (for spawn_parallel_agents children)
  parentToolId?: string; // Parent tool_use block ID (nesting)
  agentRole?: string;    // Agent role description (e.g., "data_query")
  startTime?: number;    // ms epoch when this block began streaming
  duration?: number;     // ms elapsed from startTime to isComplete
  result?: unknown;      // For tool_use — the resolved tool result JSON
  error?: string;        // For tool_use — error message if the tool failed
}

// Pipeline-aware event types that match backend ChatPipeline
interface PipelineEvents {
  'pipeline:start': { messageId: string; stage: PipelineStage };
  'pipeline:stage': { stage: PipelineStage; data: any };
  'pipeline:tool_round': { round: number; maxRounds: number };
  'pipeline:content_suppressed': { stage: PipelineStage; reason: string };
  'pipeline:complete': { metrics: any };
}

// Create initial pipeline state
const createInitialPipelineState = (): PipelineState => ({
  currentStage: null,
  stageStartTime: null,
  stageTiming: {},
  isToolExecutionPhase: false,
  activeToolRound: 0,
  maxToolRounds: 5, // Match backend maxToolCallRounds
  bufferedContent: '',
  shouldSuppressContent: false
});

// Determine if content should be suppressed based on pipeline stage
const shouldSuppressContentForStage = (stage: PipelineStage | null, toolRound: number): boolean => {
  if (!stage) return false;
  
  // Suppress content during tool execution phases
  if (stage === 'mcp' && toolRound > 0) return true;
  
  // Allow content during final completion phase
  if (stage === 'completion' || stage === 'response') return false;
  
  // Suppress during early stages
  if (stage === 'auth' || stage === 'validation' || stage === 'prompt') return true;
  
  return false;
};

// Map backend stage names to our pipeline stages
const mapBackendStage = (eventType: string): PipelineStage | null => {
  switch (eventType) {
    case 'auth_start':
    case 'auth_complete':
      return 'auth';
    case 'validation_start':
    case 'validation_complete':
      return 'validation';
    case 'prompt_start':
    case 'prompt_complete':
    case 'prompt_engineering':
      return 'prompt';
    case 'mcp_start':
    case 'mcp_complete':
    case 'tool_execution_start':
    case 'tool_execution_complete':
    case 'completion_restart':
    case 'tool_executing':
    case 'tool_result':
    case 'tool_call_delta':
      return 'mcp';
    case 'completion_start':
    case 'completion_complete':
      return 'completion';
    case 'response_start':
    case 'stream_complete':
    case 'done':
      return 'response';
    default:
      return null;
  }
};

// Get animation mode from user preferences
const getAnimationMode = (): AnimationMode => {
  if (typeof window === 'undefined') return 'none';
  
  const saved = localStorage.getItem('chat-animation-mode');
  if (saved === 'smooth' || saved === 'none') return saved;
  
  // Default to smooth for better UX now that we have proper pipeline awareness
  return 'smooth';
};

// Extract thinking blocks and return both cleaned content and thinking
function extractAndCleanThinkingBlocks(content: string): { cleaned: string; thinking: string } {
  // Fast path: skip expensive regex if no thinking tags present
  if (!content.includes('<thinking>') && !content.includes('<reasoning>') && !content.includes('<tool_code>')) {
    return { cleaned: content, thinking: '' };
  }

  let cleanContent = content;
  const thinkingParts: string[] = [];

  // Extract and remove <thinking> blocks
  let match;
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  while ((match = thinkingRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(thinkingRegex, '');

  // Extract and remove <reasoning> blocks
  const reasoningRegex = /<reasoning>([\s\S]*?)<\/reasoning>/g;
  while ((match = reasoningRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(reasoningRegex, '');

  // Extract and remove <tool_code> blocks
  const toolCodeRegex = /<tool_code>([\s\S]*?)<\/tool_code>/g;
  while ((match = toolCodeRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }
  cleanContent = cleanContent.replace(toolCodeRegex, '');

  // Clean up any extra whitespace
  cleanContent = cleanContent.trim().replace(/\n{3,}/g, '\n\n');

  return {
    cleaned: cleanContent,
    thinking: thinkingParts.join('\n\n---\n\n')
  };
}

// Backward compatibility wrapper
function cleanThinkingBlocks(content: string): string {
  return extractAndCleanThinkingBlocks(content).cleaned;
}

export interface McpApprovalRequest {
  requestId: string;
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  timeoutMs: number;
}

// Multi-model orchestration event - flexible type for various event shapes
export interface MultiModelEvent {
  type: string;
  orchestrationId?: string;
  executionPlan?: string[];
  fromModel?: string;
  toModel?: string;
  role?: string;
  rolesExecuted?: string[];
  totalCost?: number;
  model?: string;
  content?: string;
  fromRole?: string;
  toRole?: string;
  handoffCount?: number;
  totalDuration?: number;
  error?: string;
  agents?: any[];
  strategy?: string;
  metrics?: any;
  [key: string]: any; // Allow additional properties for extensibility
}

export interface UseSSEChatOptions {
  sessionId: string;
  onMessage?: (message: ChatMessage) => void;
  onToolExecution?: (tool: any) => void;
  onToolApprovalRequest?: (data: { tools: any[]; toolCallRound: number; messageId: string }) => void;
  onMcpApprovalRequest?: (data: McpApprovalRequest) => void;
  onError?: (error: Error) => void;
  onThinking?: (status: string) => void;
  onThinkingContent?: (content: string, tokens?: number) => void;  // For actual thinking content
  onThinkingComplete?: () => void;  // When thinking finishes
  onMultiModel?: (event: MultiModelEvent) => void;  // Multi-model orchestration events
  onStream?: (content: string) => void;
  onPipelineStage?: (stage: PipelineStage, data?: any) => void;
  onToolRound?: (round: number, maxRounds: number) => void;
  onSessionTitleUpdated?: (sessionId: string, title: string) => void;  // AI-generated session title
  autoApproveTools?: boolean;
}

export const useSSEChat = ({
  sessionId,
  onMessage,
  onToolExecution,
  onToolApprovalRequest,
  onMcpApprovalRequest,
  onError,
  onThinking,
  onThinkingContent,
  onThinkingComplete,
  onMultiModel,
  onStream,
  onPipelineStage,
  onToolRound,
  onSessionTitleUpdated,
  autoApproveTools = false // HITM enforced: tools always require user approval
}: UseSSEChatOptions) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentMessage, setCurrentMessage] = useState('');
  const [currentThinking, setCurrentThinking] = useState('');
  const [isThinkingCompleted, setIsThinkingCompleted] = useState(false); // Tracks if thinking phase has finished
  const currentThinkingRef = useRef(''); // Ref to capture thinking at message completion time

  // Interleaved content blocks - renders thinking/text in order
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const contentBlocksRef = useRef<ContentBlock[]>([]); // Ref for closure access
  const blockIndexOffsetRef = useRef<number>(0); // Offset for multi-round tool loops (prevents index collision)
  const currentThinkingBlockIndexRef = useRef<number | null>(null); // Track active thinking block for interleaved display
  const currentTextBlockIndexRef = useRef<number | null>(null); // Track active text block for interleaved display
  const [thinkingMetrics, setThinkingMetrics] = useState<{
    tokens: number;
    elapsedMs: number;
    tokensPerSecond: number;
  } | null>(null);
  // Thinking budget tracking for real progress indicator
  const [thinkingBudget, setThinkingBudget] = useState<number>(0);
  const [thinkingPhase, setThinkingPhase] = useState<'thinking' | 'tools' | 'generating'>('thinking');
  const previousSessionIdRef = useRef<string | null>(null); // Track session changes
  // TTFT (Time to First Token) tracking for debugging slow responses
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  // Context compaction notification
  const [contextCompaction, setContextCompaction] = useState<{
    freedPercent: number;
    tokensFreed: number;
    compactionLevel: string;
  } | null>(null);
  // Normalized stream events (UNIFIED_STREAM=true path)
  const [normalizedEvents, setNormalizedEvents] = useState<NormalizedStreamEvent[]>([]);
  const normalizedEventsRef = useRef<NormalizedStreamEvent[]>([]);

  // Chain of Thought steps for COT UI display
  const [cotSteps, setCotSteps] = useState<Array<{
    id: string;
    type: 'thinking' | 'tool_call' | 'rag_lookup' | 'fetch' | 'memory' | 'reasoning';
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    startTime?: number;
    endTime?: number;
    request?: any;
    response?: any;
    error?: string;
  }>>([]);
  // Ref to capture cotSteps at message completion time (for closure access)
  const cotStepsRef = useRef<typeof cotSteps>([]);
  const [pipelineState, setPipelineState] = useState<PipelineState>(createInitialPipelineState);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { getAccessToken, user } = useAuth();
  const [animationMode, setAnimationMode] = useState<AnimationMode>(getAnimationMode());

  // Keep refs in sync with state for capturing at completion time
  useEffect(() => {
    currentThinkingRef.current = currentThinking;
  }, [currentThinking]);

  // Keep cotSteps ref in sync for closure access in done handler
  useEffect(() => {
    cotStepsRef.current = cotSteps;
  }, [cotSteps]);

  // Keep contentBlocks ref in sync for closure access
  useEffect(() => {
    contentBlocksRef.current = contentBlocks;
  }, [contentBlocks]);

  // CRITICAL FIX: Abort active stream AND reset state when session changes
  // This prevents messages from bleeding between sessions
  useEffect(() => {
    if (previousSessionIdRef.current !== null && previousSessionIdRef.current !== sessionId) {
      // Session changed — IMMEDIATELY abort any running stream
      if (abortControllerRef.current) {
        console.warn('[SSE] Session changed while stream active — ABORTING old stream:', {
          from: previousSessionIdRef.current,
          to: sessionId
        });
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      // Reset all thinking/streaming state
      setCurrentThinking('');
      setCurrentMessage('');
      setIsThinkingCompleted(false);
      setThinkingMetrics(null);
      setCotSteps([]);
      setContentBlocks([]);
      setPipelineState(createInitialPipelineState());
      currentThinkingRef.current = '';
      cotStepsRef.current = [];
      contentBlocksRef.current = [];
      currentThinkingBlockIndexRef.current = null;
      currentTextBlockIndexRef.current = null;
      // Clear normalized stream events from previous session — these feed
      // MessageBubble's AgenticActivityStream and would otherwise render the
      // old session's agent cards in the new session ("ghost agents" bug).
      setNormalizedEvents([]);
      normalizedEventsRef.current = [];
      // Clear the global agent tree store — same reason. The store is keyed
      // by executionId and is NOT session-scoped, so without an explicit clear
      // the previous session's trees persist until the next stream finishes.
      useAgentTreeStore.getState().clearAllTrees();
    }
    previousSessionIdRef.current = sessionId;
  }, [sessionId]);

  const sendMessage = useCallback(async (
    message: string,
    options?: {
      model?: string;
      enabledTools?: string[];
      files?: any[];
      promptTechniques?: string[];
      enableExtendedThinking?: boolean;
      flowContext?: any;
      artifactContext?: { content: string; title: string; type: string };
    }
  ) => {
    // Critical debug logging
    // console.log('[SSE] sendMessage called with:', { message, sessionId, options });
    
    // Validate sessionId before attempting to send
    if (!sessionId || sessionId.trim() === '') {
      console.error('[SSE] Cannot send message - no sessionId provided');
      setIsStreaming(false);
      if (onError) {
        onError(new Error('No session ID provided'));
      }
      return;
    }
    
    // CRITICAL FIX: Save current streaming message BEFORE clearing it
    // If there's a streaming message in progress, finalize it first to prevent message loss
    if (currentMessage && onMessage) {
      // console.log('[SSE] Finalizing previous streaming message before starting new one');
      onMessage({
        id: `streaming_${Date.now()}`,
        role: 'assistant',
        content: currentMessage,
        timestamp: new Date().toISOString(),
        mcpCalls: [],
        metadata: { streamingInterrupted: true }
      });
    }

    // Abort any existing stream and wait briefly to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      // Small delay to ensure cleanup is complete before creating new controller
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Create new abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Additional safety check - if the controller was somehow aborted immediately, recreate it
    if (abortController.signal.aborted) {
      // console.warn('[SSE] AbortController was aborted immediately, creating new one');
      const newController = new AbortController();
      abortControllerRef.current = newController;
    }

    setIsStreaming(true);
    setCurrentMessage('');
    setCurrentThinking('');
    setContentBlocks([]); // Reset interleaved content blocks for new message
    contentBlocksRef.current = [];
    blockIndexOffsetRef.current = 0; // Reset block index offset for new message
    setIsThinkingCompleted(false); // Reset thinking completion flag
    setThinkingMetrics(null);
    setThinkingBudget(0); // Reset thinking budget
    setThinkingPhase('thinking'); // Reset phase
    setTtftMs(null); // Reset TTFT for new message
    setCotSteps([]); // Clear COT steps for new message
    setPipelineState(createInitialPipelineState());
    normalizedEventsRef.current = [];
    setNormalizedEvents([]);
    
    let hasReportedError = false;
    let hasCompletedStream = false;

    try {
      // Get access token - try multiple auth methods
      let token;
      try {
        token = await getAccessToken(['User.Read']);
      } catch (error) {
        console.error('[SSE] getAccessToken failed:', error);
        // Fallback to manual token retrieval (try all known key names + cookie)
        token = localStorage.getItem('accessToken') || localStorage.getItem('auth_token') || sessionStorage.getItem('accessToken');
        if (!token) {
          // Extract from cookie as last resort
          const match = document.cookie.match(/openagentic_token=([^;]+)/);
          if (match) token = match[1];
        }
      }
      
      if (!token) {
        console.error('[SSE] No authentication token available');
        throw new Error('Authentication required - no token available');
      }

      // Critical debug logging - always log this fetch attempt
      // console.log('[SSE] About to send fetch request to:', apiEndpoint('/chat/stream'), {
      //   sessionId,
      //   model: options?.model,
      //   hasToken: !!token,
      //   tokenLength: token?.length,
      //   userId: user?.id || user?.oid,
      //   fullPayload: {
      //     sessionId,
      //     message,
      //     model: options?.model,
      //     enabledTools: options?.enabledTools || [],
      //     autoApproveTools,
      //     files: options?.files,
      //     promptTechniques: options?.promptTechniques || []
      //   }
      // });

      // console.log('[SSE] FETCH REQUEST STARTING NOW - URL:', apiEndpoint('/chat/stream'));
      // console.log('[SSE] FETCH REQUEST HEADERS:', {
      //   'Content-Type': 'application/json',
      //   'Authorization': token ? `Bearer ${token.substring(0, 20)}...` : 'NO TOKEN',
      //   'x-user-id': user?.id || user?.oid
      // });
      
      const response = await fetch(apiEndpoint('/chat/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'x-user-id': user?.id || user?.userId || '',
          // CRITICAL: Tell browser/proxy not to cache this SSE stream
          'Cache-Control': 'no-cache',
          // CRITICAL: Accept SSE event stream
          'Accept': 'text/event-stream'
        },
        body: JSON.stringify({
          sessionId,
          message,
          model: options?.model,
          enabledTools: options?.enabledTools || [],
          autoApproveTools,
          files: options?.files,
          promptTechniques: options?.promptTechniques || [],
          enableExtendedThinking: options?.enableExtendedThinking,
          flowContext: options?.flowContext,
          artifactContext: options?.artifactContext
        }),
        signal: abortControllerRef.current?.signal,
        // CRITICAL: Disable browser caching for SSE
        cache: 'no-store'
      });
      
      // SSE response logging - disabled in production to reduce console noise
      // console.log('[SSE] FETCH REQUEST COMPLETED - Response received:', {
      //   status: response.status,
      //   ok: response.ok,
      //   statusText: response.statusText,
      //   contentType: response.headers.get('content-type'),
      //   hasBody: !!response.body
      // });

      // Log errors
      if (!response.ok) {
        console.error('[SSE] Response error:', {
          status: response.status,
          ok: response.ok
        });
      }
      
      if (!response.ok) {
        console.error('[SSE] HTTP ERROR - Response not ok:', {
          status: response.status,
          statusText: response.statusText
        });
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('No response body');
      }
      
      let assistantMessage = '';
      let messageId = '';
      let mcpCalls: any[] = [];
      let chunkCount = 0;
      let currentPipelineState = createInitialPipelineState();
      let hasCompletedStream = false; // Guard against duplicate done events
      let hasReportedError = false; // Guard against duplicate error messages (fixes 3x error display)
      let responseModel = options?.model || ''; // Track which model was used for this response (fallback to requested model)
      
      // Rolling idle timeout - resets on every received chunk/ping
      // This allows long-running agentic loops (tool calls, thinking) to run indefinitely
      // as long as the server keeps sending data (pings every 3s, tool events, content deltas)
      const STREAM_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes of INACTIVITY (not total time)
      let streamTimeoutId: ReturnType<typeof setTimeout>;
      const resetStreamTimeout = () => {
        clearTimeout(streamTimeoutId);
        streamTimeoutId = setTimeout(() => {
          abortControllerRef.current?.abort();
          onError?.(new Error('Stream timeout - no data received for 5 minutes'));
        }, STREAM_IDLE_TIMEOUT);
      };
      resetStreamTimeout();
      
      // Proper SSE parsing that doesn't break on JSON boundaries
      let buffer = '';
      let eventType = '';
      let eventData = '';
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            clearTimeout(streamTimeoutId);
            if (import.meta.env.DEV) {
              // console.log('[SSE] Stream complete, total chunks:', chunkCount);
            }
            break;
          }
        
        chunkCount++;
        resetStreamTimeout(); // Reset idle timeout on every received chunk
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Chunk reception logging - disabled in production
        // if (chunkCount === 1 || chunkCount % 10 === 0) {
        //   console.log(`[SSE] Received chunk #${chunkCount}, size: ${chunk.length} bytes`);
        // }

        // SSE uses double newline as event separator - this prevents JSON boundary splits
        const eventStrings = buffer.split('\n\n');
        
        // Keep the last incomplete event in buffer
        buffer = eventStrings.pop() || '';
        
        for (const eventString of eventStrings) {
          if (!eventString.trim()) continue;
          
          const lines = eventString.split('\n');
          let eventType = null;
          let eventData = '';
          
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7);
            } else if (line.startsWith('data: ')) {
              // Accumulate data lines (SSE allows multiple data: lines)
              eventData += line.slice(6);
            }
          }
          
          if (eventData) {
            try {
              // JSON.parse already returns fresh, extensible objects - no need to clone again
              const safeData = JSON.parse(eventData);

              // SSE event logging - disabled in production to reduce console noise
              // Enable by uncommenting for debugging streaming issues
              // console.log(`[SSE-DEBUG] Event received - Type: "${eventType}"`, safeData);

              // Only log specific events in dev when needed for debugging
              // if (import.meta.env.DEV && ['error', 'tool_call', 'pipeline', 'stream'].includes(eventType || '')) {
              //   console.log(`[SSE] Processing event: ${eventType}`, safeData);
              // }
              
              // Update pipeline state based on event
              const mappedStage = mapBackendStage(eventType || '');
              if (mappedStage && mappedStage !== currentPipelineState.currentStage) {
                // Stage transition
                if (currentPipelineState.currentStage && currentPipelineState.stageStartTime) {
                  const stageTime = Date.now() - currentPipelineState.stageStartTime;
                  currentPipelineState.stageTiming[currentPipelineState.currentStage] = stageTime;
                }
                
                currentPipelineState.currentStage = mappedStage;
                currentPipelineState.stageStartTime = Date.now();
                
                // Update tool execution phase detection
                currentPipelineState.isToolExecutionPhase = mappedStage === 'mcp';
                
                // Update content suppression
                currentPipelineState.shouldSuppressContent = shouldSuppressContentForStage(
                  mappedStage, 
                  currentPipelineState.activeToolRound
                );
                
                setPipelineState({...currentPipelineState});
                onPipelineStage?.(mappedStage, safeData);
              }
              
              switch (eventType) {
                case 'message_received':
                  messageId = safeData.messageId;
                  break;

                case 'ttft':
                  // Time to First Token - useful for debugging slow responses
                  // This measures how long from request to first content chunk
                  if (safeData.ttftMs) {
                    setTtftMs(safeData.ttftMs);
                    // TTFT logging - disabled in production
                    // console.log(`[SSE-METRICS] ⏱️ TTFT: ${safeData.ttftMs}ms`);
                  }
                  break;

                case 'message_saved':
                  // Database-First: Message confirmed in PostgreSQL before streaming
                  // console.log('[SSE] message_saved event received:', safeData);
                  messageId = safeData.messageId || messageId;

                  // If this is a user message, we can ignore it (already handled by UI)
                  // If this is an assistant message starting to stream, prepare for content
                  if (safeData.role === 'assistant' && safeData.streaming) {
                    // console.log('[SSE] Assistant message starting with DB ID:', messageId);
                  }
                  break;

                case 'message_updated':
                  // Database-First: Final message content after streaming completes
                  // console.log('[SSE] message_updated event received:', safeData);
                  if (safeData.final && safeData.role === 'assistant') {
                    // console.log('[SSE] Assistant message finalized in database:', messageId);
                  }
                  break;

                case 'thinking':
                case 'thinking_event':
                  // Capture AI's real thinking process with metrics from backend
                  // This path is used by Ollama/gpt-oss models (non-Anthropic format)

                  // Handle both 'content' and legacy 'message' fields
                  const thinkingContent = safeData.content || safeData.message;
                  const accumulatedThinking = safeData.accumulated || thinkingContent || '';

                  if (thinkingContent) {
                    setCurrentThinking(accumulatedThinking);
                    // Also update ref for persistence
                    currentThinkingRef.current = accumulatedThinking;

                    // CRITICAL FIX: Also track as ContentBlock so thinking persists after finalization.
                    // The Anthropic path (thinking_start/thinking_delta) creates ContentBlocks but this
                    // Ollama path did not — causing thinking blocks to vanish after stream completion.
                    // Each thinking round (separated by tool calls) gets its own ContentBlock.
                    if (currentThinkingBlockIndexRef.current === null) {
                      // New thinking round — create a new ContentBlock
                      const thinkingBlockIdx = contentBlocksRef.current.length;
                      const thinkingBlockTs = Date.now();
                      const thinkingCB: ContentBlock = {
                        id: `block-${thinkingBlockIdx}-${thinkingBlockTs}`,
                        index: thinkingBlockIdx,
                        type: 'thinking',
                        content: accumulatedThinking,
                        isComplete: false,
                        timestamp: thinkingBlockTs,
                      };
                      setContentBlocks(prev => [...prev, thinkingCB]);
                      contentBlocksRef.current = [...contentBlocksRef.current, thinkingCB];
                      currentThinkingBlockIndexRef.current = thinkingBlockIdx;
                    } else {
                      // Same thinking round — update existing ContentBlock with accumulated content
                      setContentBlocks(prev => prev.map(block =>
                        block.index === currentThinkingBlockIndexRef.current
                          ? { ...block, content: accumulatedThinking }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === currentThinkingBlockIndexRef.current
                          ? { ...block, content: accumulatedThinking }
                          : block
                      );
                    }
                  }

                  // Capture thinking metrics (tokens, timing, speed)
                  const thinkingTokens = safeData.tokens;
                  if (thinkingTokens !== undefined) {
                    const metrics = {
                      tokens: thinkingTokens,
                      elapsedMs: safeData.elapsedMs || 0,
                      tokensPerSecond: safeData.tokensPerSecond || 0
                    };
                    setThinkingMetrics(metrics);
                  }

                  // Call callbacks for unified activity display
                  onThinking?.(safeData.status || 'Thinking');
                  onThinkingContent?.(accumulatedThinking, thinkingTokens);
                  break;

                case 'thinking_complete':
                  // Thinking phase finished - DON'T clear thinking content here!
                  // Let the UI decide when to collapse/hide the thinking display
                  // The content should remain visible for users to review
                  setIsThinkingCompleted(true); // Mark thinking as completed for UI

                  // Mark ContentBlock as complete for interleaved display
                  if (currentThinkingBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    ));
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    );
                    currentThinkingBlockIndexRef.current = null; // Clear tracking ref
                  }

                  onThinkingComplete?.();
                  // Only clear metrics (the spinner), not the content
                  setThinkingMetrics(null);
                  break;

                case 'token_metrics':
                  // Live token metrics during streaming (separate from thinking events)
                  if (safeData.tokens !== undefined || safeData.elapsedMs !== undefined) {
                    const metrics = {
                      tokens: safeData.tokens || 0,
                      elapsedMs: safeData.elapsedMs || 0,
                      tokensPerSecond: safeData.tokensPerSecond || 0
                    };
                    setThinkingMetrics(metrics);
                  }
                  break;

                case 'stream':
                case 'content_delta':
                case 'delta': // Additional common SSE event name
                  // DISABLED: This was blocking ALL stream events because done event arrives first
                  // if (hasCompletedStream) {
                  //   console.warn('[SSE] Ignoring stream event after completion');
                  //   break;
                  // }

                  // Handle different response formats
                  let contentDelta = '';

                  // Direct content (custom format)
                  if (safeData.content) {
                    contentDelta = safeData.content;
                  }
                  // Delta format (some providers)
                  else if (safeData.delta) {
                    contentDelta = safeData.delta;
                  }
                  // Text format (some providers)
                  else if (safeData.text) {
                    contentDelta = safeData.text;
                  }
                  // OpenAI format (choices[0].delta.content)
                  else if (safeData.choices && safeData.choices[0] && safeData.choices[0].delta && safeData.choices[0].delta.content) {
                    contentDelta = safeData.choices[0].delta.content;
                  }
                  // Raw JSON string response from some providers
                  else if (typeof safeData === 'string') {
                    try {
                      const parsed = JSON.parse(safeData);
                      if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                        contentDelta = parsed.choices[0].delta.content;
                      } else if (parsed.content) {
                        contentDelta = parsed.content;
                      }
                    } catch (e) {
                      // If not JSON, treat as raw content
                      contentDelta = safeData;
                    }
                  }
                  
                  // Pipeline-aware content handling
                  // CRITICAL FIX: Do NOT suppress content during MCP execution - show it in real-time!
                  // The old behavior was buffering content during tool execution, causing the UI to appear frozen
                  // Now we always show content immediately for better UX
                  if (false && currentPipelineState.shouldSuppressContent) {
                    // DISABLED: Buffer content during tool execution phases
                    currentPipelineState.bufferedContent += contentDelta;

                    // Content suppression logging - disabled
                    // if (import.meta.env.DEV) {
                    //   console.log(`[SSE] Content suppressed during ${currentPipelineState.currentStage} stage (tool round ${currentPipelineState.activeToolRound})`);
                    // }
                  } else {
                    // Show content immediately during appropriate phases
                    assistantMessage += contentDelta;

                    // Also include any buffered content if transitioning from suppressed state
                    if (currentPipelineState.bufferedContent) {
                      assistantMessage = currentPipelineState.bufferedContent + assistantMessage;
                      currentPipelineState.bufferedContent = '';
                    }

                    // Extract thinking blocks and clean content
                    const { cleaned, thinking } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);

                    // Set extracted thinking content if found
                    if (thinking) {
                      setCurrentThinking(thinking);
                      // console.log('[SSE] Extracted thinking from stream:', thinking.substring(0, 100) + '...');
                    }

                    // Update text ContentBlock for interleaved display
                    // If no text block exists yet, create one (fallback for providers that don't send content_start)
                    if (currentTextBlockIndexRef.current === null && contentDelta) {
                      const newTextBlockIndex = contentBlocksRef.current.length;
                      const textBlockTimestamp = Date.now();
                      const newTextBlock: ContentBlock = {
                        id: `block-${newTextBlockIndex}-${textBlockTimestamp}`,  // Unique ID for React key
                        index: newTextBlockIndex,
                        type: 'text',
                        content: cleaned,
                        isComplete: false,
                        timestamp: textBlockTimestamp,
                      };
                      setContentBlocks(prev => [...prev, newTextBlock]);
                      contentBlocksRef.current = [...contentBlocksRef.current, newTextBlock];
                      currentTextBlockIndexRef.current = newTextBlockIndex;
                    } else if (currentTextBlockIndexRef.current !== null) {
                      // Update existing text block with cleaned content
                      setContentBlocks(prev => prev.map(block =>
                        block.index === currentTextBlockIndexRef.current
                          ? { ...block, content: cleaned }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === currentTextBlockIndexRef.current
                          ? { ...block, content: cleaned }
                          : block
                      );
                    }

                    onStream?.(contentDelta);
                  }
                  break;

                case 'tool_approval_request':
                  // Human-in-the-loop: AI is requesting approval to execute tools
                  // console.log('[SSE] Tool approval requested:', {
                  //   round: safeData.toolCallRound,
                  //   toolCount: safeData.tools?.length,
                  //   tools: safeData.tools
                  // });

                  // Call the approval callback to display the dialog
                  if (onToolApprovalRequest && safeData.tools && safeData.tools.length > 0) {
                    onToolApprovalRequest({
                      tools: safeData.tools,
                      toolCallRound: safeData.toolCallRound,
                      messageId: safeData.messageId
                    });
                  }
                  break;

                case 'mcp_approval_required':
                  // HITL: Server-side ToolApprovalGate requires human approval for CRUD/destructive tool
                  if (onMcpApprovalRequest && safeData.requestId) {
                    onMcpApprovalRequest({
                      requestId: safeData.requestId,
                      toolName: safeData.toolName,
                      serverName: safeData.serverName,
                      arguments: safeData.arguments || {},
                      riskLevel: safeData.riskLevel || 'medium',
                      reason: safeData.reason || '',
                      timeoutMs: safeData.timeoutMs || 60000,
                    });
                  }
                  break;

                case 'force_reauth':
                  // Server says token is expired and can't be refreshed — force logout
                  console.warn('[SSE] Force re-authentication required:', safeData.reason);
                  // Clear local auth state and redirect to login
                  try {
                    localStorage.removeItem('accessToken');
                    sessionStorage.removeItem('accessToken');
                    // Redirect to login page after a short delay to allow the user to see the message
                    setTimeout(() => {
                      window.location.href = '/';
                    }, 2000);
                  } catch (e) {
                    console.error('[SSE] Failed to clear auth state:', e);
                  }
                  // Also fire the error callback so the user sees a message
                  onError?.(new Error(safeData.message || 'Session expired. Please sign in again.'));
                  break;

                case 'tool_execution_start':
                  // Update pipeline state for tool execution
                  currentPipelineState.isToolExecutionPhase = true;
                  currentPipelineState.activeToolRound = Math.max(1, currentPipelineState.activeToolRound);
                  // CRITICAL FIX: DO NOT suppress content during tool execution
                  // We want real-time streaming even during MCP tool calls
                  currentPipelineState.shouldSuppressContent = false;

                  // Update thinking phase to tools for progress indicator
                  setThinkingPhase('tools');

                  setPipelineState({...currentPipelineState});
                  onToolRound?.(currentPipelineState.activeToolRound, currentPipelineState.maxToolRounds);
                  onToolExecution?.({
                    type: 'start',
                    tools: safeData.tools,
                    round: currentPipelineState.activeToolRound
                  });
                  break;

                case 'tool_execution_complete':
                  // Tool execution finished - prepare for next completion stream
                  currentPipelineState.isToolExecutionPhase = false;
                  onToolExecution?.({
                    type: 'complete',
                    executionTimeMs: safeData.executionTimeMs,
                    successCount: safeData.successCount,
                    errorCount: safeData.errorCount
                  });
                  break;

                case 'completion_restart':
                  // Completion is restarting after tool execution
                  // Un-suppress content so the next completion stream shows
                  currentPipelineState.shouldSuppressContent = false;
                  setPipelineState({...currentPipelineState});

                  // CRITICAL FIX: Set block index offset to current length
                  // Server restarts block indices at 0 for each LLM call, but we need
                  // unique indices to prevent all thinking blocks from merging together
                  blockIndexOffsetRef.current = contentBlocksRef.current.length;
                  console.debug('[SSE] completion_restart - block index offset set to:', blockIndexOffsetRef.current);
                  break;

                case 'completion_start':
                  // Capture the model at completion start for the response badge
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;

                case 'react_progress':
                case 'completeness_check':
                  // ReAct cognitive loop events — pass to activity stream for display
                  console.debug(`[SSE] ${eventType}`, safeData);
                  break;

                case 'tool_executing': {
                  // Fire callback for external consumers
                  onToolExecution?.({
                    type: 'executing',
                    name: safeData.name,
                    arguments: safeData.arguments
                  });

                  // CREATE a ContentBlock so the tool appears in the activity stream.
                  // This ensures ALL models (including Ollama) show tool execution inline,
                  // not just models that emit tool_use content blocks (like Claude).
                  const execBlockId = `tool-exec-${safeData.toolCallId || safeData.name}-${Date.now()}`;
                  const existingExecBlock = contentBlocksRef.current.find(
                    b => b.type === 'tool_use' && b.toolName === safeData.name && !b.isComplete
                  );
                  if (!existingExecBlock) {
                    const execBlockIndex = contentBlocksRef.current.length;
                    contentBlocksRef.current = [
                      ...contentBlocksRef.current,
                      {
                        id: execBlockId,
                        index: execBlockIndex,
                        type: 'tool_use' as const,
                        toolName: safeData.name,
                        toolId: safeData.toolCallId || execBlockId,
                        content: JSON.stringify(safeData.arguments || {}),
                        isComplete: false,
                        startTime: Date.now(),
                      }
                    ];
                    setContentBlocks([...contentBlocksRef.current]);
                  }
                  break;
                }

                case 'tool_result': {
                  // Fire callback
                  onToolExecution?.({
                    type: 'result',
                    name: safeData.name,
                    result: safeData.result
                  });

                  // Mark the matching ContentBlock as complete
                  const resultBlockIdx = contentBlocksRef.current.findIndex(
                    b => b.type === 'tool_use' && b.toolName === safeData.name && !b.isComplete
                  );
                  if (resultBlockIdx >= 0) {
                    contentBlocksRef.current[resultBlockIdx] = {
                      ...contentBlocksRef.current[resultBlockIdx],
                      isComplete: true,
                      result: typeof safeData.result === 'string' ? safeData.result : JSON.stringify(safeData.result),
                      duration: Date.now() - (contentBlocksRef.current[resultBlockIdx].startTime || Date.now()),
                    };
                    setContentBlocks([...contentBlocksRef.current]);
                  }
                  break;
                }
                  
                case 'tool_error': {
                  onToolExecution?.({
                    type: 'error',
                    name: safeData.name,
                    error: safeData.error
                  });

                  // Mark matching ContentBlock as error
                  const errBlockIdx = contentBlocksRef.current.findIndex(
                    b => b.type === 'tool_use' && b.toolName === safeData.name && !b.isComplete
                  );
                  if (errBlockIdx >= 0) {
                    contentBlocksRef.current[errBlockIdx] = {
                      ...contentBlocksRef.current[errBlockIdx],
                      isComplete: true,
                      error: safeData.error,
                      duration: Date.now() - (contentBlocksRef.current[errBlockIdx].startTime || Date.now()),
                    };
                    setContentBlocks([...contentBlocksRef.current]);
                  }
                  break;
                }

                case 'tool_progress':
                  // Heartbeat progress event from backend during long-running tool execution
                  onToolExecution?.({
                    type: 'progress',
                    toolCallId: safeData.toolCallId,
                    name: safeData.name,
                    elapsed: safeData.elapsed,
                    message: safeData.message,
                  });
                  break;

                case 'tool_call_delta':
                  // Tool call detected - increment round if needed
                  if (currentPipelineState.activeToolRound === 0) {
                    currentPipelineState.activeToolRound = 1;
                  }

                  // Notify UI about tool calls being made so they display as steps during streaming
                  // These are real LLM function calls (not synthetic) - we just don't have results yet
                  if (safeData.toolCalls && safeData.toolCalls.length > 0) {
                    // FIX: Create tool_use content blocks for non-Anthropic providers (Ollama, OpenAI)
                    // This ensures hasInterleavedContent=true and tools render inline
                    safeData.toolCalls.forEach((tc: any) => {
                      const toolId = tc.id || `tool_${Date.now()}`;
                      const toolName = tc.function?.name || tc.name || 'unknown';
                      const existingBlock = contentBlocksRef.current.find(
                        b => b.type === 'tool_use' && b.toolId === toolId
                      );

                      if (!existingBlock) {
                        const newBlockIndex = contentBlocksRef.current.length;
                        const newBlock: ContentBlock = {
                          id: `tool-${toolId}`,
                          index: newBlockIndex,
                          type: 'tool_use',
                          content: tc.function?.arguments || tc.arguments || '',
                          isComplete: false,
                          timestamp: Date.now(),
                          toolName,
                          toolId,
                        };
                        console.log('[SSE] Creating tool_use content block for non-Anthropic provider:', toolName);
                        setContentBlocks(prev => [...prev, newBlock]);
                        contentBlocksRef.current = [...contentBlocksRef.current, newBlock];
                      }
                    });

                    onToolExecution?.({
                      type: 'tool_call_streaming',
                      calls: safeData.toolCalls.map((tc: any) => ({
                        id: tc.id,
                        name: tc.function?.name || tc.name,
                        tool: tc.function?.name || tc.name,
                        args: tc.function?.arguments || tc.arguments,
                        status: 'running'
                      })),
                      round: currentPipelineState.activeToolRound
                    });
                  }

                  setPipelineState({...currentPipelineState});
                  break;
                  
                case 'tool_call_complete':
                  // CRITICAL FIX: Don't track synthetic tool completions
                  // Real MCP results come through 'mcp_execution' events

                  // Just update pipeline state for tool rounds
                  currentPipelineState.isToolExecutionPhase = false;
                  if (currentPipelineState.activeToolRound < currentPipelineState.maxToolRounds) {
                    currentPipelineState.shouldSuppressContent = false;
                  }

                  setPipelineState({...currentPipelineState});
                  break;
                  
                case 'tool_calls_required':
                  // CRITICAL FIX: Don't initialize synthetic mcpCalls
                  // Real MCP results will come through proper 'mcp_execution' events
                  break;
                  
                case 'mcp_status':
                  // Store MCP status in metadata, don't append to content
                  // This information can be shown in a status bar or separate UI element
                  break;
                  
                case 'session_title':
                  // Update session title in the store
                  if (safeData.title && sessionId) {
                    const { updateSessionTitle } = useChatStore.getState();
                    updateSessionTitle(sessionId, safeData.title);
                  }
                  break;

                case 'multi_model_start':
                case 'orchestration_start':
                  // Multi-model orchestration started
                  console.log('[SSE] Multi-model orchestration started:', safeData);
                  onMultiModel?.({
                    type: 'start',
                    orchestrationId: safeData.orchestrationId,
                    executionPlan: safeData.executionPlan
                  });
                  break;

                case 'role_start':
                  // A specific role (reasoning, tool_execution, synthesis) started
                  console.log('[SSE] Role started:', safeData.role, 'model:', safeData.model);
                  onMultiModel?.({
                    type: 'role_start',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    model: safeData.model
                  });
                  break;

                case 'role_thinking':
                  // Thinking content from a role
                  console.log('[SSE] Role thinking:', safeData.role, 'accumulated:', safeData.accumulated?.length || 0);
                  onMultiModel?.({
                    type: 'role_thinking',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    content: safeData.content
                  });
                  // Also update thinking state for display
                  // CRITICAL FIX: Use accumulated from backend if available, otherwise build locally
                  // The agentState.thinkingContent gets REPLACED, not appended
                  if (safeData.content || safeData.accumulated) {
                    // Prefer backend-accumulated value for accuracy
                    const accumulatedContent = safeData.accumulated || '';
                    if (accumulatedContent) {
                      setCurrentThinking(accumulatedContent);
                      onThinkingContent?.(accumulatedContent);
                    } else if (safeData.content) {
                      // Fallback: accumulate locally
                      setCurrentThinking(prev => {
                        const accumulated = prev + safeData.content;
                        onThinkingContent?.(accumulated);
                        return accumulated;
                      });
                    }
                  }
                  break;

                case 'role_stream':
                  // Streaming content from a role (multi-model mode)
                  // This is the actual LLM content being streamed during orchestration
                  if (safeData.content) {
                    // Update current message with the delta
                    assistantMessage += safeData.content;
                    setCurrentMessage(assistantMessage);

                    // Also notify the stream callback
                    onStream?.(safeData.content);
                  }
                  break;

                case 'role_complete':
                  // A specific role completed
                  console.log('[SSE] Role completed:', safeData.role, 'metrics:', safeData.metrics);
                  onMultiModel?.({
                    type: 'role_complete',
                    orchestrationId: safeData.orchestrationId,
                    role: safeData.role,
                    model: safeData.model,
                    metrics: safeData.metrics
                  });
                  break;

                case 'multi_model_handoff':
                case 'handoff':
                  // Model handoff during orchestration
                  console.log('[SSE] Handoff:', safeData.fromRole, '->', safeData.toRole);
                  onMultiModel?.({
                    type: 'handoff',
                    orchestrationId: safeData.orchestrationId,
                    fromRole: safeData.fromRole,
                    toRole: safeData.toRole,
                    fromModel: safeData.fromModel,
                    toModel: safeData.toModel,
                    handoffCount: safeData.handoffCount
                  });
                  break;

                case 'multi_model_complete':
                case 'orchestration_complete':
                  // Multi-model orchestration completed
                  console.log('[SSE] Orchestration complete:', safeData);
                  onMultiModel?.({
                    type: 'complete',
                    orchestrationId: safeData.orchestrationId,
                    rolesExecuted: safeData.rolesExecuted,
                    totalCost: safeData.totalCost,
                    totalDuration: safeData.totalDuration
                  });
                  break;

                case 'multi_model_error':
                case 'orchestration_error':
                  // Multi-model orchestration error
                  console.log('[SSE] Orchestration error:', safeData);
                  onMultiModel?.({
                    type: 'error',
                    orchestrationId: safeData.orchestrationId,
                    error: safeData.error
                  });
                  break;

                // ── Agent Spawn Events (parallel sub-agents) ──
                // These create nested content blocks under the parent spawn_parallel_agents tool
                case 'agent_spawn_plan':
                  console.log('[SSE] Agent spawn plan:', safeData.agents?.length, 'agents');
                  if (safeData.executionId) {
                    useAgentTreeStore.getState().handleSpawnPlan(safeData.executionId, {
                      strategy: safeData.strategy || safeData.orchestration || 'parallel',
                      agents: safeData.agents,
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  onMultiModel?.({
                    type: 'agent_spawn_plan',
                    agents: safeData.agents,
                    strategy: safeData.strategy
                  });
                  break;

                case 'agent_start': {
                  console.log('[SSE] Agent started:', safeData.agentId, safeData.role, safeData.model);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleAgentStart(safeData.executionId, {
                      agentId: safeData.agentId,
                      role: safeData.role || 'agent',
                      model: safeData.model,
                      task: safeData.task?.substring(0, 120),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Find the parent spawn_parallel_agents tool_use block
                  const parentSpawnBlock = contentBlocksRef.current.find(
                    b => b.type === 'tool_use' && b.toolName === 'spawn_parallel_agents' && !b.isComplete
                  );
                  // Create a child content block for this sub-agent
                  const agentBlockId = `agent-${safeData.agentId}`;
                  const existingAgentBlock = contentBlocksRef.current.find(b => b.id === agentBlockId);
                  if (!existingAgentBlock) {
                    const agentBlock: ContentBlock = {
                      id: agentBlockId,
                      index: contentBlocksRef.current.length,
                      type: 'tool_use',
                      content: '',
                      isComplete: false,
                      toolName: safeData.role || safeData.agentId,
                      toolId: safeData.agentId,
                      timestamp: Date.now(),
                      agentId: safeData.agentId,
                      parentToolId: parentSpawnBlock?.toolId,
                      agentRole: safeData.role,
                    };
                    setContentBlocks(prev => [...prev, agentBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, agentBlock];
                  }
                  onMultiModel?.({
                    type: 'role_start',
                    role: safeData.role,
                    model: safeData.model,
                    orchestrationId: safeData.agentId
                  });
                  break;
                }

                case 'agent_stream': {
                  // Streaming content from a sub-agent — append to agent's own content block
                  // NEVER fall through to onStream — agent output goes through artifact detection
                  // on the backend after agent_complete, not streamed raw into chat
                  if (safeData.content && safeData.agentId) {
                    const agentStreamBlockId = `agent-${safeData.agentId}`;
                    const agentStreamBlock = contentBlocksRef.current.find(b => b.id === agentStreamBlockId);
                    if (agentStreamBlock) {
                      const updated = contentBlocksRef.current.map(b =>
                        b.id === agentStreamBlockId
                          ? { ...b, content: b.content + safeData.content }
                          : b
                      );
                      setContentBlocks(updated);
                      contentBlocksRef.current = updated;
                    }
                    // If no agent block found, suppress — don't leak raw HTML/CSS into chat
                  }
                  // Content without agentId is also suppressed — agents should not stream to main chat
                  break;
                }

                case 'agent_tool_call': {
                  console.log('[SSE] Agent tool call:', safeData.agentId, safeData.toolName);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleToolCall(safeData.executionId, {
                      agentId: safeData.agentId,
                      toolCallId: safeData.toolCallId || `${safeData.agentId}-${safeData.toolName}-${Date.now()}`,
                      toolName: safeData.toolName,
                      args: typeof safeData.arguments === 'string' ? safeData.arguments : JSON.stringify(safeData.arguments || ''),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Create a nested tool call block under the agent's block
                  const agentToolId = `${safeData.agentId}-${safeData.toolName}-${Date.now()}`;
                  const agentParent = contentBlocksRef.current.find(
                    b => b.agentId === safeData.agentId && !b.parentToolId?.includes('-')
                  );
                  const agentToolBlock: ContentBlock = {
                    id: `tool-${agentToolId}`,
                    index: contentBlocksRef.current.length,
                    type: 'tool_use',
                    content: safeData.arguments || '',
                    isComplete: false,
                    toolName: safeData.toolName,
                    toolId: agentToolId,
                    timestamp: Date.now(),
                    agentId: safeData.agentId,
                    parentToolId: agentParent?.toolId || safeData.agentId,
                  };
                  setContentBlocks(prev => [...prev, agentToolBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, agentToolBlock];
                  onMultiModel?.({
                    type: 'role_thinking',
                    role: safeData.agentId,
                    content: `Calling tool: ${safeData.toolName}`
                  });
                  break;
                }

                case 'agent_tool_result': {
                  console.log('[SSE] Agent tool result:', safeData.agentId, safeData.toolName, safeData.success);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleToolResult(safeData.executionId, {
                      agentId: safeData.agentId,
                      toolCallId: safeData.toolCallId || '',
                      status: safeData.success === false ? 'error' : 'completed',
                      durationMs: safeData.durationMs,
                      resultPreview: safeData.resultPreview || safeData.result?.substring?.(0, 120),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Mark the agent's tool call as complete — store result preview + args for inline summary
                  const matchingToolBlock = contentBlocksRef.current.find(
                    b => b.agentId === safeData.agentId && b.toolName === safeData.toolName && !b.isComplete
                  );
                  if (matchingToolBlock) {
                    const updated = contentBlocksRef.current.map(b =>
                      b.id === matchingToolBlock.id
                        ? {
                            ...b,
                            isComplete: true,
                            content: safeData.success ? 'success' : 'error',
                            // Store result + args so the activity stream can compute inline summaries
                            output: safeData.resultPreview || safeData.result?.substring?.(0, 500) || (safeData.success ? 'success' : 'error'),
                            toolArgs: safeData.toolArgs,
                            durationMs: safeData.durationMs,
                          }
                        : b
                    );
                    setContentBlocks(updated);
                    contentBlocksRef.current = updated;
                  }
                  break;
                }

                case 'agent_complete': {
                  console.log('[SSE] Agent complete:', safeData.agentId, safeData.status);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleAgentComplete(safeData.executionId, {
                      agentId: safeData.agentId,
                      status: safeData.status === 'error' ? 'error' : 'completed',
                      durationMs: safeData.durationMs ?? safeData.metrics?.durationMs,
                      inputTokens: safeData.inputTokens ?? safeData.metrics?.inputTokens,
                      outputTokens: safeData.outputTokens ?? safeData.metrics?.outputTokens,
                      error: safeData.error,
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  // Mark the agent's content block as complete
                  const agentCompleteBlock = contentBlocksRef.current.find(
                    b => b.agentId === safeData.agentId && b.toolName !== undefined && !b.parentToolId?.includes('-')
                  );
                  if (agentCompleteBlock) {
                    const updated = contentBlocksRef.current.map(b =>
                      b.id === agentCompleteBlock.id
                        ? { ...b, isComplete: true, content: safeData.status === 'success' ? 'success' : 'error' }
                        : b
                    );
                    setContentBlocks(updated);
                    contentBlocksRef.current = updated;
                  }
                  onMultiModel?.({
                    type: 'role_complete',
                    role: safeData.role,
                    orchestrationId: safeData.agentId,
                    metrics: safeData.metrics
                  });
                  break;
                }

                case 'agent_synthesis': {
                  // Agent synthesis content — the master LLM's final answer after agent execution.
                  // This arrives AFTER agent_complete and should be rendered below the execution timeline.
                  const synthContent = safeData.content || safeData.text || safeData.delta || '';
                  if (synthContent) {
                    assistantMessage += synthContent;
                    const { cleaned, thinking } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);
                    if (thinking) setCurrentThinking(thinking);
                    onStream?.(synthContent);
                  }
                  break;
                }

                case 'agent_thinking': {
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleAgentThinking(safeData.executionId, {
                      agentId: safeData.agentId,
                      tokens: safeData.tokens || 0,
                      durationMs: safeData.durationMs || 0,
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  break;
                }

                // Artifact events emitted by agent orchestration when agents produce HTML artifacts
                case 'artifact_start': {
                  // Store accumulator for artifact content
                  (window as any).__pendingArtifact = {
                    type: safeData.type || safeData.artifactType || 'html',
                    title: safeData.title || 'Artifact',
                    content: '',
                  };
                  break;
                }
                case 'artifact_delta': {
                  const pending = (window as any).__pendingArtifact;
                  if (pending) {
                    pending.content += safeData.content || '';
                  }
                  break;
                }
                case 'artifact_end': {
                  const artifact = (window as any).__pendingArtifact;
                  if (artifact && artifact.content) {
                    const lang = artifact.type === 'html' ? 'html' : artifact.type === 'react' ? 'tsx' : artifact.type;
                    window.dispatchEvent(new CustomEvent('openagentic:open-canvas', {
                      detail: {
                        content: artifact.content,
                        type: lang,
                        title: artifact.title,
                        language: lang,
                      }
                    }));
                  }
                  (window as any).__pendingArtifact = null;
                  break;
                }

                case 'execution_complete': {
                  console.log('[SSE] Execution complete:', safeData.executionId, safeData.status);
                  if (safeData.executionId) {
                    useAgentTreeStore.getState().handleExecutionComplete(safeData.executionId, {
                      totalDurationMs: safeData.totalDurationMs,
                      totalInputTokens: safeData.totalInputTokens,
                      totalOutputTokens: safeData.totalOutputTokens,
                      totalToolCalls: safeData.totalToolCalls,
                      status: safeData.status === 'error' ? 'error' : 'completed',
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  break;
                }

                case 'approval_required': {
                  console.log('[SSE] Agent approval required:', safeData.agentId, safeData.toolName);
                  if (safeData.executionId && safeData.agentId) {
                    useAgentTreeStore.getState().handleApprovalRequired(safeData.executionId, {
                      agentId: safeData.agentId,
                      toolCallId: safeData.toolCallId || `approval-${Date.now()}`,
                      toolName: safeData.toolName || 'unknown',
                      args: typeof safeData.args === 'string' ? safeData.args : JSON.stringify(safeData.args || ''),
                      timestamp: safeData.timestamp ? new Date(safeData.timestamp).toISOString() : undefined,
                    });
                  }
                  break;
                }

                case 'job_completed':
                  // Autonomous job monitoring - background job completed
                  // console.log('[SSE] Background job completed:', {
                  //   jobId: safeData.jobId,
                  //   status: safeData.status,
                  //   completedAt: safeData.completedAt
                  // });

                  // Dispatch a custom event so BackgroundJobsPanel can refresh its list
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('background-job-completed', {
                      detail: {
                        jobId: safeData.jobId,
                        status: safeData.status,
                        result: safeData.result,
                        error: safeData.error,
                        completedAt: safeData.completedAt
                      }
                    }));
                  }

                  // Optionally, inject a system message into the chat
                  const jobStatusMessage = safeData.error
                    ? `Background job ${safeData.jobId} failed: ${safeData.error}`
                    : `Background job ${safeData.jobId} completed successfully`;

                  onMessage?.({
                    id: `job_${safeData.jobId}_${Date.now()}`,
                    role: 'system',
                    content: jobStatusMessage,
                    timestamp: new Date(safeData.completedAt).toISOString(),
                    metadata: {
                      type: 'job_completion',
                      jobId: safeData.jobId,
                      status: safeData.status
                    }
                  });
                  break;

                case 'context_compacted':
                  // Context compaction occurred - show subtle notification to user
                  if (safeData.freedPercent > 0) {
                    setContextCompaction({
                      freedPercent: safeData.freedPercent,
                      tokensFreed: safeData.tokensFreed || 0,
                      compactionLevel: safeData.compactionLevel || 'light',
                    });
                    // Auto-dismiss after 5 seconds
                    setTimeout(() => setContextCompaction(null), 5000);
                  }
                  break;

                case 'mcp_calls_data':
                  // Store MCP calls for the current message AND notify for display
                  console.log('[SSE] MCP calls data received:', {
                    callsCount: safeData.calls?.length,
                    calls: safeData.calls?.map((c: any) => ({ name: c.name, status: c.status }))
                  });

                  if (safeData.calls && safeData.calls.length > 0) {
                    // safeData is already a fresh parsed object - safe to use directly
                    mcpCalls = safeData.calls;

                    // FIX: Mark corresponding tool_use content blocks as complete
                    // This updates the visual status from "running" spinner to checkmark/error
                    safeData.calls.forEach((call: any) => {
                      const toolId = call.id || call.tool || call.name;
                      const isComplete = call.status === 'completed' || call.result !== undefined;

                      setContentBlocks(prev => prev.map(block => {
                        if (block.type === 'tool_use' && (block.toolId === toolId || block.toolName === call.name)) {
                          return { ...block, isComplete };
                        }
                        return block;
                      }));
                      contentBlocksRef.current = contentBlocksRef.current.map(block => {
                        if (block.type === 'tool_use' && (block.toolId === toolId || block.toolName === call.name)) {
                          return { ...block, isComplete };
                        }
                        return block;
                      });
                    });

                    // Notify onToolExecution callback to update activeMcpCalls for real-time display
                    onToolExecution?.({
                      type: 'mcp_calls_data',
                      calls: mcpCalls,
                      round: safeData.round
                    });
                  }
                  break;
                  
                case 'cot_step':
                  // Chain of Thought step event - update COT display
                  if (safeData.step) {
                    setCotSteps(prev => {
                      const existingIndex = prev.findIndex(s => s.id === safeData.step.id);
                      if (existingIndex >= 0) {
                        // Update existing step
                        const updated = [...prev];
                        updated[existingIndex] = { ...updated[existingIndex], ...safeData.step };
                        return updated;
                      } else {
                        // Add new step
                        return [...prev, safeData.step];
                      }
                    });
                  }
                  break;

                case 'cot_data':
                case 'cot_processed':
                  // Legacy CoT events - still processed for backwards compatibility
                  break;

                // ============================================================
                // ANTHROPIC-NATIVE EVENTS
                // These handle raw Anthropic API events if passed through
                // See: https://docs.anthropic.com/en/docs/build-with-claude/streaming
                // ============================================================

                case 'message_start':
                  // Anthropic: Initial message object
                  if (safeData.message?.id) {
                    messageId = safeData.message.id;
                  }
                  break;

                case 'content_block_start':
                  // Anthropic: Start of a content block (thinking, text, or tool_use)
                  // INTERLEAVED THINKING: Add block to contentBlocks array
                  // Handle both Anthropic native format (content_block.type) and OpenAgentic format (blockType)
                  const serverBlockIndex = safeData.index ?? 0;
                  // CRITICAL FIX: Apply offset to get unique index across tool rounds
                  const blockIndex = serverBlockIndex + blockIndexOffsetRef.current;
                  const blockType = (safeData.content_block?.type || safeData.blockType) as 'thinking' | 'text' | 'tool_use';

                  if (blockType) {
                    const blockTimestamp = Date.now();
                    const newBlock: ContentBlock = {
                      id: `block-${blockIndex}-${blockTimestamp}`,  // Unique ID for React key
                      index: blockIndex,
                      type: blockType,
                      content: '',
                      isComplete: false,
                      timestamp: blockTimestamp,
                      // Handle both Anthropic format (content_block.name) and OpenAgentic format (toolName)
                      toolName: blockType === 'tool_use' ? (safeData.content_block?.name || safeData.toolName) : undefined,
                      toolId: blockType === 'tool_use' ? (safeData.content_block?.id || safeData.toolId) : undefined,
                    };
                    setContentBlocks(prev => [...prev, newBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, newBlock];

                    console.debug('[SSE] content_block_start - new block:', {
                      serverIndex: serverBlockIndex,
                      offsetIndex: blockIndex,
                      offset: blockIndexOffsetRef.current,
                      type: blockType,
                      toolName: newBlock.toolName
                    });
                  }

                  // Handle thinking block start (both formats)
                  if (blockType === 'thinking') {
                    // Extended thinking block started
                    onThinking?.('Thinking');
                  } else if (blockType === 'tool_use') {
                    // Tool use block started (handle both Anthropic and OpenAgentic formats)
                    const toolId = safeData.content_block?.id || safeData.toolId || `tool_${blockIndex}`;
                    const toolName = safeData.content_block?.name || safeData.toolName || 'unknown';
                    onToolExecution?.({
                      type: 'tool_call_streaming',
                      calls: [{
                        id: toolId,
                        name: toolName,
                        tool: toolName,
                        args: '',
                        status: 'running'
                      }],
                      round: currentPipelineState.activeToolRound || 1
                    });
                  }
                  break;

                case 'content_block_delta':
                  // Anthropic: Delta update for a content block
                  // INTERLEAVED THINKING: Update the correct block in contentBlocks
                  // Handle both Anthropic native format (delta.type) and OpenAgentic format (blockType + content)
                  const serverDeltaIndex = safeData.index;
                  // CRITICAL FIX: Apply offset to match the unique block index
                  const deltaIndex = serverDeltaIndex !== undefined
                    ? serverDeltaIndex + blockIndexOffsetRef.current
                    : undefined;

                  // OpenAgentic format: blockType + content directly on safeData
                  if (safeData.blockType && safeData.content !== undefined) {
                    const awpBlockType = safeData.blockType;
                    const awpContent = safeData.content || '';

                    // Update contentBlocks for interleaved display
                    if (deltaIndex !== undefined) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + awpContent }
                          : block
                      ));
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + awpContent }
                          : block
                      );
                    }

                    // Also update legacy state for backwards compatibility
                    if (awpBlockType === 'thinking') {
                      const newAccumulatedThinking = currentThinkingRef.current + awpContent;
                      currentThinkingRef.current = newAccumulatedThinking;
                      setCurrentThinking(newAccumulatedThinking);
                      onThinkingContent?.(newAccumulatedThinking);
                    } else if (awpBlockType === 'text') {
                      assistantMessage += awpContent;
                      const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);
                      setCurrentMessage(cleaned);
                      onStream?.(awpContent);
                    }
                    break;
                  }

                  // Anthropic native format: delta.type with specific content fields
                  if (safeData.delta?.type === 'thinking_delta') {
                    // Streaming thinking content
                    const thinkingDelta = safeData.delta.thinking || '';

                    // Update contentBlocks for interleaved display
                    if (deltaIndex !== undefined) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + thinkingDelta }
                          : block
                      ));
                      // Also update contentBlocksRef for persistence
                      contentBlocksRef.current = contentBlocksRef.current.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + thinkingDelta }
                          : block
                      );
                    }

                    // Also update legacy currentThinking for backwards compatibility
                    // CRITICAL FIX: Update ref synchronously for persistence in done handler
                    const newAccumulatedThinking = currentThinkingRef.current + thinkingDelta;
                    currentThinkingRef.current = newAccumulatedThinking; // Sync update for done handler
                    setCurrentThinking(newAccumulatedThinking);
                    onThinkingContent?.(newAccumulatedThinking);
                  } else if (safeData.delta?.type === 'text_delta') {
                    // Streaming text content
                    const textDelta = safeData.delta.text || '';

                    // Update contentBlocks for interleaved display
                    if (deltaIndex !== undefined) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + textDelta }
                          : block
                      ));
                    }

                    assistantMessage += textDelta;
                    const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);
                    setCurrentMessage(cleaned);
                    onStream?.(textDelta);
                  } else if (safeData.delta?.type === 'input_json_delta') {
                    // Streaming tool input JSON
                    // Update contentBlocks for tool args display
                    const jsonDelta = safeData.delta.partial_json || '';
                    if (deltaIndex !== undefined && jsonDelta) {
                      setContentBlocks(prev => prev.map(block =>
                        block.index === deltaIndex
                          ? { ...block, content: block.content + jsonDelta }
                          : block
                      ));
                    }
                  } else if (safeData.delta?.type === 'signature_delta') {
                    // Extended thinking signature (for verification)
                    // Store but don't display
                  }
                  break;

                case 'content_block_stop':
                  // Anthropic: End of a content block
                  // INTERLEAVED THINKING: Mark the block as complete
                  // Handle both Anthropic native format and OpenAgentic format
                  const serverStopIndex = safeData.index;
                  // CRITICAL FIX: Apply offset to match the unique block index
                  const stopIndex = serverStopIndex !== undefined
                    ? serverStopIndex + blockIndexOffsetRef.current
                    : undefined;
                  if (stopIndex !== undefined) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === stopIndex
                        ? { ...block, isComplete: true }
                        : block
                    ));
                    // Also update ref for closure access
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === stopIndex
                        ? { ...block, isComplete: true }
                        : block
                    );

                    // If OpenAgentic format includes finalContent, we can use it for verification
                    // but the content should already be accumulated from deltas
                    if (safeData.finalContent && safeData.blockType) {
                      console.debug('[SSE] content_block_stop with finalContent:', {
                        serverIndex: serverStopIndex,
                        offsetIndex: stopIndex,
                        blockType: safeData.blockType,
                        contentLength: safeData.finalContent?.length
                      });
                    }
                  }
                  break;

                case 'message_delta':
                  // Anthropic: Top-level message changes (stop_reason, usage)
                  if (safeData.usage) {
                    // Token usage stats
                    const usage = safeData.usage;
                    setThinkingMetrics({
                      tokens: usage.input_tokens + usage.output_tokens,
                      elapsedMs: 0,
                      tokensPerSecond: 0
                    });
                  }
                  break;

                case 'message_stop':
                  // Anthropic: End of message stream
                  // This is equivalent to our 'done' event
                  // Don't handle here - let 'done' case handle finalization
                  break;

                // ============================================================
                // END ANTHROPIC-NATIVE EVENTS
                // ============================================================

                // ============================================================
                // OpenAgentic UNIFIED ACTIVITY STREAMING EVENTS
                // Version: openagentic-activity-streaming-2025-01
                // These normalize thinking/tools/activity from ALL providers
                // ============================================================

                case 'activity_start':
                  // New activity session started
                  // Store session info if needed for metrics display
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;

                case 'thinking_start':
                  // Thinking/reasoning phase started (Claude, o1, Gemini, DeepSeek)
                  // Create ContentBlock for interleaved display
                  const thinkingBlockIndex = contentBlocksRef.current.length;
                  const thinkingBlockTimestamp = Date.now();
                  const thinkingBlock: ContentBlock = {
                    id: `block-${thinkingBlockIndex}-${thinkingBlockTimestamp}`,  // Unique ID for React key
                    index: thinkingBlockIndex,
                    type: 'thinking',
                    content: '',
                    isComplete: false,
                    timestamp: thinkingBlockTimestamp,
                  };
                  setContentBlocks(prev => [...prev, thinkingBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, thinkingBlock];
                  currentThinkingBlockIndexRef.current = thinkingBlockIndex;

                  // Capture thinking budget for progress indicator
                  // Budget can come from: budgetTokens, thinkingBudget, maxTokens, or use default
                  const budget = safeData.budgetTokens || safeData.thinkingBudget || safeData.maxTokens || 10000;
                  setThinkingBudget(budget);
                  setThinkingPhase('thinking');

                  onThinking?.(safeData.thinkingMode === 'hidden' ? 'Reasoning' : 'Thinking');
                  break;

                case 'thinking_delta':
                  // Streaming thinking content - use accumulated for accuracy
                  const thinkingDelta = safeData.delta || '';
                  const thinkingAccumulated = safeData.accumulated || '';

                  // Update ContentBlock for interleaved display
                  if (currentThinkingBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, content: thinkingAccumulated || (block.content + thinkingDelta) }
                        : block
                    ));
                    // Keep ref in sync
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentThinkingBlockIndexRef.current
                        ? { ...block, content: thinkingAccumulated || (block.content + thinkingDelta) }
                        : block
                    );
                  }

                  // Also update legacy currentThinking for backwards compatibility
                  if (thinkingAccumulated) {
                    setCurrentThinking(thinkingAccumulated);
                    onThinkingContent?.(thinkingAccumulated, safeData.tokenCount);
                  } else if (thinkingDelta) {
                    setCurrentThinking(prev => {
                      const accumulated = prev + thinkingDelta;
                      onThinkingContent?.(accumulated, safeData.tokenCount);
                      return accumulated;
                    });
                  }
                  // Update metrics if provided
                  if (safeData.tokenCount !== undefined) {
                    setThinkingMetrics(prev => ({
                      tokens: safeData.tokenCount || prev?.tokens || 0,
                      elapsedMs: safeData.elapsedMs || prev?.elapsedMs || 0,
                      tokensPerSecond: prev?.tokensPerSecond || 0
                    }));
                  }
                  break;

                // NOTE: thinking_complete is handled above at line ~567
                // Removed duplicate case here

                case 'content_start':
                  // Response content phase started - create text ContentBlock for interleaved display
                  const textBlockIndex = contentBlocksRef.current.length;
                  const contentStartTimestamp = Date.now();
                  const textBlock: ContentBlock = {
                    id: `block-${textBlockIndex}-${contentStartTimestamp}`,  // Unique ID for React key
                    index: textBlockIndex,
                    type: 'text',
                    content: '',
                    isComplete: false,
                    timestamp: contentStartTimestamp,
                  };
                  setContentBlocks(prev => [...prev, textBlock]);
                  contentBlocksRef.current = [...contentBlocksRef.current, textBlock];
                  currentTextBlockIndexRef.current = textBlockIndex;

                  // Update phase to generating for progress indicator
                  setThinkingPhase('generating');
                  break;

                // NOTE: 'content_delta' is handled above in the 'stream'/'content_delta'/'delta' case group
                // to avoid duplicate case clauses

                case 'content_complete':
                  // Response content finished - mark text ContentBlock as complete
                  if (currentTextBlockIndexRef.current !== null) {
                    setContentBlocks(prev => prev.map(block =>
                      block.index === currentTextBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    ));
                    contentBlocksRef.current = contentBlocksRef.current.map(block =>
                      block.index === currentTextBlockIndexRef.current
                        ? { ...block, isComplete: true }
                        : block
                    );
                    currentTextBlockIndexRef.current = null; // Clear tracking ref
                  }
                  break;

                case 'tool_start':
                  // Tool call initiated (normalized from all providers)
                  onToolExecution?.({
                    type: 'tool_call_streaming',
                    calls: [{
                      id: safeData.toolCallId,
                      name: safeData.toolName,
                      tool: safeData.toolName,
                      args: '',
                      status: 'running'
                    }],
                    round: currentPipelineState.activeToolRound || 1
                  });
                  break;

                case 'tool_delta':
                  // Tool argument streaming (shows args building up)
                  onToolExecution?.({
                    type: 'stream_delta',
                    toolCallId: safeData.toolCallId,
                    delta: safeData.delta,
                    accumulated: safeData.accumulated,
                    sequenceNumber: safeData.sequenceNumber,
                    isValidJson: safeData.isValidJson
                  });
                  break;

                case 'tool_complete':
                  // Tool call ready for execution
                  onToolExecution?.({
                    type: 'stream_complete',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    arguments: safeData.arguments,
                    durationMs: safeData.durationMs,
                    status: 'pending_execution'
                  });
                  break;

                // NOTE: 'tool_result' is handled above at line ~763
                // to avoid duplicate case clauses

                case 'model_info':
                  // Model identification event
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  // Could emit multi-model event for role info
                  if (safeData.role) {
                    onMultiModel?.({
                      type: 'role_start',
                      role: safeData.role,
                      model: safeData.model
                    });
                  }
                  break;

                case 'metrics_update':
                  // Live metrics during streaming
                  if (safeData.tokens) {
                    setThinkingMetrics({
                      tokens: safeData.tokens.total || 0,
                      elapsedMs: safeData.timing?.elapsed || 0,
                      tokensPerSecond: safeData.timing?.tokensPerSecond || 0
                    });
                  }
                  if (safeData.timing?.ttft && !ttftMs) {
                    setTtftMs(safeData.timing.ttft);
                  }
                  break;

                case 'activity_complete':
                  // Activity session finished - similar to done but with more metrics
                  // Let the existing done handler finalize the message
                  break;

                // ============================================================
                // OpenAgentic TOOL STREAMING EVENTS
                // Version: openagentic-tool-streaming-2025-01
                // Fine-grained tool argument streaming
                // ============================================================

                case 'tool_stream_start':
                  // Tool argument streaming started
                  onToolExecution?.({
                    type: 'stream_start',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    toolIndex: safeData.toolIndex,
                    provider: safeData.provider,
                    status: 'streaming'
                  });
                  break;

                case 'tool_stream_delta':
                  // Tool argument chunk received
                  onToolExecution?.({
                    type: 'stream_delta',
                    toolCallId: safeData.toolCallId,
                    delta: safeData.delta,
                    accumulated: safeData.accumulated,
                    sequenceNumber: safeData.sequenceNumber,
                    isValidJson: safeData.isValidJson
                  });
                  break;

                case 'tool_stream_complete':
                  // Tool arguments fully received
                  onToolExecution?.({
                    type: 'stream_complete',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    arguments: safeData.arguments,
                    durationMs: safeData.durationMs,
                    status: 'pending_execution'
                  });
                  break;

                case 'tool_stream_error':
                  // Tool streaming failed
                  onToolExecution?.({
                    type: 'stream_error',
                    toolCallId: safeData.toolCallId,
                    toolName: safeData.toolName,
                    error: safeData.error,
                    errorCode: safeData.errorCode
                  });
                  break;

                // ============================================================
                // ============================================================
                // RAG CONTEXT EVENT - Knowledge base retrieval completed
                // ============================================================
                case 'rag_context': {
                  const ragDocsCount = safeData.docsRetrieved || 0;
                  const ragCollections = safeData.collections || [];
                  const ragTime = safeData.retrievalTime || 0;

                  if (ragDocsCount > 0) {
                    // Add RAG as a tool_use content block so it shows in the UI
                    const ragBlockIndex = contentBlocksRef.current.length;
                    const ragBlock: ContentBlock = {
                      id: `rag-context-${messageId || Date.now()}`,
                      index: ragBlockIndex,
                      type: 'tool_use',
                      content: JSON.stringify({
                        docsRetrieved: ragDocsCount,
                        collections: ragCollections,
                        retrievalTime: ragTime,
                        sources: safeData.sources || []
                      }),
                      isComplete: true,
                      timestamp: Date.now(),
                      toolName: `RAG Knowledge (${ragDocsCount} docs)`,
                      toolId: `rag_${Date.now()}`,
                    };
                    setContentBlocks(prev => [...prev, ragBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, ragBlock];
                  }
                  break;
                }

                // TOOL CALL EVENT ALIASES
                // Some providers emit these alternative event names
                // ============================================================

                case 'tool_call_start': {
                  // Alias for tool_start - some providers use this name
                  const tcToolId = safeData.toolCallId || safeData.id || `tool_${Date.now()}`;
                  const tcToolName = safeData.toolName || safeData.name || 'unknown';

                  // Create tool_use content block for interleaved display
                  const existingToolBlock = contentBlocksRef.current.find(
                    b => b.type === 'tool_use' && b.toolId === tcToolId
                  );
                  if (!existingToolBlock) {
                    const newBlockIndex = contentBlocksRef.current.length;
                    const newBlock: ContentBlock = {
                      id: `tool-${tcToolId}`,
                      index: newBlockIndex,
                      type: 'tool_use',
                      content: safeData.arguments || safeData.args || '',
                      isComplete: false,
                      timestamp: Date.now(),
                      toolName: tcToolName,
                      toolId: tcToolId,
                    };
                    setContentBlocks(prev => [...prev, newBlock]);
                    contentBlocksRef.current = [...contentBlocksRef.current, newBlock];
                  }

                  onToolExecution?.({
                    type: 'tool_call_streaming',
                    calls: [{
                      id: tcToolId,
                      name: tcToolName,
                      tool: tcToolName,
                      args: safeData.arguments || safeData.args || '',
                      status: 'running'
                    }],
                    round: currentPipelineState.activeToolRound || 1
                  });
                  break;
                }

                case 'tool_call_result': {
                  // Alias for tool_result - some providers emit this
                  const trToolId = safeData.toolCallId || safeData.id;
                  const trToolName = safeData.toolName || safeData.name;

                  // Mark the corresponding tool_use content block as complete
                  if (trToolId) {
                    setContentBlocks(prev => prev.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === trToolId || block.toolName === trToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    }));
                    contentBlocksRef.current = contentBlocksRef.current.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === trToolId || block.toolName === trToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    });
                  }

                  onToolExecution?.({
                    type: 'result',
                    name: trToolName,
                    result: safeData.result
                  });
                  break;
                }

                case 'tool_call_error': {
                  // Alias for tool_error - some providers emit this
                  const teToolId = safeData.toolCallId || safeData.id;
                  const teToolName = safeData.toolName || safeData.name;

                  // Mark the corresponding tool_use content block as complete (with error)
                  if (teToolId) {
                    setContentBlocks(prev => prev.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === teToolId || block.toolName === teToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    }));
                    contentBlocksRef.current = contentBlocksRef.current.map(block => {
                      if (block.type === 'tool_use' && (block.toolId === teToolId || block.toolName === teToolName)) {
                        return { ...block, isComplete: true };
                      }
                      return block;
                    });
                  }

                  onToolExecution?.({
                    type: 'error',
                    name: teToolName,
                    error: safeData.error
                  });
                  break;
                }

                // ============================================================
                // END OpenAgentic ACTIVITY/TOOL STREAMING EVENTS
                // ============================================================

                case 'image':
                  // CRITICAL FIX: Do NOT add image to assistantMessage here
                  // The backend already emits a 'stream' event with the full markdown content
                  // including the image. Adding it here causes duplication.
                  // Image event logging - disabled in production
                  // if (import.meta.env.DEV) {
                  //   console.log('[SSE] Image event received (will be included in stream event):', {
                  //     imageUrl: safeData.imageUrl,
                  //     revisedPrompt: safeData.revisedPrompt
                  //   });
                  // }
                  // Don't modify assistantMessage - the stream event already contains the image
                  break;
                  
                case 'completion_complete':
                  // CRITICAL: Do NOT add any content here - it was already streamed
                  // This event only carries metadata like toolCalls, usage, finishReason
                  // Capture the model for the final message badge
                  if (safeData.model) {
                    responseModel = safeData.model;
                  }
                  break;
                  
                case 'done':
                case 'stream_complete':
                  // CRITICAL FIX: Prevent duplicate messages from multiple done events
                  if (hasCompletedStream) {
                    // console.warn('[SSE] Ignoring duplicate done/stream_complete event');
                    break;
                  }
                  hasCompletedStream = true;

                  // CRITICAL FIX: Capture model from done event (server renames completion_complete to done)
                  // This is needed because the completion_complete case may not be hit
                  if (safeData.model && !responseModel) {
                    responseModel = safeData.model;
                  }

                  // Mark pipeline as complete
                  currentPipelineState.currentStage = 'response';
                  currentPipelineState.shouldSuppressContent = false;
                  currentPipelineState.isToolExecutionPhase = false;

                  // CRITICAL FIX: Always add message if there's content OR mcpCalls
                  // Tool-only responses (no text) should still create a message to display the tool execution
                  if (assistantMessage || mcpCalls.length > 0) {
                    // Clean thinking blocks from the content AND extract thinking for persistence
                    const { cleaned: cleanedContent, thinking: extractedThinking } = extractAndCleanThinkingBlocks(assistantMessage || '');

                    // Format the message for better readability
                    const formattedContent = cleanedContent
                      ? addVisualEnhancements(formatAgentMessage(cleanedContent))
                      : ''; // Empty content but we still want to show MCP calls

                    // CRITICAL FIX: Capture ALL content blocks (thinking + tool_use) in their
                    // original interleaved order so the rendered result matches the streaming experience.
                    // Previously only thinking blocks were captured → they got bunched at the top.
                    const allContentBlocks = contentBlocksRef.current
                      .filter(b => (b.type === 'thinking' || b.type === 'tool_use') && (b.content || b.toolName))
                      .map(b => ({
                        id: b.id,
                        type: b.type,
                        content: b.content,
                        toolName: b.toolName,
                        toolId: b.toolId,
                        isComplete: b.isComplete,
                        // Carry tool input + output through to the persisted form so
                        // the activity-stream adapter can populate ToolCall.input /
                        // ToolCall.output and renderers (favicons on web_search,
                        // resource-name summaries on cloud creates, etc.) light up.
                        // Without these, all tool chips collapse to a bare title.
                        // See openagentic-omhs#330.
                        result: (b as any).result,
                        error: (b as any).error,
                        duration: (b as any).duration,
                      }));

                    const thinkingBlocksArray = allContentBlocks.filter(b => b.type === 'thinking' && b.content);

                    console.log('[SSEChat] Finalizing content blocks:', {
                      totalContentBlocks: contentBlocksRef.current.length,
                      thinkingBlocks: thinkingBlocksArray.length,
                      allBlocks: allContentBlocks.map(b => ({ type: b.type, id: b.id, len: b.content?.length || 0 })),
                    });

                    const thinkingFromBlocks = thinkingBlocksArray
                      .map(b => b.content)
                      .join('\n\n---\n\n');

                    // Capture current thinking content for persistence (use extracted, state ref, or blocks)
                    const thinkingToSave = extractedThinking || currentThinkingRef.current || thinkingFromBlocks || '';

                    // Build interleaved steps preserving original streaming order.
                    // Each content block becomes a step — thinking blocks as type:'thinking',
                    // tool_use blocks as their tool type (mcp, tool, etc.)
                    let finalThinkingSteps: any[] | undefined;

                    if (allContentBlocks.length > 0) {
                      const interleavedSteps = allContentBlocks.map((block, idx) => {
                        if (block.type === 'thinking') {
                          return {
                            id: block.id || `thinking-block-${idx}`,
                            type: 'thinking' as const,
                            title: 'Reasoning',
                            content: block.content,
                            status: 'completed',
                          };
                        } else {
                          // tool_use block — preserve as MCP/tool step.
                          //
                          // `block.content` was JSON-stringified args at
                          // tool_call_delta time (see this file ~line 1038);
                          // `block.result` was JSON-stringified output at
                          // tool_result time (~line 1064). Parse both back so
                          // the InlineStep carries usable structured data
                          // through `details.{args,result}` — that's what
                          // useInlineStepsAdapter reads to populate
                          // ToolCall.input / ToolCall.output, which in turn
                          // powers the rich tool-card renderers (favicons on
                          // web_search, resource-name summaries on cloud
                          // creates, etc.). openagentic-omhs#330.
                          let argsParsed: any;
                          try { argsParsed = block.content ? JSON.parse(block.content) : undefined; } catch { argsParsed = block.content; }
                          let resultParsed: any;
                          try { resultParsed = (block as any).result ? JSON.parse((block as any).result) : undefined; } catch { resultParsed = (block as any).result; }
                          return {
                            id: block.id || `tool-block-${idx}`,
                            type: 'mcp' as const,
                            title: block.toolName || 'Tool',
                            content: block.toolName || '',
                            status: (block as any).error ? 'error' : 'completed',
                            toolId: block.toolId,
                            duration: (block as any).duration,
                            details: {
                              args: argsParsed,
                              result: resultParsed,
                            },
                          };
                        }
                      });

                      // Append any COT steps (from cotStepsRef) after the interleaved blocks
                      const cotStepsCopy = cotStepsRef.current.length > 0
                        ? JSON.parse(JSON.stringify(cotStepsRef.current))
                        : [];
                      finalThinkingSteps = [...interleavedSteps, ...cotStepsCopy];
                    } else if (cotStepsRef.current.length > 0) {
                      finalThinkingSteps = JSON.parse(JSON.stringify(cotStepsRef.current));
                    }

                    // CRITICAL FIX: Capture any tool calls for inline display
                    // safeData may contain toolCalls from completion_complete event
                    const finalToolCalls = safeData.toolCalls || undefined;
                    const finalToolResults = safeData.toolResults || undefined;

                    // Call onMessage with formatted content and MCP calls (HIGH PRIORITY)
                    // CRITICAL: Include thinkingSteps, reasoningTrace, toolCalls for inline step display
                    onMessage?.({
                      id: messageId || new Date().toISOString(),
                      role: 'assistant',
                      content: formattedContent,
                      timestamp: new Date().toISOString(),
                      model: responseModel || undefined, // Include the model used for this response
                      mcpCalls: mcpCalls.length > 0 ? mcpCalls : undefined,
                      // CRITICAL: Include step data for inline display
                      thinkingSteps: finalThinkingSteps, // Structured thinking steps from COT
                      reasoningTrace: thinkingToSave || undefined, // Full reasoning text (single string for legacy)
                      toolCalls: finalToolCalls, // Tool calls made during response
                      toolResults: finalToolResults, // Results from tool executions
                      metadata: {
                        // Create fresh extensible object to avoid "Object is not extensible" errors
                        ...JSON.parse(JSON.stringify(safeData)),
                        // IMPORTANT: Save thinking content for persistence after reload
                        thinkingContent: thinkingToSave || undefined,
                        // IMPORTANT: Save individual thinking blocks for multi-block display
                        thinkingBlocks: thinkingBlocksArray.length > 0 ? thinkingBlocksArray : undefined,
                        // IMPORTANT: Also save mcpCalls in metadata for database persistence
                        mcpCalls: mcpCalls.length > 0 ? mcpCalls : undefined,
                        pipelineMetrics: {
                          stageTiming: currentPipelineState.stageTiming,
                          toolRounds: currentPipelineState.activeToolRound
                        }
                      }
                    });
                  }

                  // MODERN FIX: Clear active tool execution indicators AFTER final message is queued
                  // The useTransition below ensures onMessage completes before this executes
                  // This prevents stale "✓ Completed" badges from lingering with streaming cursor
                  onToolExecution?.({ type: 'clear_all' });

                  // CRITICAL FIX: Set streaming state IMMEDIATELY when done event is received
                  // The previous use of startTransition caused the "Generating" indicator to persist
                  // because deferred updates have lower priority. For UI indicators, immediate updates are essential.
                  setIsStreaming(false);
                  setCurrentMessage('');
                  // CRITICAL FIX: Clear contentBlocks to prevent duplicate rendering
                  // The final message is now in the messages list, so InterleavedContent should not render
                  setContentBlocks([]);
                  contentBlocksRef.current = [];
                  currentTextBlockIndexRef.current = null;
                  currentThinkingBlockIndexRef.current = null;
                  // DON'T clear thinking content on completion - let it persist for user review!
                  // The thinking will be cleared when a NEW message starts (line ~291)
                  // setCurrentThinking('');  // REMOVED - was hiding thinking from users
                  setThinkingMetrics(null); // Only clear metrics (spinner)

                  setPipelineState({...currentPipelineState});
                  onPipelineStage?.('response', { complete: true });
                  break;
                  
                case 'ping':
                case 'heartbeat':
                case 'keep_alive':
                  // Server keepalive events - no action needed, timeout already reset above
                  break;

                default:
                  // FALLBACK HANDLER: Log unknown event types and attempt to render as content
                  // This prevents silently dropping content from unknown/new event types
                  if (eventType) {
                    console.warn(`[SSE] Unknown event type: "${eventType}"`, safeData);

                    // If the unknown event contains content-like data, render it as a text block
                    const fallbackContent = safeData.content || safeData.text || safeData.delta || safeData.message;
                    if (fallbackContent && typeof fallbackContent === 'string' && fallbackContent.trim()) {
                      assistantMessage += fallbackContent;
                      const { cleaned } = extractAndCleanThinkingBlocks(assistantMessage);
                      setCurrentMessage(cleaned);

                      // Update or create text ContentBlock for interleaved display
                      if (currentTextBlockIndexRef.current === null) {
                        const newTextBlockIndex = contentBlocksRef.current.length;
                        const textBlockTimestamp = Date.now();
                        const newTextBlock: ContentBlock = {
                          id: `block-${newTextBlockIndex}-${textBlockTimestamp}`,
                          index: newTextBlockIndex,
                          type: 'text',
                          content: cleaned,
                          isComplete: false,
                          timestamp: textBlockTimestamp,
                        };
                        setContentBlocks(prev => [...prev, newTextBlock]);
                        contentBlocksRef.current = [...contentBlocksRef.current, newTextBlock];
                        currentTextBlockIndexRef.current = newTextBlockIndex;
                      } else {
                        setContentBlocks(prev => prev.map(block =>
                          block.index === currentTextBlockIndexRef.current
                            ? { ...block, content: cleaned }
                            : block
                        ));
                        contentBlocksRef.current = contentBlocksRef.current.map(block =>
                          block.index === currentTextBlockIndexRef.current
                            ? { ...block, content: cleaned }
                            : block
                        );
                      }

                      onStream?.(fallbackContent);
                    }
                  }
                  break;

                case 'normalized': {
                  // UNIFIED_STREAM=true path — backend emits pre-normalised events
                  const normEvent = safeData as NormalizedStreamEvent;
                  normalizedEventsRef.current = [...normalizedEventsRef.current, normEvent];
                  setNormalizedEvents([...normalizedEventsRef.current]);
                  // Continue — do NOT break here so legacy event handling can also fire
                  // (no-op: fall through to default/break via the next case)
                  break;
                }

                case 'error':
                  // Guard against duplicate error messages (fixes 3x error display)
                  if (hasReportedError) {
                    console.log('[SSE] Skipping duplicate error event');
                    break;
                  }
                  hasReportedError = true;

                  console.error('[SSE] Error event received:', safeData);

                  // Enhanced error handling with specific details about what failed
                  let detailedErrorMessage = safeData.message || 'Unknown error occurred';
                  let errorContext = '';

                  // If it's a model provider error, add specific details
                  if (safeData.code === 'PIPELINE_ERROR' || safeData.code === 'COMPLETION_FAILED') {
                    errorContext += `\n\nError Code: ${safeData.code}`;
                    if (safeData.stage) {
                      errorContext += `\nFailed Stage: ${safeData.stage}`;
                    }
                    if (safeData.retryable !== undefined) {
                      errorContext += `\nRetryable: ${safeData.retryable ? 'Yes' : 'No'}`;
                    }

                    // Check for specific model provider issues
                    const lowerMsg = detailedErrorMessage.toLowerCase();
                    if (lowerMsg.includes('could not identify azure model') ||
                        lowerMsg.includes('base_model')) {
                      detailedErrorMessage = `MODEL CONFIGURATION ERROR\n\nCannot identify the Azure model deployment.\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('no provider') ||
                               lowerMsg.includes('provider not found') ||
                               lowerMsg.includes('no llm provider')) {
                      detailedErrorMessage = `NO LLM PROVIDER CONFIGURED\n\nNo AI model provider is available for chat.\n\nAdmin Action Required:\n• Go to Admin Portal → LLM Providers\n• Add at least one enabled provider (Vertex AI, Bedrock, Ollama, etc.)\n• Ensure the provider has a chat model configured\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('model not found') ||
                               lowerMsg.includes('model does not exist') ||
                               lowerMsg.includes('no model') ||
                               lowerMsg.includes('invalid model')) {
                      detailedErrorMessage = `MODEL NOT FOUND\n\nThe selected AI model is not available.\n\nPossible Causes:\n• Model was deleted or renamed\n• Model ID is incorrect\n• Provider doesn't have this model\n\nTry selecting a different model from the dropdown.\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('credential') ||
                               lowerMsg.includes('api key') ||
                               lowerMsg.includes('invalid key') ||
                               lowerMsg.includes('access denied')) {
                      detailedErrorMessage = `CREDENTIAL ERROR\n\nModel provider credentials are invalid or missing.\n\nAdmin Action Required:\n• Go to Admin Portal → LLM Providers\n• Check/update API keys or credentials\n• Verify the credentials have correct permissions\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('failed to connect') ||
                               lowerMsg.includes('connection failed') ||
                               lowerMsg.includes('econnrefused') ||
                               lowerMsg.includes('network')) {
                      detailedErrorMessage = `CONNECTION ERROR\n\nCannot connect to the AI model provider.\n\nCheck if:\n• API service is running\n• Network connectivity is available\n• API endpoints are correct\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('401') ||
                               lowerMsg.includes('unauthorized')) {
                      detailedErrorMessage = `AUTHENTICATION ERROR\n\nModel provider authentication failed.\n\nCheck if:\n• API keys are valid\n• OAuth tokens haven't expired\n• Model deployment permissions are correct\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('quota') ||
                               lowerMsg.includes('rate limit') ||
                               lowerMsg.includes('429')) {
                      detailedErrorMessage = `RATE LIMIT / QUOTA EXCEEDED\n\nThe AI model provider rate limit or quota has been exceeded.\n\nTry:\n• Wait a few minutes and try again\n• Use a different model/provider\n• Contact admin to increase quotas\n\nTechnical Details:\n${detailedErrorMessage}`;
                    } else if (lowerMsg.includes('timeout') ||
                               lowerMsg.includes('timed out')) {
                      detailedErrorMessage = `TIMEOUT ERROR\n\nThe AI model took too long to respond.\n\nThis could be due to:\n• High model load\n• Network latency\n• Complex request processing\n\nTechnical Details:\n${detailedErrorMessage}`;
                    }
                  }

                  const enhancedError = new Error(detailedErrorMessage + errorContext);
                  enhancedError.name = safeData.code || 'ChatError';
                  onError?.(enhancedError);
                  break;
              }
            } catch (error) {
              console.error('[SSE] Error parsing SSE data:', error, 'Raw data:', eventData);
            }
          }
        }
      }
    } catch (streamError: any) {
        // CRITICAL FIX: Don't report AbortError - it's expected when sending a new message
        // AbortError occurs when abortControllerRef.current.abort() is called for a new message
        if (streamError.name === 'AbortError') {
          // Stream abort is normal when stopping/sending new message - silent
          return;
        }

        // Firefox "Error in input stream" TypeError - network-level stream timeout
        // Also catch any other TypeError from ReadableStream (Chrome/Safari variants)
        const isStreamTimeout = streamError instanceof TypeError && (
          streamError.message?.includes('input stream') ||
          streamError.message?.includes('terminated') ||
          streamError.message?.includes('network') ||
          streamError.message?.includes('Failed to fetch')
        );

        if (isStreamTimeout) {
          // Stream connection lost - gracefully finalize with whatever content we have
          console.warn('[SSE] Stream connection lost (browser timeout). Finalizing with existing content.');
          // Don't propagate to onError - the user already has partial content displayed
          // The streaming state will be cleaned up in the finally block
          return;
        }

        // Guard against duplicate error messages (fixes 3x error display)
        if (!hasReportedError) {
          hasReportedError = true;
          console.error('[SSE] Stream processing error:', streamError);
          onError?.(streamError);
        }
      } finally {
        // Clear timeout regardless of how the stream ends
        clearTimeout(streamTimeoutId);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // Normal abort - silent
        return;
      }

      // Catch stream timeouts at the outer level too (Firefox/Safari variants)
      const isStreamTimeout = error instanceof TypeError && (
        error.message?.includes('input stream') ||
        error.message?.includes('terminated') ||
        error.message?.includes('network') ||
        error.message?.includes('Failed to fetch')
      );

      if (isStreamTimeout) {
        console.warn('[SSE] Connection lost (outer catch). Finalizing gracefully.');
        return;
      }

      // Guard against duplicate error messages (fixes 3x error display)
      if (!hasReportedError) {
        hasReportedError = true;
        console.error('[SSE] Chat error:', error.message);
        onError?.(error);
      }
    } finally {
      // CRITICAL: If stream ended without explicit done/stream_complete,
      // notify tool execution callbacks so tool cards show abandoned state
      // instead of spinning forever
      if (!hasCompletedStream) {
        onToolExecution?.({ type: 'stream_ended' });
      }
      setIsStreaming(false);
      // DON'T clear currentMessage here - it causes double display
      // It's already handled in the done/stream_complete event handler
      // setCurrentMessage(''); // REMOVED - causes double display bug
      abortControllerRef.current = null;

      // Reset pipeline state
      setPipelineState(createInitialPipelineState());
    }
  }, [sessionId, autoApproveTools, onMessage, onToolExecution, onToolApprovalRequest, onError, onThinking, onThinkingContent, onThinkingComplete, onMultiModel, onStream, onPipelineStage, onToolRound, getAccessToken, animationMode]);
  
  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
      setCurrentMessage(''); // Clear streaming content when stopped
      setCurrentThinking('');
      setContentBlocks([]); // Clear interleaved content blocks when stopped
      contentBlocksRef.current = [];
      setThinkingMetrics(null);
      setCotSteps([]); // Clear COT steps when stopped
    }

    // Reset pipeline state
    setPipelineState(createInitialPipelineState());
  }, []);
  
  // Update animation mode preference
  const updateAnimationMode = useCallback((mode: AnimationMode) => {
    setAnimationMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-animation-mode', mode);
    }
  }, []);
  
  // Listen for animation mode changes from other tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'chat-animation-mode' && e.newValue) {
        const newMode = e.newValue as AnimationMode;
        if (newMode === 'smooth' || newMode === 'none') {
          setAnimationMode(newMode);
        }
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);
  
  // Compute thinkingProgress for the progress indicator
  const thinkingProgress = thinkingBudget > 0 && thinkingMetrics ? {
    tokensUsed: thinkingMetrics.tokens,
    tokenBudget: thinkingBudget,
    percentage: Math.min(100, (thinkingMetrics.tokens / thinkingBudget) * 100),
    phase: thinkingPhase,
  } : undefined;

  return {
    sendMessage,
    stopStreaming,
    isStreaming,
    currentMessage,
    currentThinking,
    isThinkingCompleted, // Whether thinking phase has finished (for UI collapse)
    thinkingMetrics,
    thinkingProgress, // Thinking progress for real progress indicator
    ttftMs, // Time to First Token - for debugging slow responses
    pipelineState,
    animationMode,
    updateAnimationMode,
    cotSteps, // Chain of Thought steps for COT UI display
    contentBlocks, // Interleaved content blocks for thinking/text display
    contextCompaction, // Context compaction notification data (auto-dismisses after 5s)
    normalizedEvents, // Normalized stream events (UNIFIED_STREAM=true path)
  };
};