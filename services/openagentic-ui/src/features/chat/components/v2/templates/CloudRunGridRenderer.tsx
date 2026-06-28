/**
 * CloudRunGridRenderer — compose_visual:cloud-run-grid template (mock 04).
 *
 * GCP CloudRun service grid — card per service with region pill, URL,
 * last-deploy, min-instances, concurrency, CPU/memory.
 *
 * Mock anatomy: mocks/UX/AI/Chatmode/end-state-04-gcp-cloudrun-interrogation.html
 * Token-driven; no hex literals.
 *
 * the design notes
 *       §Phase 2.2.3 — A2 UI render pipeline.
 */

import React from 'react';

export interface CloudRunService {
  /** Stable id used as a card key. */
  id: string;
  /** Service name (rendered as the card heading). */
  name: string;
  /** GCP region (us-central1, europe-west1, etc.). */
  region: string;
  /** Live service URL. Optional; rendered as a code-styled span. */
  url?: string;
  /** ISO timestamp or human-readable last deploy ("3h ago"). */
  lastDeploy?: string;
  /** min-instances setting. */
  minInstances?: number;
  /** max concurrent requests per instance. */
  concurrency?: number;
  /** CPU allocation ("1", "2", "0.5"). */
  cpu?: string;
  /** Memory allocation ("256Mi", "1Gi"). */
  memory?: string;
  /** Optional status pill (running / failed / deploying). */
  status?: 'running' | 'failed' | 'deploying' | 'idle';
  /** Optional warning text rendered as a banner. */
  warning?: string;
}

export interface CloudRunGridRendererProps {
  title?: string;
  services: ReadonlyArray<CloudRunService>;
}

function statusTone(s?: CloudRunService['status']): string {
  switch (s) {
    case 'running':
      return 'var(--cm-ok, currentColor)';
    case 'failed':
      return 'var(--cm-err, currentColor)';
    case 'deploying':
      return 'var(--cm-accent, currentColor)';
    case 'idle':
      return 'var(--cm-fg-3, currentColor)';
    default:
      return 'var(--cm-fg-2, currentColor)';
  }
}

export function CloudRunGridRenderer({ title, services }: CloudRunGridRendererProps) {
  if (!services || services.length === 0) return null;

  return (
    <div
      className="cm-cloud-run-grid"
      data-testid="cloud-run-grid-renderer"
      style={{
        background: 'transparent',
        color: 'var(--cm-fg-1)',
        fontFamily: 'inherit',
      }}
    >
      {title && (
        <div
          className="cm-cloud-run-grid-head"
          style={{
            marginBottom: 8,
            fontWeight: 600,
            color: 'var(--cm-fg-0)',
            fontSize: 14,
          }}
        >
          {title}
        </div>
      )}
      <div
        className="cm-cloud-run-grid-cards"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 10,
        }}
      >
        {services.map((svc) => (
          <div
            key={svc.id}
            className={`cm-cloud-run-card cm-cloud-run-card-${svc.status ?? 'idle'}`}
            data-service-id={svc.id}
            data-status={svc.status ?? 'idle'}
            style={{
              background: 'var(--cm-bg-1, transparent)',
              border: '1px solid var(--cm-stroke-1)',
              borderLeft: `3px solid ${statusTone(svc.status)}`,
              borderRadius: 6,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              className="cm-cloud-run-card-head"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 6,
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--cm-fg-0)' }}>{svc.name}</span>
              <span
                className="cm-cloud-run-region"
                style={{
                  fontSize: 10.5,
                  padding: '2px 6px',
                  borderRadius: 999,
                  background: 'var(--cm-bg-2, transparent)',
                  border: '1px solid var(--cm-stroke-2)',
                  color: 'var(--cm-fg-2)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                {svc.region}
              </span>
            </div>
            {svc.url && (
              <code
                className="cm-cloud-run-url"
                style={{
                  fontSize: 11,
                  color: 'var(--cm-fg-2)',
                  background: 'var(--cm-bg-2, transparent)',
                  padding: '3px 5px',
                  borderRadius: 3,
                  fontFamily: 'JetBrains Mono, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {svc.url}
              </code>
            )}
            <dl
              className="cm-cloud-run-attrs"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 6,
                rowGap: 2,
                margin: 0,
                fontSize: 11,
                color: 'var(--cm-fg-2)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {svc.lastDeploy !== undefined && (
                <>
                  <dt style={{ color: 'var(--cm-fg-3)' }}>deploy</dt>
                  <dd style={{ margin: 0 }}>{svc.lastDeploy}</dd>
                </>
              )}
              {svc.minInstances !== undefined && (
                <>
                  <dt style={{ color: 'var(--cm-fg-3)' }}>min</dt>
                  <dd style={{ margin: 0 }}>{svc.minInstances}</dd>
                </>
              )}
              {svc.concurrency !== undefined && (
                <>
                  <dt style={{ color: 'var(--cm-fg-3)' }}>conc</dt>
                  <dd style={{ margin: 0 }}>{svc.concurrency}</dd>
                </>
              )}
              {svc.cpu !== undefined && (
                <>
                  <dt style={{ color: 'var(--cm-fg-3)' }}>cpu</dt>
                  <dd style={{ margin: 0 }}>{svc.cpu}</dd>
                </>
              )}
              {svc.memory !== undefined && (
                <>
                  <dt style={{ color: 'var(--cm-fg-3)' }}>mem</dt>
                  <dd style={{ margin: 0 }}>{svc.memory}</dd>
                </>
              )}
            </dl>
            {svc.warning && (
              <div
                className="cm-cloud-run-warn"
                style={{
                  fontSize: 11,
                  padding: '4px 6px',
                  borderRadius: 3,
                  background: 'var(--cm-bg-2, transparent)',
                  border: '1px solid var(--cm-warn, currentColor)',
                  color: 'var(--cm-warn, currentColor)',
                }}
              >
                {svc.warning}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CloudRunGridRenderer;
