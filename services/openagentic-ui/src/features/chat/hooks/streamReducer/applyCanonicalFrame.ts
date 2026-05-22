/**
 * Track B Phase 7 (chatmode canonical streaming rip) — this file is now a
 * thin re-export shim. The reducer SoT lives in the SDK so server (api) and
 * UI consume the SAME pure function, guaranteeing persisted
 * `chat_messages.content_blocks` ≡ live-rendered `contentBlocks[]` by
 * construction.
 *
 * SoT path: `~/openagentic/openagentic-sdk/src/lib/ui-stream/applyCanonicalFrame.ts`
 * Plan:     `/home/trent/.claude/plans/sprightly-percolating-brook.md` (Phase 7)
 *
 * The re-export keeps existing UI imports stable
 * (`from '../streamReducer/applyCanonicalFrame'`) so no UI call site
 * changes — and it satisfies the `no-dual-state` arch test's allow-list
 * which matches the local module path.
 */
export {
  applyCanonicalFrame,
  consumeWireFrame,
  initialFrameState,
  type FrameState,
  type WireFrame,
} from '@agentic-work/llm-sdk';
