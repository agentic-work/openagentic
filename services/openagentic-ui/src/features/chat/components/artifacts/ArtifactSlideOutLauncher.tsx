/**
 * #781 Phase D — ArtifactSlideOutLauncher.
 *
 * Compact in-message button that opens `ArtifactSlideOut` with the
 * matching renderer. Replaces the old inline `ArtifactRenderer` /
 * `StreamingArtifactRenderer` pipeline for any message with
 * new-pipeline metadata (`tool_result._meta.artifactKind` OR
 * `Message.visualizations[]`).
 *
 * The launcher is intentionally tiny — the rich content lives in the
 * slide-out body, not in the chat thread. Mirrors the Claude.ai
 * "artifact" pill UX.
 */
import React, { useState } from 'react';
import { ArtifactSlideOut } from './ArtifactSlideOut.js';
import { PythonReport } from './renderers/PythonReport.js';
import { ReactApp } from './renderers/ReactApp.js';
import { Chart } from './renderers/Chart.js';
import { Table } from './renderers/Table.js';
import { Runbook } from './renderers/Runbook.js';
import { MiniApp } from './renderers/MiniApp.js';
import type { ArtifactKind, ArtifactStatus } from './types.js';

const KNOWN_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'python-report',
  'react-app',
  'chart',
  'table',
  'runbook',
  'mini-app',
]);

export interface ArtifactSlideOutLauncherProps {
  kind: ArtifactKind;
  title: string;
  /** Renderer-specific payload, shape determined by `kind`. */
  payload: unknown;
  /** Optional lifecycle status, defaults to 'success'. */
  status?: ArtifactStatus;
}

function renderBody(kind: ArtifactKind, payload: any): React.ReactNode {
  switch (kind) {
    case 'python-report':
      return (
        <PythonReport
          stdout={payload?.stdout ?? payload?.markdown ?? ''}
          executionTimeMs={payload?.executionTimeMs}
        />
      );
    case 'react-app':
      return (
        <ReactApp
          appId={payload?.appId ?? ''}
          src={payload?.src}
          title={payload?.title}
        />
      );
    case 'chart':
      return (
        <Chart
          kind={payload?.kind ?? 'bar'}
          data={payload?.data ?? []}
          title={payload?.title}
        />
      );
    case 'table':
      return (
        <Table
          rows={payload?.rows ?? []}
          columns={payload?.columns ?? []}
          title={payload?.title}
        />
      );
    case 'runbook':
      return (
        <Runbook id={payload?.id ?? 'runbook'} steps={payload?.steps ?? []} />
      );
    case 'mini-app':
      return (
        <MiniApp
          execId={payload?.execId ?? ''}
          capabilities={payload?.capabilities ?? []}
          caps={payload?.caps ?? { cpu: 1, ramMiB: 256, ttlSec: 300 }}
          error={payload?.error}
        />
      );
    default:
      return (
        <div
          data-testid="artifact-unknown"
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--graphite, rgba(13,13,12,0.55))',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 12,
            letterSpacing: 0.04,
          }}
        >
          Unsupported artifact kind: <code>{String(kind)}</code>
        </div>
      );
  }
}

export const ArtifactSlideOutLauncher: React.FC<ArtifactSlideOutLauncherProps> = ({
  kind,
  title,
  payload,
  status = 'success',
}) => {
  const [open, setOpen] = useState(false);
  const resolvedKind: ArtifactKind = KNOWN_KINDS.has(kind) ? kind : 'unknown';

  return (
    <>
      <button
        type="button"
        data-testid="artifact-launcher"
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          background: 'var(--paper-2, rgba(13,13,12,0.04))',
          border: '1px solid var(--ink-on-paper, rgba(13,13,12,0.12))',
          borderLeft: '3px solid var(--accent, #c1440e)',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)',
          fontSize: 13,
          color: 'var(--ink, #0d0d0c)',
          textAlign: 'left',
          maxWidth: '100%',
        }}
      >
        <span
          data-testid="artifact-launcher-kind"
          style={{
            fontSize: 10,
            letterSpacing: 0.16,
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--accent, #c1440e)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          }}
        >
          {resolvedKind}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-serif, ui-serif, Georgia, serif)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 320,
          }}
        >
          {title}
        </span>
        <span
          aria-hidden
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            fontSize: 11,
            color: 'var(--graphite, rgba(13,13,12,0.55))',
          }}
        >
          View →
        </span>
      </button>
      <ArtifactSlideOut
        open={open}
        onOpenChange={setOpen}
        title={title}
        kind={resolvedKind}
        status={status}
      >
        {renderBody(resolvedKind, payload)}
      </ArtifactSlideOut>
    </>
  );
};
