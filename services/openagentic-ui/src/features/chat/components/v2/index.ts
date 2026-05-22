/**
 * V2 chatmode components — UX contract from mocks/UX/01-09.html.
 *
 * Import sites should pull from this index so the v2 namespace stays
 * stable when individual components are refactored.
 */
export { MessageHeader } from './MessageHeader.js';
export type { MessageHeaderProps, AgentVariant } from './MessageHeader.js';

export { ToolCard } from './ToolCard.js';
export type { ToolCardProps, ToolStatus } from './ToolCard.js';

export { SubAgentCard } from './SubAgentCard.js';
export type {
  SubAgentCardProps,
  SubAgentStats,
  SubAgentVariant,
} from './SubAgentCard.js';

export { StagesStrip } from './StagesStrip.js';
export type { StagesStripProps, StageItem, StageStatus } from './StagesStrip.js';

export { HandoffPill } from './HandoffPill.js';
export type { HandoffPillProps } from './HandoffPill.js';

export { JsonView } from './JsonView.js';
export type { JsonViewProps } from './JsonView.js';

export { TopbarCostPill } from './TopbarCostPill.js';
export type { TopbarCostPillProps } from './TopbarCostPill.js';

// Phase 1 universal-anatomy parity — topbar primitives (mocks 01:128-153, 10:202-207).
export { Crumbs } from './Crumbs.js';
export type { CrumbsProps } from './Crumbs.js';

export { ToolsPill } from './ToolsPill.js';
export type { ToolsPillProps } from './ToolsPill.js';

// Phase 2 universal-anatomy parity — tool-array hint pill row (mock 10:227-241).
export { ToolArray } from './ToolArray.js';
export type { ToolArrayProps, ToolArrayItem, ToolTier } from './ToolArray.js';

// Phase 10 universal-anatomy parity — agent-tree (mock 04:~830, mocks 05/06/09).
export { AgentTree } from './AgentTree.js';
export type { AgentTreeProps, AgentTreeNode, AgentTreeVariant } from './AgentTree.js';

// Phase 14 universal-anatomy parity — findings list (mocks 03, 07, 08, 09).
export { Findings } from './Findings.js';
export type { FindingsProps, FindingItem, FindingSeverity } from './Findings.js';

// Phase 15 universal-anatomy parity — self-correction card (mocks 04, 05, 06).
export { CorrectionCard } from './CorrectionCard.js';
export type { CorrectionCardProps } from './CorrectionCard.js';

// Phase 17 universal-anatomy parity — multi-pass chip (mock 04).
export { PassChip } from './PassChip.js';
export type { PassChipProps } from './PassChip.js';

// Phase 20 universal-anatomy parity — artifact split-pane viewer
// (mocks 02, 03, 06, 07, 08, 09).
export { ArtifactPane } from './ArtifactPane.js';
export type { ArtifactPaneProps, ArtifactPaneTab } from './ArtifactPane.js';

// Phase 21 universal-anatomy parity — runbook step list (mocks 04, 05, 08).
export { Runbook } from './Runbook.js';
export type { RunbookProps, RunbookStep, RunbookSeverity } from './Runbook.js';

// Phase 22 universal-anatomy parity — wave timeline (mocks 06, 08).
export { WaveTimeline } from './WaveTimeline.js';
export type { WaveTimelineProps, WaveRow, WaveSegment, WaveTone } from './WaveTimeline.js';

// Phase 23 universal-anatomy parity — tech stack grid (mock 09).
export { StackGrid } from './StackGrid.js';
export type { StackGridProps, StackLayer } from './StackGrid.js';

// Phase 24 universal-anatomy parity — code annotations (mocks 03, 07).
export { AnnotatedCode } from './AnnotatedCode.js';
export type { AnnotatedCodeProps } from './AnnotatedCode.js';

// #502 mock 01-10 parity primitives — inline-style components, no global CSS.
// Each builds toward chatmode parity with mocks/UX/01-cloud-ops.html etc.
export { SavingsCard } from './SavingsCard.js';
export type { SavingsCardProps, SavingsCardCell } from './SavingsCard.js';

export { KpiGrid } from './KpiGrid.js';
export type { KpiGridProps, KpiTile } from './KpiGrid.js';

export { SeverityTag } from './SeverityTag.js';
export type { SeverityTagProps, Severity } from './SeverityTag.js';

export { CostPill } from './CostPill.js';
export type { CostPillProps } from './CostPill.js';

export { StreamingTable } from './StreamingTable.js';
export type { StreamingTableProps } from './StreamingTable.js';

// Mock-07 tri-cloud cost spikes — per-cloud accent pill used inside
// streaming-table Cloud cells (and any inline place that wants to
// colour-tag a row by provider).
export { CloudBadge } from './CloudBadge.js';
export type { CloudBadgeProps } from './CloudBadge.js';

export { ToolParallelHeader } from './ToolParallelHeader.js';
export type { ToolParallelHeaderProps } from './ToolParallelHeader.js';

export { CitationChip } from './CitationChip.js';
export type { CitationChipProps } from './CitationChip.js';

export { AvatarCrumb } from './AvatarCrumb.js';
export type { AvatarCrumbProps, AvatarVariant } from './AvatarCrumb.js';

export { StatusRow } from './StatusRow.js';
export type { StatusRowProps, StatusRowItem } from './StatusRow.js';

// WidgetRenderer + AppRenderer — sandbox-iframe surfaces for inline visuals
// (compose_visual / compose_app). Already used inline by ChatMessages, now
// also re-exported so /dev/v2-primitives + future consumers pull through
// the barrel.
export { WidgetRenderer } from './WidgetRenderer.js';
export { AppRenderer } from './AppRenderer.js';

// LiveTurnStatus — codemode-style live time + ↑/↓ token + activity strip,
// rendered under the streaming assistant avatar so the user sees first-token
// latency, in/out token counts, and what the model is doing right now.
export { LiveTurnStatus } from './LiveTurnStatus.js';

import './chatmode-v2.css';
