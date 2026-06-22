/**
 * splunk_search node executor.
 *
 * Supports three operations against Splunk Enterprise / Splunk Cloud REST APIs:
 *
 *   search         — execute SPL via REST, poll for completion, return events
 *   alert_ack      — acknowledge a Splunk notable event via notable_update
 *   notable_create — push a notable event via HEC (HTTP Event Collector)
 *
 * Authentication: bearer token (session token or HEC token depending on op),
 * resolved through ctx.interpolateTemplate so {{secret:splunk_token}} works.
 *
 * TLS: certificate verification is ON by default. Set allowInsecure=true only
 * in dev/sandbox environments.
 */

import https from 'https';
import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';
import { abortableAxios } from '../../abortableAxios.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchResult {
  jobId: string;
  events: unknown[];
  eventCount: number;
  earliestTime: string;
  latestTime: string;
}

interface AlertAckResult {
  ok: boolean;
  notableId: string;
}

interface NotableCreateResult {
  ok: boolean;
  eventId: string | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a shared axios config for Splunk REST calls.
 * Sets Authorization header and optionally disables TLS verification.
 */
function buildRequestConfig(
  resolvedToken: string,
  allowInsecure: boolean,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const httpsAgent = allowInsecure
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

  const config: Record<string, unknown> = {
    headers: {
      Authorization: resolvedToken,
      'Content-Type': 'application/json',
    },
    validateStatus: () => true, // handle status checks manually
    ...extra,
  };

  if (httpsAgent) {
    config.httpsAgent = httpsAgent;
  }

  return config;
}

/**
 * Splunk search: create a job, poll until DONE (or timeout), fetch results.
 */
async function runSearch(
  ctx: NodeExecutionContext,
  node: WorkflowNode,
  host: string,
  resolvedToken: string,
  allowInsecure: boolean,
  input: unknown,
): Promise<SearchResult> {
  const {
    spl,
    earliestTime = '-15m',
    latestTime = 'now',
    maxResults = 100,
    timeout = 60000,
  } = node.data as Record<string, any>;

  const resolvedSpl = ctx.interpolateTemplate(spl || '', input);
  if (!resolvedSpl) {
    throw new Error('splunk_search requires an spl query when operation=search');
  }

  const resolvedEarliest = ctx.interpolateTemplate(String(earliestTime), input);
  const resolvedLatest = ctx.interpolateTemplate(String(latestTime), input);

  ctx.logger.info(
    { nodeId: node.id, operation: 'search', spl: resolvedSpl.slice(0, 80) },
    '[splunk_search] Creating search job',
  );

  // POST /services/search/jobs — create the job
  const createConfig = buildRequestConfig(resolvedToken, allowInsecure, {
    method: 'post',
    url: `${host}/services/search/jobs`,
    data: {
      search: `search ${resolvedSpl}`,
      earliest_time: resolvedEarliest,
      latest_time: resolvedLatest,
      output_mode: 'json',
      count: maxResults,
    },
    timeout: 30000,
  });

  const createResp = await abortableAxios({ signal: ctx.signal }, createConfig as any);

  if (createResp.status < 200 || createResp.status >= 300) {
    const body = createResp.data;
    const msg =
      (body?.messages?.[0]?.text) ||
      (typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200));
    throw new Error(`splunk_search job creation failed (HTTP ${createResp.status}): ${msg}`);
  }

  const sid: string = (createResp.data as any)?.sid;
  if (!sid) {
    throw new Error('splunk_search: search job creation did not return a sid');
  }

  ctx.logger.info({ nodeId: node.id, sid }, '[splunk_search] Search job created, polling...');

  // Poll until dispatchState === DONE or timeout
  const pollInterval = 500; // ms between polls
  const deadline = Date.now() + timeout;
  let jobDone = false;

  while (true) {
    const statusConfig = buildRequestConfig(resolvedToken, allowInsecure, {
      method: 'get',
      url: `${host}/services/search/jobs/${sid}`,
      params: { output_mode: 'json' },
      timeout: 15000,
    });

    const statusResp = await abortableAxios({ signal: ctx.signal }, statusConfig as any);
    const dispatchState: string = (statusResp.data as any)?.entry?.[0]?.content?.dispatchState ?? '';

    ctx.logger.info({ nodeId: node.id, sid, dispatchState }, '[splunk_search] Poll tick');

    if (dispatchState === 'DONE') {
      jobDone = true;
      break;
    }

    if (dispatchState === 'FAILED' || dispatchState === 'FINALIZED') {
      throw new Error(`splunk_search job ${sid} ended with state: ${dispatchState}`);
    }

    if (Date.now() >= deadline) {
      break;
    }

    // Pause before next poll — check signal first
    await new Promise<void>((resolve, reject) => {
      if (ctx.signal.aborted) {
        reject(new Error('Request aborted'));
        return;
      }
      const timer = setTimeout(resolve, pollInterval);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Request aborted'));
      }, { once: true });
    });
  }

  if (!jobDone) {
    throw new Error(
      `splunk_search timed out waiting for job ${sid} to complete (timeout: ${timeout}ms)`,
    );
  }

  // Fetch results
  const resultsConfig = buildRequestConfig(resolvedToken, allowInsecure, {
    method: 'get',
    url: `${host}/services/search/jobs/${sid}/results`,
    params: { output_mode: 'json', count: maxResults },
    timeout: 30000,
  });

  const resultsResp = await abortableAxios({ signal: ctx.signal }, resultsConfig as any);
  const events: unknown[] = (resultsResp.data as any)?.results ?? [];

  ctx.logger.info({ nodeId: node.id, sid, eventCount: events.length }, '[splunk_search] Search complete');

  return {
    jobId: sid,
    events,
    eventCount: events.length,
    earliestTime: resolvedEarliest,
    latestTime: resolvedLatest,
  };
}

/**
 * Splunk alert_ack: acknowledge a notable event via notable_update endpoint.
 */
async function runAlertAck(
  ctx: NodeExecutionContext,
  node: WorkflowNode,
  host: string,
  resolvedToken: string,
  allowInsecure: boolean,
  input: unknown,
): Promise<AlertAckResult> {
  const { notableId, comment, assignee } = node.data as Record<string, any>;

  const resolvedNotableId = ctx.interpolateTemplate(notableId || '', input);
  if (!resolvedNotableId) {
    throw new Error('splunk_search requires a notableId when operation=alert_ack');
  }

  ctx.logger.info(
    { nodeId: node.id, operation: 'alert_ack', notableId: resolvedNotableId },
    '[splunk_search] Acknowledging notable event',
  );

  const payload: Record<string, string> = {
    ruleUIDs: resolvedNotableId,
    status: '4', // 4 = closed/acknowledged in Splunk ES
    newOwner: assignee ? ctx.interpolateTemplate(assignee, input) : '',
    comment: comment ? ctx.interpolateTemplate(comment, input) : '',
  };

  const ackConfig = buildRequestConfig(resolvedToken, allowInsecure, {
    method: 'post',
    url: `${host}/services/notable_update`,
    data: payload,
    timeout: 30000,
  });

  const ackResp = await abortableAxios({ signal: ctx.signal }, ackConfig as any);

  if (ackResp.status === 404) {
    throw new Error(
      `splunk_search alert_ack: notable event not found (HTTP 404) — notableId: ${resolvedNotableId}`,
    );
  }

  if (ackResp.status < 200 || ackResp.status >= 300) {
    throw new Error(
      `splunk_search alert_ack failed (HTTP ${ackResp.status}) for notableId: ${resolvedNotableId}`,
    );
  }

  return {
    ok: true,
    notableId: resolvedNotableId,
  };
}

/**
 * Splunk notable_create: push an event via HEC (HTTP Event Collector).
 * HEC endpoint uses port 8088 by default; we extract the hostname and rebuild.
 */
async function runNotableCreate(
  ctx: NodeExecutionContext,
  node: WorkflowNode,
  host: string,
  resolvedToken: string,
  allowInsecure: boolean,
  input: unknown,
): Promise<NotableCreateResult> {
  const { event, index = 'notable', sourcetype = 'stash' } = node.data as Record<string, any>;

  if (!event) {
    throw new Error('splunk_search requires an event payload when operation=notable_create');
  }

  const resolvedIndex = ctx.interpolateTemplate(String(index), input);
  const resolvedSourcetype = ctx.interpolateTemplate(String(sourcetype), input);

  ctx.logger.info(
    { nodeId: node.id, operation: 'notable_create', index: resolvedIndex },
    '[splunk_search] Pushing event via HEC',
  );

  // Build HEC URL: replace the port with 8088 (or append if no port specified)
  // e.g. https://splunk.example.com:8089 → https://splunk.example.com:8088
  const hecUrl = buildHecUrl(host);

  const hecPayload = {
    event,
    index: resolvedIndex,
    sourcetype: resolvedSourcetype,
  };

  const hecConfig = buildRequestConfig(resolvedToken, allowInsecure, {
    method: 'post',
    url: `${hecUrl}/services/collector/event`,
    data: hecPayload,
    timeout: 30000,
  });

  const hecResp = await abortableAxios({ signal: ctx.signal }, hecConfig as any);

  const respBody = hecResp.data as any;
  // HEC returns 200 even for some failures; check the text field
  if (!respBody?.text || respBody.text.toLowerCase() !== 'success') {
    throw new Error(
      `splunk_search notable_create: HEC returned non-success response: ${respBody?.text ?? 'unknown'} (code: ${respBody?.code ?? '?'})`,
    );
  }

  return {
    ok: true,
    eventId: respBody?.eventId,
  };
}

/**
 * Rebuild the host URL to use port 8088 for HEC.
 * Preserves scheme and hostname; replaces any existing port with 8088.
 */
function buildHecUrl(host: string): string {
  try {
    const parsed = new URL(host);
    parsed.port = '8088';
    return parsed.origin; // scheme + host + port
  } catch {
    // Fallback: naive port replacement
    return host.replace(/:\d+$/, '') + ':8088';
  }
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const { operation, host, token, allowInsecure = false } = node.data as Record<string, any>;

  if (!operation) {
    throw new Error('splunk_search requires an operation (search | alert_ack | notable_create)');
  }

  if (!host) {
    throw new Error('splunk_search requires a host');
  }

  // Resolve templated token (supports {{secret:splunk_token}})
  const resolvedToken = ctx.interpolateTemplate(String(token || ''), input);

  switch (operation) {
    case 'search':
      return runSearch(ctx, node, host, resolvedToken, allowInsecure, input);

    case 'alert_ack':
      return runAlertAck(ctx, node, host, resolvedToken, allowInsecure, input);

    case 'notable_create':
      return runNotableCreate(ctx, node, host, resolvedToken, allowInsecure, input);

    default:
      throw new Error(
        `splunk_search: unknown operation "${operation}". Must be one of: search, alert_ack, notable_create`,
      );
  }
}
