import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as k8s from '@kubernetes/client-node';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../../utils/logger.js';
import { featureFlags } from '../../config/featureFlags.js';

const NAMESPACE = featureFlags.k8sNamespace;

// ── version.json discovery (same fallback chain as version.ts) ──────────────
function loadReleaseInfo(): { version: string; codename: string; releaseDate?: string } {
  const candidates = [
    join(process.cwd(), 'version.json'),
    join(process.cwd(), '..', '..', 'version.json'),
    '/app/version.json',
    '/repo/version.json',
  ];
  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        const raw = JSON.parse(readFileSync(path, 'utf-8'));
        return {
          version: raw.version || process.env.PLATFORM_VERSION || '0.0.0',
          codename: raw.codename || process.env.PLATFORM_CODENAME || '',
          releaseDate: raw.releaseDate,
        };
      }
    } catch { /* try next */ }
  }
  return {
    version: process.env.PLATFORM_VERSION || '0.0.0',
    codename: process.env.PLATFORM_CODENAME || '',
  };
}

// ── k8s client (in-cluster auth via the openagentic ServiceAccount) ─────────
function getApis(): { core: k8s.CoreV1Api; apps: k8s.AppsV1Api } | null {
  try {
    const kc = new k8s.KubeConfig();
    kc.loadFromCluster();
    return {
      core: kc.makeApiClient(k8s.CoreV1Api),
      apps: kc.makeApiClient(k8s.AppsV1Api),
    };
  } catch (err) {
    loggers.routes.error({ err }, 'cluster.services: failed to load in-cluster kubeconfig');
    return null;
  }
}

interface ServiceRow {
  name: string;
  displayName: string;
  kind: 'Deployment' | 'StatefulSet';
  image: string;
  imageDigest: string | null;
  tag: string;
  shaShort: string | null;
  replicas: { desired: number; ready: number; available: number };
  status: 'available' | 'progressing' | 'unavailable' | 'unknown';
  lastTransitionTime: string | null;
  labels: Record<string, string>;
  category: 'core' | 'data' | 'mcp' | 'agent' | 'codemode' | 'auxiliary';
  edges: string[]; // outbound dependencies (other service names this one calls)
}

const DISPLAY_NAMES: Record<string, string> = {
  'openagentic-api': 'API',
  'openagentic-ui': 'UI',
  'openagentic-mcp-proxy': 'MCP Proxy',
  'openagentic-code-manager': 'Code Manager',
  'openagentic-openagentic-proxy': 'Agent Proxy',
  'openagentic-workflows': 'Workflows',
  'openagentic-synth-executor': 'Synth Executor',
  'oap-openagentic-admin-mcp': 'OpenAgentic Admin MCP',
  'oap-openagentic-azure-mcp': 'Azure MCP',
  'oap-openagentic-aws-mcp': 'AWS MCP',
  'oap-openagentic-gcp-mcp': 'GCP MCP',
  'milvus': 'Milvus (Vector DB)',
  'pgvector-postgresql-primary': 'Postgres (pgvector)',
  'redis': 'Redis',
  'openagentic-minio': 'MinIO',
};

function classify(name: string): ServiceRow['category'] {
  if (/^openagentic-(api|ui)$/.test(name)) return 'core';
  if (/^openagentic-(mcp-proxy|openagentic-)/.test(name)) return 'mcp';
  if (/^openagentic-(openagentic-proxy|workflows)$/.test(name)) return 'agent';
  if (/^openagentic-(code-manager|synth-executor)/.test(name)) return 'codemode';
  if (/^(milvus|pgvector|redis|.*minio)/.test(name)) return 'data';
  return 'auxiliary';
}

// Edge targets are matched fuzzily (substring) against actual deployment / statefulset
// names so chart variants (e.g. milvus-standalone vs milvus, redis-node vs redis,
// usermin-minio vs minio) all link up cleanly without per-env hardcoding.
const STATIC_EDGES: Record<string, string[]> = {
  'openagentic-ui': ['openagentic-api'],
  'openagentic-api': ['pgvector-postgresql-primary', 'redis', 'milvus-standalone', 'openagentic-mcp-proxy', 'openagentic-openagentic-proxy', 'openagentic-code-manager', 'openagentic-workflows', 'openagentic-synth-executor', 'usermin-minio'],
  'openagentic-code-manager': ['pgvector-postgresql-primary', 'usermin-minio'],
  'openagentic-openagentic-proxy': ['openagentic-mcp-proxy'],
  'openagentic-mcp-proxy': ['oap-openagentic-admin-mcp', 'oap-openagentic-azure-mcp', 'oap-openagentic-aws-mcp'],
  'openagentic-workflows': ['pgvector-postgresql-primary', 'openagentic-mcp-proxy'],
  'openagentic-synth-executor': ['openagentic-api'],
  'milvus-standalone': ['milvus-etcd', 'milvus-minio'],
};

function resolveEdge(targetHint: string, allNames: Set<string>): string | null {
  if (allNames.has(targetHint)) return targetHint;
  // substring fallback (case-insensitive)
  const hint = targetHint.toLowerCase();
  for (const n of allNames) {
    if (n.toLowerCase().includes(hint) || hint.includes(n.toLowerCase())) return n;
  }
  return null;
}

function shaShortOf(imageID: string | undefined): string | null {
  if (!imageID) return null;
  const m = /sha256:([0-9a-f]{8})/.exec(imageID);
  return m ? m[1] : null;
}

function digestOf(imageID: string | undefined): string | null {
  if (!imageID) return null;
  const m = /(sha256:[0-9a-f]{64})/.exec(imageID);
  return m ? m[1] : null;
}

function tagOf(image: string): string {
  const after = image.split('/').pop() || image;
  const colon = after.lastIndexOf(':');
  return colon === -1 ? 'latest' : after.slice(colon + 1);
}

export async function clusterServicesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const apis = getApis();
  const release = loadReleaseInfo();
  if (!apis) {
    reply.status(503).send({
      error: 'k8s_unavailable',
      message: 'Could not load in-cluster kubeconfig — endpoint requires running inside the cluster.',
      release,
      namespace: NAMESPACE,
    });
    return;
  }

  try {
    const [deployments, statefulSets, pods] = await Promise.all([
      apis.apps.listNamespacedDeployment({ namespace: NAMESPACE }),
      apis.apps.listNamespacedStatefulSet({ namespace: NAMESPACE }),
      apis.core.listNamespacedPod({ namespace: NAMESPACE }),
    ]);

    // index pod imageIDs by deployment owner-name
    const podImageIdsByOwner = new Map<string, string[]>();
    for (const pod of pods.items ?? []) {
      const ownerName = pod.metadata?.ownerReferences?.[0]?.name;
      // ownerReferences for a Deployment-managed pod points at a ReplicaSet (e.g. openagentic-api-5467f96cf4)
      // Strip the trailing -<hash> to get the deployment name.
      const deploymentName = ownerName?.replace(/-[a-f0-9]{8,10}$/, '');
      if (!deploymentName) continue;
      const ids = (pod.status?.containerStatuses ?? [])
        .map(c => c.imageID)
        .filter((x): x is string => !!x);
      const existing = podImageIdsByOwner.get(deploymentName) ?? [];
      podImageIdsByOwner.set(deploymentName, existing.concat(ids));
    }

    const rows: ServiceRow[] = [];
    const collect = (kind: 'Deployment' | 'StatefulSet', items: any[]) => {
      for (const item of items ?? []) {
        const name = item.metadata?.name;
        if (!name) continue;
        const container = item.spec?.template?.spec?.containers?.[0];
        if (!container) continue;
        const podImageId = podImageIdsByOwner.get(name)?.[0];
        const digest = digestOf(podImageId);
        const condition = item.status?.conditions?.find((c: any) => c.type === 'Available' || c.type === 'Ready');
        rows.push({
          name,
          displayName: DISPLAY_NAMES[name] ?? name.replace(/^openagentic-/, ''),
          kind,
          image: container.image ?? '<unknown>',
          imageDigest: digest,
          tag: tagOf(container.image ?? ''),
          shaShort: shaShortOf(podImageId),
          replicas: {
            desired: item.spec?.replicas ?? 0,
            ready: item.status?.readyReplicas ?? 0,
            available: item.status?.availableReplicas ?? 0,
          },
          status:
            condition?.status === 'True' ? 'available' :
            condition?.type === 'Progressing' ? 'progressing' :
            condition?.status === 'False' ? 'unavailable' : 'unknown',
          lastTransitionTime: condition?.lastTransitionTime ?? null,
          labels: item.metadata?.labels ?? {},
          category: classify(name),
          edges: [], // resolved below once we know all names
        });
      }
    };
    collect('Deployment', deployments.items ?? []);
    collect('StatefulSet', statefulSets.items ?? []);

    // Resolve edges using fuzzy matching against actual workload names
    const allNames = new Set(rows.map(r => r.name));
    for (const row of rows) {
      const hints = STATIC_EDGES[row.name] ?? [];
      row.edges = hints
        .map(h => resolveEdge(h, allNames))
        .filter((x): x is string => !!x);
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));

    reply.send({
      release,
      namespace: NAMESPACE,
      scrapedAt: new Date().toISOString(),
      services: rows,
    });
  } catch (err: any) {
    const status = err?.statusCode ?? err?.code ?? 500;
    loggers.routes.error({ err, status }, 'cluster.services: k8s API error');
    reply.status(status === 403 ? 403 : 500).send({
      error: status === 403 ? 'rbac_denied' : 'k8s_error',
      message: status === 403
        ? 'API ServiceAccount lacks pods/deployments list — check openagentic-api-network-admin Role.'
        : (err?.message ?? 'unknown error contacting kube-apiserver'),
      release,
      namespace: NAMESPACE,
    });
  }
}
