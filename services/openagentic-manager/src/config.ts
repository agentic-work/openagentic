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
 * Configuration for OpenAgenticCode Manager
 * Process-based session management (not container-per-user)
 *
 * SECURITY: This service should ONLY be accessible from the OpenAgentic API.
 * External access is blocked - API proxies all requests with internal auth key.
 *
 * STORAGE: Cloud storage (MinIO/S3/Azure/GCS) is PRIMARY storage for workspaces.
 * Local filesystem is only a working cache.
 */

export type StorageProvider = 'minio' | 's3' | 'azure' | 'gcs';

export interface StorageConfig {
  provider: StorageProvider;
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  // Azure
  azureAccountName?: string;
  azureAccountKey?: string;
  azureConnectionString?: string;
  // GCP
  gcpProjectId?: string;
  gcpKeyFile?: string;
}

export type ExecutionMode = 'local' | 'exec-container' | 'kubernetes';

export interface ExecContainerConfig {
  url: string;                        // URL of the exec container (e.g., http://openagentic-exec:3060)
  internalKey?: string;               // Internal API key for exec container (defaults to internalApiKey)
}

export interface WarmPoolConfig {
  enabled: boolean;                   // Enable warm pool for instant container availability
  minReady: number;                   // Minimum warm containers to maintain
  maxReady: number;                   // Maximum warm containers to maintain
  idleTimeout: number;                // Seconds before idle warm container is recycled
}

export interface K8sConfig {
  namespace: string;                  // Kubernetes namespace (from downward API)
  runnerImage: string;                // Image for runner pods (e.g., us-east4-docker.pkg.dev/openagentic-dev/openagentic/openagentic-exec:latest)
  imagePullSecrets?: string[];        // Image pull secrets for runner pods
  nodeSelector?: Record<string, string>;  // Node selector for runner pods
  tolerations?: Array<{               // Tolerations for runner pods
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
  }>;
  runnerResources?: {                 // Resource limits for runner pods
    requests?: { cpu?: string; memory?: string };
    limits?: { cpu?: string; memory?: string };
  };
  podReadyTimeout?: number;           // Timeout waiting for pod to be ready (ms)
  warmPool?: WarmPoolConfig;          // Warm pool configuration
  runnerServiceAccount?: string;      // ServiceAccount for runner pods (security isolation)
}

export interface RedisConfig {
  url?: string;                       // Redis URL for session store (enables HA mode)
  keyPrefix: string;                  // Key prefix for session data
  sessionTTL: number;                 // TTL for session keys in seconds
}

export interface Config {
  port: number;
  openagenticPath: string;             // Path to openagentic CLI binary
  maxSessionsPerUser: number;
  maxGlobalSessions: number;          // Maximum total active sessions across all users
  sessionIdleTimeout: number;         // seconds
  sessionMaxLifetime: number;         // seconds
  maxWorkspaceSizeMb: number;         // Max workspace size per user in MB (default: 5120 = 5GB)
  workspacesPath: string;             // Base path for LOCAL workspace cache
  // LLM PROVIDER: MUST come from OpenAgentic API - NO hardcoded providers allowed
  // The CLI uses LLM_PROVIDER=api and calls back to openagentic-api for all LLM requests
  openagenticApiEndpoint: string;     // OpenAgentic API endpoint for LLM proxy
  defaultModel: string;               // Default model identifier (resolved by API)
  defaultUi: string;                  // Default UI mode (ink, plain, json)
  defaultCliBackend?: string;         // Default CLI backend (http, proxy)
  internalApiKey: string;             // SECURITY: Internal key for API authentication
  storage: StorageConfig;             // Cloud storage configuration (PRIMARY storage)
  redis: RedisConfig;                 // Redis configuration for session state (HA)
  // Execution mode configuration
  executionMode: ExecutionMode;       // How sessions are executed: local, exec-container, kubernetes
  execContainer: ExecContainerConfig; // Config for exec-container mode
  k8s: K8sConfig;                     // Config for kubernetes mode
}

/**
 * Get storage configuration from environment variables
 */
function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || 'minio') as StorageProvider;

  // Build endpoint URL
  let endpoint = process.env.STORAGE_ENDPOINT || process.env.MINIO_ENDPOINT || 'minio:9000';
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    endpoint = `http://${endpoint}`;
  }

  return {
    provider,
    bucket: process.env.STORAGE_BUCKET || process.env.MINIO_BUCKET || 'openagentic-workspaces',
    endpoint,
    region: process.env.STORAGE_REGION || process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.STORAGE_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.STORAGE_SECRET_KEY || process.env.MINIO_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
    // Azure
    azureAccountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
    azureAccountKey: process.env.AZURE_STORAGE_ACCOUNT_KEY,
    azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    // GCP
    gcpProjectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    gcpKeyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3050'),
  openagenticPath: process.env.OPENAGENTIC_PATH || '/usr/local/bin/openagentic',
  maxSessionsPerUser: parseInt(process.env.MAX_SESSIONS_PER_USER || '3'),
  maxGlobalSessions: parseInt(process.env.MAX_GLOBAL_SESSIONS || '100'),         // 100 concurrent sessions
  sessionIdleTimeout: parseInt(process.env.SESSION_IDLE_TIMEOUT || '1800'),      // 30 min
  sessionMaxLifetime: parseInt(process.env.SESSION_MAX_LIFETIME || '14400'),     // 4 hours
  maxWorkspaceSizeMb: parseInt(process.env.MAX_WORKSPACE_SIZE_MB || '5120'),     // 5GB default
  workspacesPath: process.env.WORKSPACES_PATH || '/workspaces',  // LOCAL cache path
  // LLM PROVIDER: MUST come from OpenAgentic API - NO hardcoded providers allowed
  // Runner pods use LLM_PROVIDER=api and call openagentic-api for all LLM requests
  openagenticApiEndpoint: process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000',
  // Default model — empty string means "let the API smart router decide"
  // NEVER hardcode a model here. The API endpoint resolves: Redis override → admin DB → platform default
  defaultModel: process.env.OPENAGENTIC_MODEL || process.env.DEFAULT_MODEL || '',
  defaultUi: process.env.OPENAGENTIC_UI || 'ink',  // Ink UI provides modern terminal experience via PTY
  defaultCliBackend: process.env.OPENAGENTIC_CLI_BACKEND || 'http',  // CLI backend: http or proxy
  // SECURITY: Internal API key must match CODE_MANAGER_INTERNAL_KEY from OpenAgentic API
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  // Cloud storage configuration - PRIMARY storage for workspaces
  storage: getStorageConfig(),
  // Redis configuration for session state (enables HA mode)
  redis: {
    url: process.env.REDIS_URL,                                              // Redis URL (e.g., redis://redis:6379)
    keyPrefix: process.env.REDIS_SESSION_PREFIX || 'openagentic:session:',    // Key prefix
    sessionTTL: parseInt(process.env.REDIS_SESSION_TTL || '86400'),          // 24 hours default
  },
  // Execution mode: 'local' (default), 'exec-container', or 'kubernetes'
  executionMode: (process.env.EXECUTION_MODE || 'local') as ExecutionMode,
  // Exec container configuration (used when executionMode === 'exec-container')
  execContainer: {
    url: process.env.EXEC_CONTAINER_URL || 'http://openagentic-exec:3060',
    internalKey: process.env.EXEC_CONTAINER_INTERNAL_KEY || process.env.INTERNAL_API_KEY || '',
  },
  // Kubernetes configuration (used when executionMode === 'kubernetes')
  k8s: {
    namespace: process.env.K8S_NAMESPACE || 'default',
    runnerImage: process.env.RUNNER_IMAGE || 'openagentic-exec:latest',
    imagePullSecrets: process.env.K8S_IMAGE_PULL_SECRETS?.split(',').filter(Boolean),
    nodeSelector: process.env.K8S_NODE_SELECTOR ? JSON.parse(process.env.K8S_NODE_SELECTOR) : undefined,
    tolerations: process.env.K8S_TOLERATIONS ? JSON.parse(process.env.K8S_TOLERATIONS) : undefined,
    // Runner resource defaults. REQUESTS only — NO limits.
    //
    // Rationale: on 2026-04-08 pod openagentic-2cb1bf3f719f was
    // OOMKilled after 72 minutes because a listener leak in the
    // PTY/WS handler (fixed separately in openagentic-exec/src/
    // index.ts) ran the process heap past the 2Gi limit. The
    // listener leak was the root cause, but the hard ceiling meant
    // even a moderately leaky session got SIGKILL instead of just
    // degrading. For interactive coding sessions with xterm buffer
    // + node heap + code-server + FUSE + ghostpilot, a fixed cap
    // makes the failure mode "kernel kill" instead of "temporary
    // slowness" — which is strictly worse UX.
    //
    // Burstable pods (requests without limits) use as much node
    // RAM as is available; the kernel OOM killer still engages if
    // the NODE itself runs out, which is the correct scope for a
    // shared-infrastructure cluster. Operators who need hard
    // per-session caps can re-enable via the K8S_RUNNER_RESOURCES
    // env var (full JSON object with both requests + limits).
    runnerResources: process.env.K8S_RUNNER_RESOURCES ? JSON.parse(process.env.K8S_RUNNER_RESOURCES) : {
      requests: { cpu: '200m', memory: '512Mi' },
    },
    // 180s default — see k8sSessionManager.waitForPodReady() comment
    // for the rationale (cold-boot s3fs + sandbox + code-server can
    // exceed 60s on slow storage backends). Operators can override
    // via K8S_POD_READY_TIMEOUT env var if their infra is faster.
    podReadyTimeout: parseInt(process.env.K8S_POD_READY_TIMEOUT || '180000'),
    // Warm pool - pre-spawn containers for instant code mode availability
    warmPool: {
      enabled: process.env.WARM_POOL_ENABLED === 'true',
      minReady: parseInt(process.env.WARM_POOL_MIN_READY || '1'),
      maxReady: parseInt(process.env.WARM_POOL_MAX_READY || '3'),
      idleTimeout: parseInt(process.env.WARM_POOL_IDLE_TIMEOUT || '300'),
    },
    // Restricted ServiceAccount used when spawning runner pods. Chart
    // templates the SA as `<release>-runner-restricted`, passed via
    // K8S_RUNNER_SERVICE_ACCOUNT (see k8sSessionManager.ts — throws if
    // this is unset rather than guessing a wrong SA name).
    runnerServiceAccount: process.env.K8S_RUNNER_SERVICE_ACCOUNT,
  },
};
