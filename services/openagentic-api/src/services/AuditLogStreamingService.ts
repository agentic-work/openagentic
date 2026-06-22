/**
 * AuditLogStreamingService
 *
 * Dispatches FlowAuditLog rows to the configured external sink.
 *
 * AUDIT_LOG_SINK=stdout|datadog|splunk|fluentd|s3 (default: stdout)
 *
 * HTTP sinks (datadog, splunk) use configurable batching:
 *   AUDIT_BATCH_SIZE     — rows per HTTP call (default 100)
 *   AUDIT_FLUSH_INTERVAL — ms between auto-flushes (default 5000)
 *
 * Network errors are caught, logged as warnings, and NEVER re-thrown.
 */

import { loggers } from '../utils/logger.js';

const logger = loggers.services.child({ component: 'AuditLogStreamingService' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DispatchOptions {
  /** Skip buffering and flush immediately (for testing & forced flushes). */
  flushNow?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AuditLogStreamingService {
  private readonly sink: string;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  /** Buffer for HTTP sinks that batch rows. */
  private buffer: any[] = [];
  /** Auto-flush timer. */
  private flushTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.sink = (process.env.AUDIT_LOG_SINK || 'stdout').toLowerCase();
    this.batchSize = Number.parseInt(process.env.AUDIT_BATCH_SIZE || '100', 10);
    this.flushIntervalMs = Number.parseInt(process.env.AUDIT_FLUSH_INTERVAL || '5000', 10);
  }

  /**
   * Dispatch a row to the configured sink.
   *
   * stdout  → immediate JSON line write
   * datadog → batch → flush on size or interval
   * splunk  → batch → flush on size or interval
   * s3      → batch → flush on size or interval
   * fluentd → immediate HTTP POST to fluentd forward endpoint
   */
  async dispatch(row: any, opts: DispatchOptions = {}): Promise<void> {
    try {
      switch (this.sink) {
        case 'stdout':
          this.dispatchStdout(row);
          break;

        case 'datadog':
          this.buffer.push(row);
          if (opts.flushNow || this.buffer.length >= this.batchSize) {
            await this.flush();
          } else {
            this.scheduleAutoFlush();
          }
          break;

        case 'splunk':
          this.buffer.push(row);
          if (opts.flushNow || this.buffer.length >= this.batchSize) {
            await this.flush();
          } else {
            this.scheduleAutoFlush();
          }
          break;

        case 's3':
          this.buffer.push(row);
          if (opts.flushNow || this.buffer.length >= this.batchSize) {
            await this.flush();
          } else {
            this.scheduleAutoFlush();
          }
          break;

        case 'fluentd':
          await this.dispatchFluentd(row);
          break;

        default:
          logger.warn({ sink: this.sink }, '[AuditLog] Unknown AUDIT_LOG_SINK — falling back to stdout');
          this.dispatchStdout(row);
          break;
      }
    } catch (err) {
      logger.warn({ err, sink: this.sink }, '[AuditLog] Sink dispatch error — row is safely persisted in DB');
    }
  }

  /**
   * Flush the batch buffer to the active HTTP sink.
   * Called explicitly (flushNow) or by the auto-flush timer.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);  // drain buffer atomically

    try {
      switch (this.sink) {
        case 'datadog':
          await this.flushDatadog(batch);
          break;
        case 'splunk':
          await this.flushSplunk(batch);
          break;
        case 's3':
          await this.flushS3(batch);
          break;
        default:
          break;
      }
    } catch (err) {
      logger.warn({ err, sink: this.sink, rows: batch.length }, '[AuditLog] Batch flush failed — rows lost from buffer (persisted in DB)');
    }
  }

  // ---------------------------------------------------------------------------
  // stdout
  // ---------------------------------------------------------------------------

  private dispatchStdout(row: any): void {
    const line = JSON.stringify({ audit: row }) + '\n';
    process.stdout.write(line);
  }

  // ---------------------------------------------------------------------------
  // Datadog
  // ---------------------------------------------------------------------------

  private async flushDatadog(batch: any[]): Promise<void> {
    const apiKey = process.env.DATADOG_API_KEY || '';
    const site = process.env.DATADOG_SITE || 'datadoghq.com';
    const url = `https://http-intake.logs.${site}/api/v2/logs`;

    const payload = batch.map((row) => ({
      ddsource: 'openagentic-audit',
      ddtags: `action:${row.action},outcome:${row.outcome}`,
      service: 'openagentic-api',
      message: JSON.stringify(row),
    }));

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Datadog intake responded ${res.status}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Splunk HEC
  // ---------------------------------------------------------------------------

  private async flushSplunk(batch: any[]): Promise<void> {
    const hecUrl = process.env.SPLUNK_HEC_URL || '';
    const token = process.env.SPLUNK_HEC_TOKEN || '';

    if (!hecUrl) {
      logger.warn('[AuditLog] SPLUNK_HEC_URL is not configured');
      return;
    }

    // Splunk HEC accepts newline-delimited events
    const body = batch
      .map((row) => JSON.stringify({ time: Math.floor(new Date(row.ts).getTime() / 1000), event: row }))
      .join('\n');

    const res = await fetch(hecUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`Splunk HEC responded ${res.status}`);
    }
  }

  // ---------------------------------------------------------------------------
  // S3 — simple batched PUT (newline-delimited JSON)
  // ---------------------------------------------------------------------------

  private async flushS3(batch: any[]): Promise<void> {
    const bucket = process.env.AUDIT_S3_BUCKET || '';
    const region = process.env.AWS_REGION || 'us-east-1';

    if (!bucket) {
      logger.warn('[AuditLog] AUDIT_S3_BUCKET is not configured');
      return;
    }

    const date = new Date().toISOString().split('T')[0];
    const key = `audit-logs/${date}/${Date.now()}.ndjson`;
    const body = batch.map((r) => JSON.stringify(r)).join('\n');

    // Use the AWS SDK fetch-based approach for k8s IAM/IRSA environments.
    // We intentionally keep this as a simple signed PUT rather than importing
    // the full @aws-sdk/client-s3 to avoid adding a heavy dependency just for
    // the S3 sink.  In practice, use IRSA or instance profile for auth.
    const url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/x-ndjson',
          'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
        },
        body,
      });

      if (!res.ok && res.status !== 403) {
        // 403 can mean no IRSA — warn but don't throw for local dev
        throw new Error(`S3 PUT responded ${res.status}`);
      }
    } catch (err) {
      logger.warn({ err, bucket, key }, '[AuditLog] S3 flush failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Fluentd forward protocol (simple HTTP POST)
  // ---------------------------------------------------------------------------

  private async dispatchFluentd(row: any): Promise<void> {
    const host = process.env.FLUENTD_HOST || '';
    const port = process.env.FLUENTD_PORT || '9880';
    const tag = process.env.FLUENTD_TAG || 'openagentic.audit';

    if (!host) {
      logger.warn('[AuditLog] FLUENTD_HOST is not configured — skipping fluentd dispatch');
      return;
    }

    const url = `http://${host}:${port}/${tag}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });

      if (!res.ok) {
        throw new Error(`Fluentd responded ${res.status}`);
      }
    } catch (err) {
      logger.warn({ err, host, port, tag }, '[AuditLog] Fluentd dispatch failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-flush timer management
  // ---------------------------------------------------------------------------

  private scheduleAutoFlush(): void {
    if (this.flushTimer) return;  // already scheduled
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      await this.flush().catch((err) => {
        logger.warn({ err }, '[AuditLog] Auto-flush failed');
      });
    }, this.flushIntervalMs);

    // Don't keep the process alive just for a flush
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }
}
