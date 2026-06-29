/**
 * portalLink — derive a resource identifier + clickable portal URL from
 * a tool-call name + its args. Used by the chat tool-card header to
 * show "what specifically did the model just touch?" inline and give
 * the user a one-click jump into the provider portal/console.
 *
 * BLOCKER-002 (UC-A14 manual QA): the old card just showed the tool's
 * display name with no resource identity. A delete modal for "Resource
 * Group" was ambiguous — you couldn't tell what would be nuked without
 * expanding the JSON. This utility fixes that by surfacing name + link.
 */

export type ResourceLink = {
  /** The identifier we found (resource name, ARN, instance ID, bucket name, …). */
  identifier: string;
  /** Clickable URL to the provider portal. Null when we can't derive one safely. */
  href: string | null;
  /** Short label for the cloud — displayed in badges. */
  provider: 'azure' | 'aws' | 'gcp' | 'k8s' | 'web' | 'synth' | 'other';
  /** For web tools: the origin domain so we can load its favicon. */
  faviconDomain?: string;
};

/**
 * Args keys that commonly carry a resource identifier, in rough
 * priority order — first match wins.
 */
const ID_KEYS = [
  'name', 'resource_id', 'resourceId', 'id', 'arn',
  'cluster_name', 'clusterName', 'instance_id', 'instanceId',
  'bucket', 'bucket_name', 'bucketName',
  'table', 'table_name', 'tableName',
  'vault', 'vault_name', 'vaultName',
  'workspace', 'workspace_name', 'workspaceName',
  'function_name', 'functionName',
  'project', 'project_id', 'projectId',
  'subscription', 'subscription_id', 'subscriptionId',
  'pod', 'pod_name', 'podName',
  'namespace',
  'account', 'account_id',
  'secret', 'secret_name', 'secretName',
  'role', 'role_name', 'roleName',
  'group', 'group_name', 'groupName',
  'user', 'user_name', 'userName',
  'repo', 'repository',
] as const;

const AZURE_PORTAL = 'https://portal.azure.com';
const AWS_CONSOLE = 'https://console.aws.amazon.com';
const GCP_CONSOLE = 'https://console.cloud.google.com';

/**
 * Pull the first non-empty string value from `args` whose key matches
 * one of ID_KEYS. Arrays/nested objects are ignored for safety — we
 * only surface simple scalar identifiers. Returns null when nothing
 * matches.
 */
function extractIdentifier(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  for (const key of ID_KEYS) {
    const v = record[key];
    if (typeof v === 'string' && v.trim().length > 0 && v.length < 200) {
      return v;
    }
  }
  return null;
}

/**
 * Pull a URL-looking value from generic web-fetch args. Checks `url`,
 * `uri`, `href`, then falls back to any string value that looks like
 * an http(s) URL.
 */
function extractUrl(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  for (const key of ['url', 'uri', 'href', 'endpoint']) {
    const v = record[key];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  for (const v of Object.values(record)) {
    if (typeof v === 'string' && /^https?:\/\/[^\s]{4,400}$/i.test(v)) return v;
  }
  return null;
}

/**
 * Main entry point. Given a raw tool name + args object, return the
 * resource identifier and a portal URL when we can derive one.
 * Callers should defensively handle `null` returns and
 * `href === null` (we show the name without a link in that case).
 */
export function deriveResourceLink(toolName: string, args: unknown): ResourceLink | null {
  if (!toolName || typeof toolName !== 'string') return null;
  const name = toolName.toLowerCase();

  // ----- Web MCP tools -----
  if (
    /^(?:web_|fetch|browse|http_|url_|search_web|open_url|web_search)/i.test(name) ||
    name === 'fetch' || name === 'browse' || name === 'open_url'
  ) {
    const url = extractUrl(args);
    if (!url) return null;
    let faviconDomain: string | undefined;
    try {
      faviconDomain = new URL(url).hostname;
    } catch {
      faviconDomain = undefined;
    }
    return { identifier: url, href: url, provider: 'web', faviconDomain };
  }

  const identifier = extractIdentifier(args);
  if (!identifier) return null;

  // ----- Azure tools -----
  if (name.startsWith('azure_') || name === 'call_azure') {
    // Resource-group-level ops (create/update/delete/list members/etc)
    if (/(^azure_)?(?:create|update|delete|list|show|get)_resource_group/.test(name) ||
        name === 'azure_delete_resource_group' ||
        name === 'azure_create_resource_group') {
      const sub = pickArg(args, ['subscription', 'subscription_id', 'subscriptionId']);
      const href = sub
        ? `${AZURE_PORTAL}/#@/resource/subscriptions/${encodeURIComponent(sub)}/resourceGroups/${encodeURIComponent(identifier)}/overview`
        : `${AZURE_PORTAL}/#blade/HubsExtension/BrowseResourceGroups`;
      return { identifier, href, provider: 'azure' };
    }
    // Subscriptions
    if (/subscription/.test(name)) {
      return {
        identifier,
        href: `${AZURE_PORTAL}/#@/resource/subscriptions/${encodeURIComponent(identifier)}/overview`,
        provider: 'azure',
      };
    }
    // AKS
    if (/aks|kubernetes/.test(name)) {
      return {
        identifier,
        href: `${AZURE_PORTAL}/#blade/Microsoft_Azure_ContainerService/ManagedClustersViewer`,
        provider: 'azure',
      };
    }
    // Storage accounts
    if (/storage/.test(name)) {
      return {
        identifier,
        href: `${AZURE_PORTAL}/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.Storage%2FstorageAccounts`,
        provider: 'azure',
      };
    }
    // Generic Azure fallback — portal home with the name shown, no deep URL.
    return { identifier, href: `${AZURE_PORTAL}/`, provider: 'azure' };
  }

  // ----- AWS tools -----
  if (name.startsWith('aws_') || name === 'call_aws' || name === 'suggest_aws_commands') {
    const region = pickArg(args, ['region']) ?? 'us-east-1';
    if (/ec2|instance/.test(name)) {
      return {
        identifier,
        href: `${AWS_CONSOLE}/ec2/home?region=${encodeURIComponent(region)}#Instances:search=${encodeURIComponent(identifier)}`,
        provider: 'aws',
      };
    }
    if (/s3|bucket/.test(name)) {
      return {
        identifier,
        href: `${AWS_CONSOLE}/s3/buckets/${encodeURIComponent(identifier)}`,
        provider: 'aws',
      };
    }
    if (/lambda|function/.test(name)) {
      return {
        identifier,
        href: `${AWS_CONSOLE}/lambda/home?region=${encodeURIComponent(region)}#/functions/${encodeURIComponent(identifier)}`,
        provider: 'aws',
      };
    }
    if (/bedrock|foundation/.test(name)) {
      return {
        identifier,
        href: `${AWS_CONSOLE}/bedrock/home?region=${encodeURIComponent(region)}#/foundation-models`,
        provider: 'aws',
      };
    }
    if (/iam|role|user|policy/.test(name)) {
      return {
        identifier,
        href: `${AWS_CONSOLE}/iam/home?region=${encodeURIComponent(region)}#/home`,
        provider: 'aws',
      };
    }
    return { identifier, href: `${AWS_CONSOLE}/console/home?region=${encodeURIComponent(region)}`, provider: 'aws' };
  }

  // ----- GCP tools -----
  if (name.startsWith('gcp_') || name === 'call_gcp') {
    const project = pickArg(args, ['project', 'project_id', 'projectId']);
    const q = project ? `?project=${encodeURIComponent(project)}` : '';
    if (/gke|kubernetes|cluster/.test(name)) {
      return { identifier, href: `${GCP_CONSOLE}/kubernetes/list/overview${q}`, provider: 'gcp' };
    }
    if (/storage|bucket/.test(name)) {
      return { identifier, href: `${GCP_CONSOLE}/storage/browser/${encodeURIComponent(identifier)}${q}`, provider: 'gcp' };
    }
    if (/compute|instance|vm/.test(name)) {
      return { identifier, href: `${GCP_CONSOLE}/compute/instances${q}`, provider: 'gcp' };
    }
    if (/bigquery|bq/.test(name)) {
      return { identifier, href: `${GCP_CONSOLE}/bigquery${q}`, provider: 'gcp' };
    }
    return { identifier, href: `${GCP_CONSOLE}/welcome${q}`, provider: 'gcp' };
  }

  // ----- Kubernetes (in-cluster) -----
  if (name.startsWith('k8s_') || name.startsWith('kubectl_')) {
    return { identifier, href: null, provider: 'k8s' };
  }

  // ----- Synth (SaaS caps) -----
  if (name === 'synth_execute' || name === 'synth_synthesize') {
    return { identifier, href: null, provider: 'synth' };
  }

  // Unknown provider — surface the name, skip the link.
  return { identifier, href: null, provider: 'other' };
}

function pickArg(args: unknown, keys: readonly string[]): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  for (const k of keys) {
    const v = record[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
