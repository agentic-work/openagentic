/**
 * Phase G (task #152) — inline event renderers.
 *
 * Twelve small components, one per event type. Each is a pure
 * React.memo render with a small `data-testid` and a visual that
 * matches the v0.6.7 UX mockup at
 * `docs/release-plans/v0.6.7-ux-mockups/02-kubernetes-health-report.html`.
 *
 * `useChatStream` collects event payloads into state slices and the
 * corresponding consumer components (MessageBubble, tool cards, etc.)
 * render these for the streaming message. Each event is one of the
 * shapes documented in `docs/core/streaming-contract.md`.
 */

export { HandoffPill } from './HandoffPill';
export type { HandoffPillProps } from './HandoffPill';

export { RetryPill } from './RetryPill';
export type { RetryPillProps } from './RetryPill';

export { StageStrip, STAGE_ORDER } from './StageStrip';
export type { StageStripProps, StagePhase } from './StageStrip';

export { RagCitationChip } from './RagCitationChip';
export type { RagCitationChipProps } from './RagCitationChip';

export { CorrectionBlock } from './CorrectionBlock';
export type { CorrectionBlockProps } from './CorrectionBlock';

export { WarningPill } from './WarningPill';
export type { WarningPillProps, WarningLevel } from './WarningPill';

export { ToolCacheHitBadge } from './ToolCacheHitBadge';
export type { ToolCacheHitBadgeProps } from './ToolCacheHitBadge';

export { SelfCritiqueBlock } from './SelfCritiqueBlock';
export type { SelfCritiqueBlockProps } from './SelfCritiqueBlock';

export { HallucinationWarning } from './HallucinationWarning';
export type { HallucinationWarningProps } from './HallucinationWarning';

export { RagStatusLine } from './RagStatusLine';
export type { RagStatusLineProps } from './RagStatusLine';

export { MemoryStatusLine } from './MemoryStatusLine';
export type { MemoryStatusLineProps } from './MemoryStatusLine';

export { DlpScanStatus } from './DlpScanStatus';
export type { DlpScanStatusProps, DlpScanState } from './DlpScanStatus';

// Phase H (task #153) — artifact / image-gen / session / memory / context
export { ArtifactStartBanner } from './ArtifactStartBanner';
export type { ArtifactStartBannerProps, ArtifactKind } from './ArtifactStartBanner';

export { ImageProgressThumb } from './ImageProgressThumb';
export type { ImageProgressThumbProps } from './ImageProgressThumb';

export { MemoryWritePill } from './MemoryWritePill';
export type { MemoryWritePillProps, MemoryScope } from './MemoryWritePill';

export { ContextCompactedNotice } from './ContextCompactedNotice';
export type { ContextCompactedNoticeProps } from './ContextCompactedNotice';

export { SessionRenameAnimation, useSessionRenameMorph } from './SessionRenameAnimation';
export type {
  SessionRenameAnimationProps,
  UseSessionRenameMorphReturn,
} from './SessionRenameAnimation';

// Task #158 — in-browser Python/JS sandbox card (browser_exec_request)
export { SandboxExecCard } from './SandboxExecCard';
export type { SandboxExecCardProps, SandboxExecState } from './SandboxExecCard';

// Task #154 — Phase I durable streams: "↻ Reconnected" pill
// shown for 2s after a successful /tail resume.
export { ReconnectedPill } from './ReconnectedPill';
export type { ReconnectedPillProps } from './ReconnectedPill';
