/**
 * useArtifactAutoOpen
 *
 * Artifact auto-open detection extracted verbatim from ChatContainer. When a
 * stream finishes, scans the latest message (and its tool outputs) for an
 * ```artifact:<type>``` fence and dispatches the `openagentic:open-canvas`
 * window event so the Canvas panel opens. Side-effect only — it dispatches the
 * same window event the container already listens for; it does NOT touch the
 * canvas state, the send path, or the streaming session refs.
 */
import { useEffect, useRef } from 'react';
import type { ChatMessage } from '@/types/index';

export function useArtifactAutoOpen(isStreaming: boolean, messages: ChatMessage[]): void {
  // Auto-open canvas panel when streaming completes and response contains an artifact
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
    } else if (wasStreamingRef.current) {
      wasStreamingRef.current = false;
      // Streaming just ended — check recent messages for artifacts
      const lastMsg = messages[messages.length - 1];
      const lastContent = lastMsg?.content || '';

      // Helper to open an artifact in the canvas panel
      const openArtifact = (type: string, artifactContent: string, title?: string) => {
        const lang = type === 'html' ? 'html' : type === 'react' ? 'tsx' : type === 'svg' ? 'svg' : type;
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('openagentic:open-canvas', {
            detail: {
              content: artifactContent,
              type: lang,
              title: title || `${type.charAt(0).toUpperCase() + type.slice(1)} Artifact`,
              language: lang,
            }
          }));
        }, 500);
      };

      // 1. Check direct message content for artifact fences
      const artifactMatch = lastContent.match(/```artifact:(html|react|svg|mermaid|chart|csv|latex|canvas)\n([\s\S]*?)```/);
      if (artifactMatch) {
        openArtifact(artifactMatch[1], artifactMatch[2]);
      } else {
        // 2. Check tool results (orchestration agents may embed artifacts in their output)
        // Scan toolResults and aggregated tool messages for artifact fences
        const toolOutputs: string[] = [];
        if (lastMsg?.toolResults) {
          for (const tr of lastMsg.toolResults) {
            const s = typeof tr === 'string' ? tr : JSON.stringify(tr);
            toolOutputs.push(s);
          }
        }
        // Also check aggregated messages for tool results
        if (lastMsg?.toolCalls) {
          for (const msg of messages) {
            if (msg.role === 'tool' && msg.content) {
              toolOutputs.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
            }
          }
        }
        // Search all collected tool outputs for artifact fences
        for (const output of toolOutputs) {
          // Artifact fences may be escaped inside JSON strings — handle both raw and escaped newlines
          const unescaped = output.replace(/\\n/g, '\n').replace(/\\"/g, '"');
          const toolArtifactMatch = unescaped.match(/```artifact:(html|react|svg|mermaid|chart|csv|latex|canvas)\n([\s\S]*?)```/);
          if (toolArtifactMatch) {
            // Try to extract a title from the HTML content
            const titleMatch = unescaped.match(/<title>([^<]+)<\/title>/i);
            openArtifact(toolArtifactMatch[1], toolArtifactMatch[2], titleMatch?.[1]);
            break;
          }
        }
      }
    }
  }, [isStreaming, messages]);
}
