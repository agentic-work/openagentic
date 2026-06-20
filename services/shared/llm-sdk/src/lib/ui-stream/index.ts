/**
 * UI Stream Frame + Content Block types — public re-exports.
 *
 * Single SoT for the streaming wire frame shape the openagentic-api emits
 * on `/api/chat/stream` AND the persistence shape held in
 * `chat_messages.content_blocks` Json column. Both the UI's
 * `applyCanonicalFrame` reducer AND the StreamEngine (React-bypass
 * renderer) consume these types directly — no UI-local parallel type
 * hierarchy.
 *
 * the design notes
 */

export type {
  CanonicalContentBlock,
  CanonicalEvent,
  UIArtifactKind,
  UIAppRenderFrame,
  UIArtifactRenderFrame,
  UIContentBlock,
  UIContentBlockType,
  UIFollowUpFrame,
  UIStreamCompleteFrame,
  UIStreamFrame,
  UIStreamFrameLoose,
  UIStreamStartFrame,
  UIThinkingCompleteFrame,
  UIToolCallCompleteFrame,
  UIToolErrorFrame,
  UIToolExecutingFrame,
  UIToolResultFrame,
  UIToolRoundEndFrame,
  UIToolRoundStartFrame,
  UIVisualRenderFrame,
} from './types.js';

// Track B Phase 7 (chatmode canonical streaming rip) — applyCanonicalFrame
// reducer is the SoT for UI live render AND server persistence chronology.
// One reducer, one shape, persistence ≡ render by construction.
export {
  applyCanonicalFrame,
  consumeWireFrame,
  initialFrameState,
  type FrameState,
  type WireFrame,
} from './applyCanonicalFrame.js';
