/**
 * Registry of MCPs the wizard can enable. Drives the MCP-selection step
 * (multi-select) and the per-MCP auth sub-step.
 *
 * Entries must match MCPs the proxy actually knows how to spawn (see
 * services/openagentic-mcp-proxy/src/mcp_manager.py initialize_servers).
 * MCPs the proxy has removed upstream (code, runbook, incident,
 * agent-architect, azure-cost, knowledge, alertmanager) are intentionally
 * absent — azure-cost lives inside the consolidated azure MCP now, and
 * knowledge is replaced by the per-tool _meta cascade. The proxy wires 9
 * first-party built-ins: web, admin, aws, azure, gcp, kubernetes, github,
 * prometheus, loki — this list must stay in lockstep with that set.
 *
 *   id           → wizard key + MCPS_ENABLED token
 *   disabledEnv  → the per-MCP "*_DISABLED" env var the proxy reads.
 *                  Wizard sets this to "true" for any MCP not in the
 *                  enabled list so the proxy skips spawning it.
 *   authType     → drives the sub-step UI:
 *                    'env-file' — file under ~/.openagentic/cloud-secrets/
 *                    'fields'   — inline text inputs for envVars
 *                    'none'     — no prompt
 *   envFile      → filename under cloud-secrets/ (for 'env-file')
 *   envVars      → keys prompted + written to .env (for 'fields', or
 *                  as the inline-paste fallback for 'env-file')
 *   defaultOn    → pre-selected in the multi-select
 */
export type McpAuthType = 'env-file' | 'fields' | 'none';

export interface McpField {
  env: string;
  label: string;
  mask?: boolean;
  hint?: string;
}

/**
 * If a cloud MCP can use the user's host CLI credentials (mounted
 * read-only into mcp-proxy by docker-compose.yml), describe how to detect
 * them. The wizard surfaces "Use my local CLI creds" as the first option
 * whenever `detect()` is truthy — picking it writes nothing to .env and
 * just leaves the MCP enabled.
 */
export interface HostCredsHint {
  description: string;        // shown in the menu, e.g. "az login (~/.azure)"
  detect: () => boolean;      // returns true when host creds appear usable
}

export interface McpDefinition {
  id: string;
  label: string;
  blurb: string;
  disabledEnv: string;
  needsAuth: boolean;
  authType: McpAuthType;
  envFile?: string;
  envVars?: McpField[];
  hostCreds?: HostCredsHint;
  defaultOn: boolean;
}

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const exists = (p: string) => { try { return fs.existsSync(path.join(HOME, p)); } catch { return false; } };

export const MCPS: McpDefinition[] = [
  {
    id: 'web',
    label: 'Web',
    blurb: 'Search + page fetch (DuckDuckGo, no auth).',
    disabledEnv: 'OpenAgentic_WEB_MCP_DISABLED',
    needsAuth: false,
    authType: 'none',
    defaultOn: true,
  },
  {
    id: 'admin',
    label: 'Admin',
    blurb: 'Platform admin helpers — Postgres/Redis/Milvus/health.',
    disabledEnv: 'OpenAgentic_ADMIN_MCP_DISABLED',
    needsAuth: false,
    authType: 'none',
    defaultOn: true,
  },
  {
    id: 'aws',
    label: 'AWS',
    blurb: 'EC2 / S3 / IAM / Cost Explorer — AWS read-only.',
    disabledEnv: 'OpenAgentic_AWS_MCP_DISABLED',
    needsAuth: true,
    authType: 'env-file',
    envFile: 'aws.env',
    envVars: [
      { env: 'AWS_ACCESS_KEY_ID',     label: 'AWS access key id' },
      { env: 'AWS_SECRET_ACCESS_KEY', label: 'AWS secret access key', mask: true },
      { env: 'AWS_REGION',            label: 'AWS default region', hint: 'e.g. us-east-1' },
    ],
    hostCreds: {
      description: 'Use my host AWS CLI creds (~/.aws — mounted read-only)',
      detect: () => exists('.aws/credentials') || exists('.aws/config'),
    },
    defaultOn: true,
  },
  {
    id: 'azure',
    label: 'Azure',
    blurb: 'ARM / Graph / Key Vault / Monitor / Cost — Azure read-only.',
    disabledEnv: 'OpenAgentic_AZURE_MCP_DISABLED',
    needsAuth: true,
    authType: 'env-file',
    envFile: 'azure.env',
    envVars: [
      { env: 'AZURE_TENANT_ID',       label: 'Azure tenant id' },
      { env: 'AZURE_CLIENT_ID',       label: 'Azure client id (App Registration)' },
      { env: 'AZURE_CLIENT_SECRET',   label: 'Azure client secret', mask: true },
      { env: 'AZURE_SUBSCRIPTION_ID', label: 'Default subscription id' },
    ],
    hostCreds: {
      description: 'Use my host Azure CLI creds (~/.azure — mounted read-only)',
      detect: () => exists('.azure/azureProfile.json') || exists('.azure/TokenCache'),
    },
    defaultOn: true,
  },
  {
    id: 'gcp',
    label: 'GCP',
    blurb: 'Projects / Compute / Storage / Logging / Monitoring.',
    disabledEnv: 'OpenAgentic_GCP_MCP_DISABLED',
    needsAuth: true,
    authType: 'env-file',
    envFile: 'gcp.env',
    envVars: [
      { env: 'GCP_PROJECT_ID',       label: 'GCP project id' },
      { env: 'GCP_REGION',           label: 'Default region', hint: 'e.g. us-central1' },
      { env: 'GCP_CREDENTIALS_FILE', label: 'Service-account JSON path', hint: 'inside the mcp-proxy container' },
    ],
    hostCreds: {
      description: 'Use my host gcloud creds (~/.config/gcloud — mounted read-only)',
      detect: () => exists('.config/gcloud/application_default_credentials.json') || exists('.config/gcloud/credentials.db'),
    },
    defaultOn: true,
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    blurb: 'Pods / deployments / logs (your local kubeconfig).',
    disabledEnv: 'OpenAgentic_KUBERNETES_MCP_DISABLED',
    needsAuth: true,
    authType: 'fields',
    envVars: [
      { env: 'KUBECONFIG', label: 'Path to kubeconfig', hint: '~/.kube/config on most machines' },
    ],
    hostCreds: {
      description: 'Use my host kubeconfig (~/.kube/config — mounted read-only)',
      detect: () => exists('.kube/config'),
    },
    defaultOn: true,
  },
  {
    id: 'github',
    label: 'GitHub',
    blurb: 'Repos / issues / PRs via a PAT.',
    disabledEnv: 'OpenAgentic_GITHUB_MCP_DISABLED',
    needsAuth: true,
    authType: 'fields',
    envVars: [
      { env: 'GITHUB_TOKEN', label: 'GitHub personal access token', mask: true },
    ],
    defaultOn: false,
  },
  {
    id: 'prometheus',
    label: 'Prometheus',
    blurb: 'Metric queries against a Prometheus server.',
    disabledEnv: 'OpenAgentic_PROMETHEUS_MCP_DISABLED',
    needsAuth: true,
    authType: 'fields',
    envVars: [
      { env: 'PROMETHEUS_URL',      label: 'Prometheus URL',      hint: 'https://prom.example.com' },
      { env: 'PROMETHEUS_USERNAME', label: 'Basic auth user (optional)' },
      { env: 'PROMETHEUS_PASSWORD', label: 'Basic auth pass (optional)', mask: true },
    ],
    defaultOn: false,
  },
  {
    id: 'loki',
    label: 'Loki',
    blurb: 'Log queries against a Loki instance.',
    disabledEnv: 'OpenAgentic_LOKI_MCP_DISABLED',
    needsAuth: true,
    authType: 'fields',
    envVars: [
      { env: 'LOKI_URL',      label: 'Loki URL',      hint: 'https://loki.example.com' },
      { env: 'LOKI_USERNAME', label: 'Basic auth user (optional)' },
      { env: 'LOKI_PASSWORD', label: 'Basic auth pass (optional)', mask: true },
    ],
    defaultOn: false,
  },
];

/** MCPs that require user input (either picking an env-file or pasting fields). */
export function mcpsThatNeedAuth(enabled: string[]): McpDefinition[] {
  return MCPS.filter((m) => enabled.includes(m.id) && m.needsAuth);
}

/** Default-on set (used when first running the wizard). */
export function defaultEnabledMcps(): string[] {
  return MCPS.filter((m) => m.defaultOn).map((m) => m.id);
}

/** All MCPs (for the multi-select). */
export function allMcpIds(): string[] {
  return MCPS.map((m) => m.id);
}

/** Lookup by id. */
export function mcpById(id: string): McpDefinition | undefined {
  return MCPS.find((m) => m.id === id);
}
