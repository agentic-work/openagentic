/**
 * grounding_check node executor.
 *
 * Deterministic, programmatic fact-check: extracts entity tokens from the
 * `claim` text and intersects them with tokens present in `groundTruth`.
 * Tokens that appear in claim but NOT in ground truth are flagged as
 * `unfoundedEntities` — the human-readable smoking gun for "the model
 * invented a Redis crash that didn't happen" failures on weak models.
 *
 * Entity tokens captured:
 *   - K8s pod / deployment names: `openagentic-mcp-proxy`,
 *     `redis-master-0`, `openagentic-api-6c8cddf76c-ckswm`, etc.
 *     Detected via `^[a-z][a-z0-9-]{6,}` shape with at least one hyphen.
 *   - Component names from a curated list (Redis, Prometheus, Loki,
 *     MCP, Postgres, Ollama, MinIO, etc.) — case-insensitive.
 *   - IPv4 addresses (10.42.5.34, etc.) — common in stale-target reports.
 *
 * Stopwords (severity labels, k8s-generic terms like "namespace",
 * "agentic-dev", "pod") are stripped so they never get flagged.
 */

import type { WorkflowNode } from '../types.js';
import type { NodeExecutionContext } from '../types.js';

const STOPWORDS = new Set([
  // Generic
  'true', 'false', 'null', 'none',
  // Severity / labels
  'p0', 'p1', 'p2', 'p3', 'critical', 'high', 'medium', 'low', 'info', 'warning', 'error',
  // K8s vocabulary that's not an entity claim
  'pod', 'pods', 'node', 'nodes', 'namespace', 'namespaces',
  'container', 'containers', 'service', 'services', 'deployment', 'deployments',
  'replica', 'replicas', 'cluster', 'metric', 'metrics', 'target', 'targets',
  'unhealthy', 'healthy', 'running', 'failed', 'pending', 'unknown',
  'crashloopbackoff', 'imagepullbackoff', 'errimagepull', 'backoff',
  // Workflow-output structural words
  'summary', 'finding', 'findings', 'recommendation', 'recommendations',
  'rationale', 'severity', 'analysis', 'proposed',
  // Common dev-env names that are background fixtures
  'agentic-dev',
]);

// Sorted length-descending so the regex alternation matches the LONGEST
// known component first ('openagentic-mcp-proxy' before 'openagentic-mcp'
// before 'openagentic'). Without this, the literal `openagentic-api` in
// claim text gets greedy-matched as `openagentic` and `-api` is left as
// an unrecognized fragment.
const COMPONENT_DICTIONARY = [
  'redis', 'prometheus', 'loki', 'grafana', 'mcp-proxy',
  'postgres', 'postgresql', 'ollama', 'minio', 'milvus', 'etcd',
  'nginx', 'haproxy', 'kubelet', 'kube-dns', 'coredns',
  'redis_exporter', 'redis-exporter', 'postgres_exporter', 'postgres-exporter',
  'nginx-exporter', 'nginx_exporter', 'minio-exporter',
  'oap-aws-mcp', 'oap-azure-mcp', 'oap-admin-mcp', 'oap-gcp-mcp',
  'openagentic', 'openagentic-api', 'openagentic-ui', 'openagentic-mcp-proxy',
  'openagentic-openagentic-proxy', 'openagentic-workflows', 'openagentic-searxng',
  'oap-openagentic-aws-mcp', 'oap-openagentic-azure-mcp', 'oap-openagentic-admin-mcp',
  'oap-openagentic-gcp-mcp',
  'usermin-minio', 'milvus-etcd', 'milvus-standalone', 'milvus-minio',
  'admin', 'admin-dashboard',
].sort((a, b) => b.length - a.length);

const POD_LIKE_REGEX = /\b([a-z][a-z0-9]+(?:-[a-z0-9]+){2,})\b/g;
const IP_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
// FQDN / hostname pattern: at least one dot, alphanumeric segments. Captures
// `admin.openagentic.io`, `redis.example.com`, etc.
const HOSTNAME_REGEX = /\b([a-z][a-z0-9-]*\.(?:[a-z0-9-]+\.)+[a-z]{2,})\b/g;
const COMPONENT_REGEX = new RegExp(
  `\\b(${COMPONENT_DICTIONARY.map((c) => c.replace(/[.\\+*?^$()[\]{}|]/g, '\\$&')).join('|')})\\b`,
  'gi',
);

/**
 * Extract every entity-like token from text. Case-insensitive matches
 * normalize to lowercase. Stopwords are stripped.
 */
function extractEntities(text: string): Set<string> {
  const out = new Set<string>();
  const lower = text.toLowerCase();

  // Known component names FIRST (longest-match-wins via length-sorted dict).
  // Doing components first ensures `openagentic-api` is captured as a unit
  // before the pod-like regex tries to chunk it up.
  for (const m of lower.matchAll(COMPONENT_REGEX)) {
    out.add(m[0]);
  }
  // Pod/deployment names (shapes like foo-bar-baz, foo-bar-baz-12abc)
  for (const m of lower.matchAll(POD_LIKE_REGEX)) {
    const t = m[1];
    if (!STOPWORDS.has(t)) out.add(t);
  }
  // FQDNs / hostnames
  for (const m of lower.matchAll(HOSTNAME_REGEX)) {
    out.add(m[1]);
  }
  // IPv4 addresses
  for (const m of text.matchAll(IP_REGEX)) {
    out.add(m[0]);
  }

  return out;
}

/**
 * A claim token is "grounded" if either:
 *   - It's an exact match in the ground-truth entity set, OR
 *   - It's a prefix of any ground-truth token (e.g. claim mentions
 *     `openagentic-api` and ground truth has the full `openagentic-api-6c8cddf76c-ckswm`).
 */
function isGrounded(claimToken: string, truthSet: Set<string>): boolean {
  if (truthSet.has(claimToken)) return true;
  for (const t of truthSet) {
    if (t.startsWith(claimToken) || claimToken.startsWith(t)) return true;
  }
  return false;
}

export async function execute(
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const data = (node.data || {}) as Record<string, any>;

  const claimRaw = data.claim;
  const truthRaw = data.groundTruth;
  const strictMode = Boolean(data.strictMode);
  const allowedTokens = Array.isArray(data.allowedTokens)
    ? new Set((data.allowedTokens as unknown[]).map((t) => String(t).toLowerCase()))
    : new Set<string>();

  if (!claimRaw) {
    throw new Error('grounding_check requires `claim` (string or object).');
  }
  if (!truthRaw) {
    throw new Error('grounding_check requires `groundTruth` (string).');
  }

  const claimText =
    typeof claimRaw === 'string'
      ? ctx.interpolateTemplate(claimRaw, input)
      : JSON.stringify(claimRaw);
  const truthText = ctx.interpolateTemplate(String(truthRaw), input);

  const claimEntities = extractEntities(claimText);
  const truthEntities = extractEntities(truthText);

  const grounded: string[] = [];
  const unfounded: string[] = [];
  for (const c of claimEntities) {
    if (allowedTokens.has(c)) {
      grounded.push(c);
      continue;
    }
    if (isGrounded(c, truthEntities)) grounded.push(c);
    else unfounded.push(c);
  }

  const totalScored = grounded.length + unfounded.length;
  const score = totalScored === 0 ? 1 : grounded.length / totalScored;
  const valid = unfounded.length === 0;

  const violationSummary = valid
    ? `All ${grounded.length} entity references are grounded.`
    : `${unfounded.length} unfounded entity reference(s) in claim: ${unfounded.slice(0, 10).join(', ')}${unfounded.length > 10 ? ', …' : ''}`;

  ctx.logger.info(
    {
      nodeId: node.id,
      claimEntityCount: claimEntities.size,
      truthEntityCount: truthEntities.size,
      grounded: grounded.length,
      unfounded: unfounded.length,
      score: Number(score.toFixed(3)),
      strictMode,
    },
    '[grounding_check] Evaluated',
  );

  if (strictMode && !valid) {
    throw new Error(
      `grounding_check (strict): ${violationSummary}. Disable strict mode to receive the report with warnings instead of failing the workflow.`,
    );
  }

  return {
    valid,
    score: Number(score.toFixed(3)),
    groundedEntities: grounded.sort(),
    unfoundedEntities: unfounded.sort(),
    claim: claimText.slice(0, 500),
    violationSummary,
  };
}
