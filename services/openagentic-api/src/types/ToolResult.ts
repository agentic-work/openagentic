/**
 * Two-channel tool result envelope (Phase 4 / Spec §6.1).
 *
 * `structuredContent` is what the MODEL sees on the next turn (≤2KB
 * summary + optional shaped digest). `_meta` is what the UI + downstream
 * observability see — it never goes to the model.
 *
 * the design notes
 * the design notes
 *       Phase 4, Task 4.1.
 */

export interface StructuredContent {
  /** 1-3 line natural-language; always present. */
  summary: string;
  /** Shaped per outputSchema; serialized payload SHOULD be ≤ 2KB. */
  data?: unknown;
  /** True if the LargeResultStorage overflow path took. */
  truncated?: boolean;
}

export interface ToolResultMeta {
  /**
   * EnrichedTool registry slug (e.g. 'azure_vm_list', 'k8s_pod_list',
   * 'findings_severity'). Drives FrameRendererRegistry lookup on the UI.
   */
  outputTemplate?: string;
  /**
   * #781 Phase A2 — `ArtifactRegistry.classify(outputTemplate)` result.
   * Tells the UI which slide-out renderer kind to mount without re-deriving
   * from the slug. `'unknown'` when no/unknown outputTemplate; the UI
   * shows a structured "unknown artifact kind" state rather than a silent
   * empty iframe.
   */
  artifactKind?:
    | 'python-report'
    | 'react-app'
    | 'chart'
    | 'table'
    | 'runbook'
    | 'unknown';
  /**
   * LargeResultStorage handle when the result overflowed the inline
   * threshold. Present iff `structuredContent.truncated === true`.
   */
  artifactHandle?: string;
  /** Raw underlying-result byte size. */
  size: number;
  /** End-to-end dispatch latency in milliseconds. */
  elapsed: number;
  /** Tool execution cost in USD, when applicable. */
  cost?: number;
}

export interface ToolResult {
  ok: boolean;
  structuredContent: StructuredContent;
  _meta: ToolResultMeta;
}
