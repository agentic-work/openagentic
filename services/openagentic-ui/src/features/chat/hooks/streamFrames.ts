/**
 * streamFrames — pure NDJSON frame reducers for the chat streaming engine.
 *
 * Leaf module: each `apply*`/`bufferOrApply*`/`dispatch*` function folds one
 * wire frame onto the current UI state and returns a fresh reference. No
 * React state / refs / hooks. Extracted verbatim from `useChatStream.ts`
 * (behaviour-preserving), which imports these back + re-exports them.
 */
import type {
  ContentBlock,
  RoundFrame,
  ToolRoundBlock,
  StreamingTable,
  StreamingTableFrame,
  FindingSeverityWire,
  FindingsArtifact,
  FindingsFrame,
  FindingsItem,
  InlineWidgetKind,
  InlineWidget,
  InlineWidgetFrame,
  ArtifactEmit,
  ArtifactEmitFrame,
  IntentClassification,
  ToolShortlist,
  SubAgentEntry,
  SubAgentStartedFrame,
  SubAgentCompletedFrame,
} from './streamTypes';

/**
 * Pure reducer that folds a round-aware stream frame onto the current
 * contentBlocks list.
 *
 *   tool_round_start      → push a new tool_round block with empty children
 *   tool_executing (w/ roundId matching open round) → append to children
 *   tool_executing (no match / unknown roundId)     → append as sibling
 *   tool_complete / tool_result / tool_error (w/ roundId match)
 *                         → update the matching child in place
 *   tool_round_end        → mark round isComplete + stamp durationMs /
 *                           succeeded / failed
 *
 * Non-matching frames fall through untouched. All outputs are new arrays
 * so downstream React state setters see a fresh reference.
 */
export function applyRoundFrame(
  blocks: ContentBlock[],
  frame: RoundFrame,
): ContentBlock[] {
  // ── tool_round_start ────────────────────────────────────────────
  if (frame.type === 'tool_round_start') {
    // Dedupe: if a tool_round block already exists for this roundId, the
    // second tool_round_start is a no-op (defensive against duplicate
    // envelopes from the sequencer).
    if (
      blocks.some(
        (b) => b.type === 'tool_round' && b.roundId === frame.roundId,
      )
    ) {
      return blocks;
    }
    const round: ToolRoundBlock = {
      id: `tool-round-${frame.roundId}`,
      index: blocks.length,
      type: 'tool_round',
      content: '',
      roundId: frame.roundId,
      toolIds: Array.isArray(frame.toolIds) ? [...frame.toolIds] : [],
      children: [],
      isComplete: false,
      startTime: Date.now(),
    };
    return [...blocks, round];
  }

  // ── tool_round_end ──────────────────────────────────────────────
  if (frame.type === 'tool_round_end') {
    return blocks.map((b) => {
      if (b.type !== 'tool_round' || b.roundId !== frame.roundId) return b;
      return {
        ...b,
        isComplete: true,
        durationMs: typeof frame.durationMs === 'number' ? frame.durationMs : b.durationMs,
        succeeded: typeof frame.succeeded === 'number' ? frame.succeeded : b.succeeded,
        failed: typeof frame.failed === 'number' ? frame.failed : b.failed,
      };
    });
  }

  // ── tool_executing ──────────────────────────────────────────────
  if (frame.type === 'tool_executing') {
    const targetRoundIdx =
      frame.roundId
        ? blocks.findIndex(
            (b) => b.type === 'tool_round' && b.roundId === frame.roundId,
          )
        : -1;

    const child: ContentBlock = {
      id: `tool-exec-${frame.toolCallId || frame.name || Math.random().toString(36).slice(2)}`,
      index: targetRoundIdx >= 0
        ? (blocks[targetRoundIdx].children?.length ?? 0)
        : blocks.length,
      type: 'tool_use',
      content: JSON.stringify(frame.arguments ?? {}),
      isComplete: false,
      toolName: frame.name,
      toolId: frame.toolCallId,
      startTime: Date.now(),
    };

    if (targetRoundIdx < 0) {
      // No matching round — graceful fallback, render as top-level sibling.
      return [...blocks, child];
    }

    return blocks.map((b, i) => {
      if (i !== targetRoundIdx) return b;
      return {
        ...b,
        children: [...(b.children ?? []), child],
      };
    });
  }

  // ── tool_complete / tool_result / tool_error ─────────────────────
  if (
    frame.type === 'tool_complete' ||
    frame.type === 'tool_result' ||
    frame.type === 'tool_error'
  ) {
    if (!frame.roundId) return blocks;
    const roundIdx = blocks.findIndex(
      (b) => b.type === 'tool_round' && b.roundId === frame.roundId,
    );
    if (roundIdx < 0) return blocks;

    const round = blocks[roundIdx];
    const children = round.children ?? [];
    const childIdx = children.findIndex(
      (c) =>
        (frame.toolCallId && c.toolId === frame.toolCallId) ||
        (frame.name && c.toolName === frame.name && !c.isComplete),
    );
    if (childIdx < 0) return blocks;

    const prevChild = children[childIdx];
    // Phase 4 — forward `_meta.outputTemplate` from the tool_result frame
    // onto the matching ContentBlock so render-time can resolve the
    // FrameRendererRegistry component. Only stamps on success-path frames
    // (tool_result / tool_complete); tool_error keeps the existing error
    // shape unchanged.
    const frameMeta =
      frame.type === 'tool_result' || frame.type === 'tool_complete'
        ? frame._meta
        : undefined;
    const outputTemplate: string | undefined = frameMeta?.outputTemplate;
    const nextChild: ContentBlock = {
      ...prevChild,
      isComplete: true,
      ...(frame.type === 'tool_error'
        ? { error: frame.error }
        : { result: frame.result }),
      ...(outputTemplate ? { outputTemplate } : {}),
      duration:
        typeof frame.durationMs === 'number'
          ? frame.durationMs
          : Date.now() - (prevChild.startTime || Date.now()),
    };

    const nextChildren = children.slice();
    nextChildren[childIdx] = nextChild;
    return blocks.map((b, i) =>
      i === roundIdx ? { ...b, children: nextChildren } : b,
    );
  }

  return blocks;
}
/**
 * Pure reducer: fold a `streaming_table` wire frame into the per-message
 * map. Drops malformed payloads silently (empty messageId, empty
 * artifact_id, or empty columns — there is nothing useful to render).
 * Hot-swaps in place when the artifact_id matches an existing entry under
 * the same messageId; appends otherwise.
 */
export function applyStreamingTableFrame(
  map: Record<string, StreamingTable[]>,
  messageId: string,
  frame: StreamingTableFrame,
): Record<string, StreamingTable[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const cols = Array.isArray(frame.columns) ? frame.columns : [];
  if (cols.length === 0) return map;
  const next: StreamingTable = {
    artifactId,
    title: typeof frame.title === 'string' ? frame.title : '',
    countText: typeof frame.count_text === 'string' && frame.count_text.length > 0
      ? frame.count_text
      : undefined,
    columns: cols.map((c) => ({
      key: typeof c.key === 'string' ? c.key : '',
      label: typeof c.label === 'string' ? c.label : '',
      align: c.align === 'right' ? 'right' : c.align === 'left' ? 'left' : undefined,
      cellClass:
        c.cell_class === 'mono' || c.cell_class === 'tnum' ? c.cell_class : undefined,
      colorize: c.colorize === 'delta-currency' ? 'delta-currency' : undefined,
      dim: c.dim === true ? true : undefined,
    })),
    rows: Array.isArray(frame.rows) ? frame.rows : [],
    filter:
      frame.filter && typeof frame.filter.column === 'string' && frame.filter.column.length > 0
        ? {
            column: frame.filter.column,
            default:
              typeof frame.filter.default === 'string' && frame.filter.default.length > 0
                ? frame.filter.default
                : undefined,
          }
        : undefined,
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((t) => t.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}
const VALID_SEVERITIES = new Set<FindingSeverityWire>([
  'critical', 'high', 'med', 'low', 'info', 'ok',
]);
/**
 * Pure reducer: fold a `findings_emit` wire frame into the per-message
 * map. Drops malformed payloads silently. Hot-swaps in place when the
 * artifact_id matches an existing entry under the same messageId;
 * appends otherwise.
 */
export function applyFindingsFrame(
  map: Record<string, FindingsArtifact[]>,
  messageId: string,
  frame: FindingsFrame,
): Record<string, FindingsArtifact[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const items = Array.isArray(frame.items) ? frame.items : [];
  if (items.length === 0) return map;
  const sanitized: FindingsItem[] = items
    .filter((it) => it && typeof it.id === 'string' && typeof it.title === 'string')
    .map((it) => ({
      id: it.id,
      title: it.title,
      severity: VALID_SEVERITIES.has(it.severity) ? it.severity : 'info',
      ...(typeof it.body === 'string' ? { body: it.body } : {}),
    }));
  if (sanitized.length === 0) return map;
  const next: FindingsArtifact = {
    artifactId,
    ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
    items: sanitized,
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((a) => a.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}
const INLINE_WIDGET_KINDS = new Set<InlineWidgetKind>([
  'kpi_grid',
  'savings_card',
  'stages_strip',
  'wave_timeline',
  'runbook',
  'stack_grid',
  'annotated_code',
]);
/**
 * Validate a payload against the kind's required-shape contract.
 * Returns false for malformed shapes so the reducer can drop silently.
 */
function isValidInlineWidgetData(kind: InlineWidgetKind, data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  switch (kind) {
    case 'kpi_grid':
      return Array.isArray(d.tiles) && d.tiles.length > 0;
    case 'savings_card':
      return Array.isArray(d.cells) && d.cells.length > 0;
    case 'stages_strip':
      return Array.isArray(d.stages) && d.stages.length > 0;
    case 'wave_timeline':
      return Array.isArray(d.rows) && d.rows.length > 0;
    case 'runbook':
      return Array.isArray(d.steps) && d.steps.length > 0;
    case 'stack_grid':
      return Array.isArray(d.layers) && d.layers.length > 0;
    case 'annotated_code':
      return Array.isArray(d.lines) && d.lines.length > 0;
    default:
      return false;
  }
}
/**
 * Pure reducer: fold one `inline_widget` wire frame into the
 * per-message map. Drops malformed payloads silently. Hot-swaps in
 * place when `artifact_id` matches an existing entry under the same
 * messageId; appends otherwise.
 */
export function applyInlineWidgetFrame(
  map: Record<string, InlineWidget[]>,
  messageId: string,
  frame: InlineWidgetFrame,
): Record<string, InlineWidget[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  if (!INLINE_WIDGET_KINDS.has(frame.kind)) return map;
  if (!isValidInlineWidgetData(frame.kind, frame.data)) return map;
  const next: InlineWidget = {
    artifactId,
    kind: frame.kind,
    ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
    data: frame.data,
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((w) => w.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}
/**
 * Pure reducer: fold one `artifact_emit` frame into the per-message
 * map. Drops malformed payloads silently. Hot-swaps in place when the
 * artifact_id matches an existing entry under the same messageId;
 * appends otherwise.
 */
export function applyArtifactEmitFrame(
  map: Record<string, ArtifactEmit[]>,
  messageId: string,
  frame: ArtifactEmitFrame,
): Record<string, ArtifactEmit[]> {
  if (!messageId) return map;
  const artifactId = typeof frame.artifact_id === 'string' ? frame.artifact_id.trim() : '';
  if (!artifactId) return map;
  const filename = typeof frame.filename === 'string' ? frame.filename : '';
  if (!filename) return map;
  const downloadUrl = typeof frame.download_url === 'string' ? frame.download_url : '';
  if (!downloadUrl) return map;

  const next: ArtifactEmit = {
    artifactId,
    filename,
    contentType: typeof frame.content_type === 'string' ? frame.content_type : 'application/octet-stream',
    sizeBytes: typeof frame.size_bytes === 'number' ? frame.size_bytes : 0,
    downloadUrl,
    ...(typeof frame.produced_by === 'string' ? { producedBy: frame.produced_by } : {}),
  };
  const existing = map[messageId] ?? [];
  const idx = existing.findIndex((a) => a.artifactId === artifactId);
  if (idx >= 0) {
    const replaced = [...existing];
    replaced[idx] = next;
    return { ...map, [messageId]: replaced };
  }
  return { ...map, [messageId]: [...existing, next] };
}
// Legacy AppRender / ArtifactRender shapes + applyAppRenderFrame /
// applyArtifactRenderFrame reducers were ripped. The `app_render` and
// `artifact_render` wire frames now fold into the canonical
// contentBlocks[] array via streamReducer/applyCanonicalFrame and render
// inline through AgenticActivityStream's typed-block path.
/**
 * Pure reducer: coerce + buffer-or-apply an `intent_classified` frame.
 * When `assistantMessageId` is empty (frame fired before assistant's
 * message_saved), the entry stashes in the pending slot for later flush.
 */
export function bufferOrApplyIntentClassified(
  safeData: unknown,
  assistantMessageId: string,
  prevMap: Record<string, IntentClassification>,
  prevPending: IntentClassification | null,
): {
  intentClassifications: Record<string, IntentClassification>;
  pending: IntentClassification | null;
} {
  const d: Record<string, unknown> =
    typeof safeData === 'object' && safeData !== null
      ? (safeData as Record<string, unknown>)
      : {};
  const intent = typeof d.intent === 'string' ? d.intent : '';
  const confidence =
    typeof d.confidence === 'number' && Number.isFinite(d.confidence)
      ? d.confidence
      : 0;
  const ms =
    typeof d.ms === 'number' && Number.isFinite(d.ms)
      ? d.ms
      : 0;
  const classifierCacheHit = d.classifierCacheHit === true;
  if (!intent) {
    // Defensive — drop malformed frames silently.
    return { intentClassifications: prevMap, pending: prevPending };
  }
  const entry: IntentClassification = { intent, confidence, ms, classifierCacheHit };
  if (!assistantMessageId) {
    return { intentClassifications: prevMap, pending: entry };
  }
  return {
    intentClassifications: { ...prevMap, [assistantMessageId]: entry },
    pending: prevPending,
  };
}

/** Flush buffered intent classification into the keyed map on assistant message_saved. */
export function flushPendingIntentClassified(
  assistantMessageId: string,
  prevMap: Record<string, IntentClassification>,
  prevPending: IntentClassification | null,
): {
  intentClassifications: Record<string, IntentClassification>;
  pending: IntentClassification | null;
} {
  if (!prevPending) return { intentClassifications: prevMap, pending: null };
  if (!assistantMessageId) {
    return { intentClassifications: prevMap, pending: prevPending };
  }
  return {
    intentClassifications: { ...prevMap, [assistantMessageId]: prevPending },
    pending: null,
  };
}

/**
 * Pure reducer: coerce + buffer-or-apply a `tool_shortlist` frame.
 *
 * Buffer-or-apply: when no assistant messageId is known yet (the frame
 * fires from prompt.stage before the assistant's message_saved arrives),
 * stash in a session-level pending slot; the case 'message_saved' arm
 * flushes it on assistant role.
 */
export function bufferOrApplyToolShortlist(
  safeData: unknown,
  assistantMessageId: string,
  prevMap: Record<string, ToolShortlist>,
  prevPending: ToolShortlist | null,
): {
  toolShortlists: Record<string, ToolShortlist>;
  pending: ToolShortlist | null;
} {
  const d: Record<string, unknown> =
    typeof safeData === 'object' && safeData !== null
      ? (safeData as Record<string, unknown>)
      : {};
  const totalAvailable =
    typeof d.total_available === 'number' &&
    Number.isFinite(d.total_available)
      ? d.total_available
      : 0;
  const count =
    typeof d.count === 'number' && Number.isFinite(d.count)
      ? d.count
      : 0;
  const intent = typeof d.intent === 'string' ? d.intent : '';
  const kept = Array.isArray(d.kept)
    ? (d.kept as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];
  if (totalAvailable <= 0) {
    // Defensive — backend skips emit when pool is empty; same here.
    return { toolShortlists: prevMap, pending: prevPending };
  }
  const entry: ToolShortlist = { totalAvailable, count, intent, kept };
  if (!assistantMessageId) {
    return { toolShortlists: prevMap, pending: entry };
  }
  return {
    toolShortlists: { ...prevMap, [assistantMessageId]: entry },
    pending: prevPending,
  };
}

/** Flush buffered tool-shortlist into the keyed map on assistant message_saved. */
export function flushPendingToolShortlist(
  assistantMessageId: string,
  prevMap: Record<string, ToolShortlist>,
  prevPending: ToolShortlist | null,
): {
  toolShortlists: Record<string, ToolShortlist>;
  pending: ToolShortlist | null;
} {
  if (!prevPending) return { toolShortlists: prevMap, pending: null };
  if (!assistantMessageId) {
    return { toolShortlists: prevMap, pending: prevPending };
  }
  return {
    toolShortlists: { ...prevMap, [assistantMessageId]: prevPending },
    pending: null,
  };
}
/**
 * Variant mapping for SubAgentCard. Drives the left-border colour +
 * avatar gradient. Both hyphen and underscore separators are accepted
 * — the api emits hyphens, but some paths use underscores.
 */
export function subAgentVariantFor(role: string): 'c' | 'g' | 's' | 'k' {
  const r = (role || '').toLowerCase();
  if (r === 'cost-analysis' || r === 'cost_analysis') return 'c';
  if (r === 'growth-analysis' || r === 'growth_analysis') return 'g';
  if (r === 'security-analysis' || r === 'security_analysis') return 's';
  if (r === 'kubernetes' || r === 'k8s') return 'k';
  return 'c';
}

/**
 * Pure reducer: append a new running sub-agent entry. Drops malformed
 * frames (missing role) silently and returns the input list by reference
 * so setState short-circuits on no-op.
 */
export function applySubAgentStarted(
  prev: SubAgentEntry[],
  frame: SubAgentStartedFrame,
): SubAgentEntry[] {
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return prev;
  const description =
    typeof frame.description === 'string' ? frame.description : undefined;
  const model = typeof frame.model === 'string' ? frame.model : null;
  const sessionId =
    typeof frame.session_id === 'string' ? frame.session_id : undefined;
  return [
    ...prev,
    {
      role,
      description,
      model,
      status: 'running',
      sessionId,
    },
  ];
}

/**
 * Pure reducer: complete the FIRST running sub-agent entry whose role
 * matches. Merges stats + error/ok status. If no matching running entry
 * exists, returns the input list by reference (defensive — server should
 * never emit completed without started).
 */
export function applySubAgentCompleted(
  prev: SubAgentEntry[],
  frame: SubAgentCompletedFrame,
): SubAgentEntry[] {
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return prev;
  const idx = prev.findIndex(
    (e) => e.role === role && e.status === 'running',
  );
  if (idx < 0) return prev;
  const out = [...prev];
  out[idx] = {
    ...out[idx],
    status: frame.ok ? 'ok' : 'error',
    stats: {
      turns: typeof frame.turns === 'number' ? frame.turns : 0,
      tokens: typeof frame.tokens === 'number' ? frame.tokens : 0,
      wallMs: typeof frame.durationMs === 'number' ? frame.durationMs : 0,
      toolsUsed: Array.isArray(frame.toolsUsed) ? frame.toolsUsed : undefined,
    },
    error: typeof frame.error === 'string' ? frame.error : null,
    output: typeof frame.output === 'string' ? frame.output : undefined,
  };
  return out;
}

/**
 * P0-1 part 2 — per-message-scoped sub_agent_started reducer.
 *
 * Per-message map keyed by active assistant messageId so older message
 * bubbles re-render with their OWN sub-agent cards instead of the latest
 * session-global snapshot.
 *
 * Drops malformed payloads (empty messageId or empty role) silently.
 */
export function applySubAgentStartedScoped(
  map: Record<string, SubAgentEntry[]>,
  messageId: string,
  frame: SubAgentStartedFrame,
): Record<string, SubAgentEntry[]> {
  if (!messageId) return map;
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return map;
  const entry: SubAgentEntry = {
    role,
    description: typeof frame.description === 'string' ? frame.description : null,
    model: typeof frame.model === 'string' ? frame.model : null,
    status: 'running',
  };
  const existing = map[messageId] ?? [];
  return {
    ...map,
    [messageId]: [...existing, entry],
  };
}

/**
 * P0-1 part 2 — per-message-scoped sub_agent_completed reducer. Flips the
 * matching running entry to ok|err with stats. Returns input unchanged on
 * empty messageId, no map entry, or no matching running entry by role.
 */
export function applySubAgentCompletedScoped(
  map: Record<string, SubAgentEntry[]>,
  messageId: string,
  frame: SubAgentCompletedFrame,
): Record<string, SubAgentEntry[]> {
  if (!messageId) return map;
  const role = typeof frame.role === 'string' ? frame.role : '';
  if (!role) return map;
  const list = map[messageId];
  if (!list || list.length === 0) return map;
  const idx = list.findIndex((e) => e.role === role && e.status === 'running');
  if (idx < 0) return map;
  const next = [...list];
  next[idx] = {
    ...next[idx],
    status: frame.ok ? 'ok' : 'error',
    stats: {
      turns: typeof frame.turns === 'number' ? frame.turns : 0,
      tokens: typeof frame.tokens === 'number' ? frame.tokens : 0,
      wallMs: typeof frame.durationMs === 'number' ? frame.durationMs : 0,
      toolsUsed: Array.isArray(frame.toolsUsed) ? frame.toolsUsed : undefined,
    },
    error: typeof frame.error === 'string' ? frame.error : null,
    output: typeof frame.output === 'string' ? frame.output : undefined,
  };
  return { ...map, [messageId]: next };
}

/**
 * #502 case-statement glue extracted as a pure dispatcher so the
 * "type-label + safeData coercion" wire-up gets unit-test coverage
 * without renderHook'ing the full SSE / fetch / auth stack.
 */
export function dispatchSubAgentFrame(
  frameType: string,
  safeData: unknown,
  prev: SubAgentEntry[],
): { subAgents: SubAgentEntry[] } {
  const d: Record<string, unknown> =
    typeof safeData === 'object' && safeData !== null
      ? (safeData as Record<string, unknown>)
      : {};
  if (frameType === 'sub_agent_started') {
    return {
      subAgents: applySubAgentStarted(prev, {
        type: 'sub_agent_started',
        role: typeof d.role === 'string' ? d.role : '',
        description:
          typeof d.description === 'string'
            ? d.description
            : undefined,
        model: typeof d.model === 'string' ? d.model : null,
        session_id:
          typeof d.session_id === 'string'
            ? d.session_id
            : undefined,
      }),
    };
  }
  if (frameType === 'sub_agent_completed') {
    return {
      subAgents: applySubAgentCompleted(prev, {
        type: 'sub_agent_completed',
        role: typeof d.role === 'string' ? d.role : '',
        ok: d.ok === true,
        error: typeof d.error === 'string' ? d.error : null,
        turns: typeof d.turns === 'number' ? d.turns : 0,
        tokens: typeof d.tokens === 'number' ? d.tokens : 0,
        durationMs:
          typeof d.durationMs === 'number' ? d.durationMs : 0,
        toolsUsed: Array.isArray(d.toolsUsed)
          ? (d.toolsUsed as string[])
          : undefined,
        // Phase 16 wire-unwrap fix — forward the sub-agent's actual return
        // content. Without this, the reducer would receive `output:
        // undefined` and SubAgentCard falls back to "X turns Y tok".
        output: typeof d.output === 'string' ? d.output : undefined,
      }),
    };
  }
  // Unknown frame type — return inputs by reference.
  return { subAgents: prev };
}
