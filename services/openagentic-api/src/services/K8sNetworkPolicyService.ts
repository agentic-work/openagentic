/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * K8s Network Policy Service
 *
 * Manages NetworkPolicies via the Kubernetes API for the admin console's
 * Network Security panel. Uses in-cluster config when running in K8s,
 * falls back gracefully when not in a cluster.
 */

import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

// Known services with their expected NetworkPolicy names and critical dependencies
const SERVICE_MAP: Record<string, { component: string; displayName: string; critical?: boolean }> = {
  api: { component: 'api', displayName: 'API Server', critical: true },
  ui: { component: 'ui', displayName: 'Frontend (UI)' },
  'mcp-proxy': { component: 'mcp-proxy', displayName: 'MCP Proxy' },
  'code-manager': { component: 'code-manager', displayName: 'Code Manager' },
  'openagentic-proxy': { component: 'openagentic-proxy', displayName: 'Agent Proxy' },
  'openagentic-synth': { component: 'openagentic-synth', displayName: 'OpenAgentic Synth' },
  minio: { component: 'minio', displayName: 'MinIO Storage' },
  attu: { component: 'attu', displayName: 'Attu (Milvus UI)' },
  postgres: { component: 'postgresql', displayName: 'PostgreSQL', critical: true },
  ollama: { component: 'ollama', displayName: 'Ollama' },
};

// Protected connections that should never be blocked
const PROTECTED_CONNECTIONS = [
  { from: 'api', to: 'postgres', reason: 'API requires database access' },
  { from: 'api', to: 'redis', reason: 'API requires cache access' },
  { from: 'ui', to: 'api', reason: 'Frontend must reach API' },
];

let k8sClient: any = null;
let k8sNetworkingApi: any = null;
let k8sCoreApi: any = null;
let k8sAppsApi: any = null;
let k8sInitialized = false;
let k8sError: string | null = null;

async function initK8s(): Promise<boolean> {
  if (k8sInitialized) return k8sClient !== null;

  try {
    const k8s = await import('@kubernetes/client-node');
    const kc = new k8s.KubeConfig();
    kc.loadFromCluster();

    k8sClient = kc;
    k8sNetworkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
    k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);
    k8sAppsApi = kc.makeApiClient(k8s.AppsV1Api);
    k8sInitialized = true;
    logger.info('[K8sNetworkPolicy] Initialized in-cluster K8s client');
    return true;
  } catch (e: any) {
    k8sInitialized = true;
    k8sError = e.message;
    logger.warn({ err: e }, '[K8sNetworkPolicy] Not running in K8s cluster — network admin unavailable');
    return false;
  }
}

function getNamespace(): string {
  return process.env.NAMESPACE || process.env.POD_NAMESPACE || 'agentic-dev';
}

class K8sNetworkPolicyService {

  async isAvailable(): Promise<boolean> {
    return initK8s();
  }

  /**
   * List all NetworkPolicies in namespace
   */
  async listNetworkPolicies(): Promise<any[]> {
    if (!(await initK8s())) return [];
    try {
      const res = await k8sNetworkingApi.listNamespacedNetworkPolicy({ namespace: getNamespace() });
      return (res.items || []).map((np: any) => ({
        name: np.metadata?.name,
        createdAt: np.metadata?.creationTimestamp,
        labels: np.metadata?.labels,
        podSelector: np.spec?.podSelector,
        policyTypes: np.spec?.policyTypes,
        ingressRuleCount: np.spec?.ingress?.length || 0,
        egressRuleCount: np.spec?.egress?.length || 0,
      }));
    } catch (e: any) {
      logger.error({ err: e }, '[K8sNetworkPolicy] Failed to list');
      return [];
    }
  }

  /**
   * Get a specific NetworkPolicy by name
   */
  async getNetworkPolicy(name: string): Promise<any | null> {
    if (!(await initK8s())) return null;
    try {
      const res = await k8sNetworkingApi.readNamespacedNetworkPolicy({ name, namespace: getNamespace() });
      return res;
    } catch (e: any) {
      if (e.statusCode === 404) return null;
      logger.error({ err: e, name }, '[K8sNetworkPolicy] Failed to get');
      return null;
    }
  }

  /**
   * Get status of each known service's NetworkPolicy
   */
  async getServicePolicyStatus(): Promise<any[]> {
    const policies = await this.listNetworkPolicies();
    const policyNames = new Set(policies.map((p: any) => p.name));

    const results = [];
    for (const [svcKey, svc] of Object.entries(SERVICE_MAP)) {
      // NetworkPolicy naming convention from Helm templates
      const expectedName = `openagentic-${svcKey}`;
      const isEnabled = policyNames.has(expectedName);
      const policy = policies.find((p: any) => p.name === expectedName);

      results.push({
        service: svcKey,
        displayName: svc.displayName,
        component: svc.component,
        critical: svc.critical || false,
        policyEnabled: isEnabled,
        policyName: isEnabled ? expectedName : null,
        ingressRules: policy?.ingressRuleCount || 0,
        egressRules: policy?.egressRuleCount || 0,
        createdAt: policy?.createdAt || null,
      });
    }

    return results;
  }

  /**
   * Delete a NetworkPolicy (disable it)
   */
  async disableServicePolicy(policyName: string): Promise<{ success: boolean; error?: string }> {
    if (!(await initK8s())) return { success: false, error: 'K8s not available' };

    // Safety check: don't delete protected policies
    const isProtected = PROTECTED_CONNECTIONS.some(c =>
      policyName.includes(c.from) || policyName.includes(c.to)
    );
    if (isProtected) {
      return { success: false, error: `Cannot disable policy '${policyName}' — it protects critical connections` };
    }

    try {
      await k8sNetworkingApi.deleteNamespacedNetworkPolicy({ name: policyName, namespace: getNamespace() });
      logger.info({ policyName }, '[K8sNetworkPolicy] Policy disabled (deleted)');
      return { success: true };
    } catch (e: any) {
      logger.error({ err: e, policyName }, '[K8sNetworkPolicy] Failed to disable');
      return { success: false, error: e.message };
    }
  }

  /**
   * Validate that a policy change won't break critical paths
   */
  validatePolicyChange(policySpec: any): { safe: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Check if the policy would block critical connections
    for (const conn of PROTECTED_CONNECTIONS) {
      // Very simplified check — in practice you'd evaluate the policy against the connection
      if (!policySpec.spec?.egress || policySpec.spec.egress.length === 0) {
        if (policySpec.spec?.policyTypes?.includes('Egress')) {
          warnings.push(`Policy blocks all egress — would break ${conn.from} → ${conn.to} (${conn.reason})`);
        }
      }
    }

    return { safe: warnings.length === 0, warnings };
  }

  /**
   * List services (pods/deployments) in the namespace
   */
  async listServices(): Promise<any[]> {
    if (!(await initK8s())) return [];
    try {
      const [svcs, deploys] = await Promise.all([
        k8sCoreApi.listNamespacedService({ namespace: getNamespace() }),
        k8sAppsApi.listNamespacedDeployment({ namespace: getNamespace() })
      ]);

      return (svcs.items || []).map((svc: any) => {
        const deploy = (deploys.items || []).find((d: any) =>
          d.metadata?.name === svc.metadata?.name
        );
        return {
          name: svc.metadata?.name,
          type: svc.spec?.type,
          ports: (svc.spec?.ports || []).map((p: any) => ({
            port: p.port,
            targetPort: p.targetPort,
            protocol: p.protocol,
            name: p.name,
          })),
          selector: svc.spec?.selector,
          readyReplicas: deploy?.status?.readyReplicas || 0,
          replicas: deploy?.spec?.replicas || 0,
        };
      });
    } catch (e: any) {
      logger.error({ err: e }, '[K8sNetworkPolicy] Failed to list services');
      return [];
    }
  }

  /**
   * Get protected connections info
   */
  getProtectedConnections() {
    return PROTECTED_CONNECTIONS;
  }

  /**
   * Get initialization error if any
   */
  getError(): string | null {
    return k8sError;
  }
}

export const k8sNetworkPolicyService = new K8sNetworkPolicyService();
export default k8sNetworkPolicyService;
