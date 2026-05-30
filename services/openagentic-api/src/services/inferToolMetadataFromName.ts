/**
 * inferToolMetadataFromName — pure helper that infers cascade metadata
 * fields from a tool's NAME using lexical conventions only (no regex,
 * no LLM). Used as a fallback when no hand-curated overlay row exists.
 *
 * Convention (all snake_case, lower):
 *   {provider}_{verb}_{resource}        e.g. azure_list_subscriptions
 *   {provider}_{verb}                   e.g. aws_identity
 *   {namespace}_{verb}_{resource}       e.g. k8s_list_pods
 *   {bare_verb}                         e.g. web_search, tool_search
 *
 * Hand-curated overlay always wins. Inferred fields are marked
 * `inferred: true` so callers can distinguish them.
 *
 * NOTE: This file uses **NO regex** per project rules — plain string
 * ops only (split, startsWith, endsWith, includes).
 */

export type CostClass = 'read' | 'mutating' | 'destructive';
export type CloudProvider = 'azure' | 'aws' | 'gcp' | 'k8s' | 'platform';
export type Verb =
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'terminate'
  | 'destroy'
  | 'query'
  | 'execute'
  | 'search'
  | 'fetch';

export interface InferredToolMetadata {
  cloud_provider: CloudProvider | undefined;
  service: string | undefined;
  verb: Verb | undefined;
  cost_class: CostClass;
  aliases: string[];
  inferred: true;
}

// Provider prefixes — first token determines the cloud_provider.
const PROVIDER_PREFIXES: Record<string, CloudProvider> = {
  azure: 'azure',
  aws: 'aws',
  gcp: 'gcp',
  google: 'gcp',
  k8s: 'k8s',
  kubectl: 'k8s',
  kubernetes: 'k8s',
};

// Platform-bare tool names (no provider prefix).
const PLATFORM_BARE_NAMES = new Set([
  'tool_search',
  'agent_search',
  'agent_list',
  'agent_send',
  'agent_stop',
  'web_search',
  'web_fetch',
  'memorize',
  'memory_search',
  'memory_recall',
  'compose_visual',
  'compose_app',
  'render_artifact',
  'request_clarification',
  'browser_sandbox_exec',
  'synth_execute',
  'synth_synthesize',
]);

// Verb token classification.
const READ_VERBS = new Set([
  'list', 'get', 'describe', 'show', 'read',
  'find', 'search', 'query', 'fetch', 'inspect',
]);
const MUTATING_VERBS = new Set([
  'create', 'update', 'put', 'set', 'modify',
  'attach', 'detach', 'patch', 'enable', 'disable',
  'start', 'stop', 'restart', 'scale', 'add', 'remove',
]);
const DESTRUCTIVE_VERBS = new Set([
  'delete', 'destroy', 'terminate', 'drop', 'purge',
  'erase', 'wipe',
]);

// Service tag from common resource keywords (best-effort).
// Keyed on substring tokens found anywhere in the rest of the name.
const SERVICE_KEYWORDS: Record<string, string> = {
  // Azure
  subscription: 'arm',
  subscriptions: 'arm',
  'resource_group': 'arm',
  'resource_groups': 'arm',
  vm: 'compute',
  vms: 'compute',
  app_service: 'app_service',
  app_services: 'app_service',
  storage_account: 'storage',
  storage_accounts: 'storage',
  // AWS
  ec2: 'ec2',
  instance: 'ec2',
  instances: 'ec2',
  s3: 's3',
  bucket: 's3',
  buckets: 's3',
  iam: 'iam',
  // GCP
  project: 'resource_manager',
  projects: 'resource_manager',
  billing: 'billing',
  // K8s
  pod: 'core',
  pods: 'core',
  node: 'core',
  nodes: 'core',
  namespace: 'core',
  namespaces: 'core',
};

/**
 * Split a snake_case name into lowercase tokens. No regex.
 */
function tokenize(name: string): string[] {
  return name.split('_').filter((t) => t.length > 0).map((t) => t.toLowerCase());
}

/**
 * Classify a verb token. Returns `undefined` if the token isn't a known verb.
 */
function classifyVerb(token: string): Verb | undefined {
  if (READ_VERBS.has(token)) {
    // Map all read verbs to canonical bucket if it's in our enum.
    if (token === 'list' || token === 'get' || token === 'query' ||
        token === 'search' || token === 'fetch') {
      return token as Verb;
    }
    return 'get'; // generic read fallthrough
  }
  if (MUTATING_VERBS.has(token)) {
    if (token === 'create' || token === 'update') return token as Verb;
    return 'update'; // generic mutating fallthrough
  }
  if (DESTRUCTIVE_VERBS.has(token)) {
    if (token === 'delete' || token === 'terminate' || token === 'destroy') {
      return token as Verb;
    }
    return 'delete';
  }
  return undefined;
}

/**
 * Get cost_class from a Verb. Read by default.
 */
function costClassForVerb(verb: Verb | undefined): CostClass {
  if (!verb) return 'mutating'; // unknown → safer to assume mutating
  if (READ_VERBS.has(verb)) return 'read';
  if (DESTRUCTIVE_VERBS.has(verb)) return 'destructive';
  if (MUTATING_VERBS.has(verb)) return 'mutating';
  return 'mutating';
}

/**
 * Generate alias terms for a resource token. Handles plural/singular
 * + common abbreviations. Pure string ops — no regex.
 */
function aliasesForResource(token: string): string[] {
  if (!token || token.length < 2) return [];
  const out = new Set<string>();
  out.add(token);
  // Pluralization rules.
  if (token.endsWith('s') && token.length > 3) {
    // singularize
    out.add(token.slice(0, -1));
  } else if (token.length > 2) {
    // pluralize
    out.add(token + 's');
  }
  // Common abbreviations.
  if (token.startsWith('subscription')) out.add('subs');
  if (token === 'subscription' || token === 'subscriptions') out.add('subs');
  if (token === 'instance' || token === 'instances') out.add('vms');
  if (token === 'bucket' || token === 'buckets') out.add('s3');
  if (token === 'resource_group' || token === 'resource_groups') {
    out.add('rgs');
    out.add('rg');
  }
  return Array.from(out);
}

/**
 * Map the leading provider token to the typical "primary" service for that
 * provider when the verb-resource pair maps to it. E.g.
 * azure_list_subscriptions → service 'arm' (ARM tenant API).
 */
function inferService(tokens: string[], cloudProvider: CloudProvider | undefined): string | undefined {
  // 1. Look for an explicit service keyword anywhere in the token list.
  for (const t of tokens) {
    if (SERVICE_KEYWORDS[t]) return SERVICE_KEYWORDS[t];
  }
  // 2. Provider-specific defaults for very common combos.
  if (cloudProvider === 'azure') {
    // Most azure_list_* targets ARM (subs, RGs, resources).
    if (tokens.includes('list')) return 'arm';
  }
  return undefined;
}

export function inferToolMetadataFromName(toolName: string): InferredToolMetadata {
  if (!toolName || typeof toolName !== 'string') {
    return {
      cloud_provider: undefined,
      service: undefined,
      verb: undefined,
      cost_class: 'mutating',
      aliases: [],
      inferred: true,
    };
  }

  const lower = toolName.toLowerCase();
  const tokens = tokenize(lower);

  // 1. Cloud provider — first token if it matches.
  let cloudProvider: CloudProvider | undefined;
  if (tokens.length > 0 && PROVIDER_PREFIXES[tokens[0]]) {
    cloudProvider = PROVIDER_PREFIXES[tokens[0]];
  } else if (PLATFORM_BARE_NAMES.has(lower)) {
    cloudProvider = 'platform';
  }

  // 2. Verb — second token after a provider prefix, or first token for bare.
  let verb: Verb | undefined;
  const verbStart = cloudProvider && cloudProvider !== 'platform' ? 1 : 0;
  if (tokens[verbStart]) {
    verb = classifyVerb(tokens[verbStart]);
  }
  // Bare platform-tool name with verb in name (web_search, tool_search).
  if (!verb && tokens.includes('search')) verb = 'search';
  if (!verb && tokens.includes('fetch')) verb = 'fetch';
  if (!verb && tokens.includes('list')) verb = 'list';

  // 3. Service — service tag from resource keywords.
  const service = inferService(tokens, cloudProvider);

  // 4. Cost class — derived from verb.
  const cost_class = costClassForVerb(verb);

  // 5. Aliases — for every "resource" token (tokens past the verb).
  const aliasSet = new Set<string>();
  const resourceStart = verbStart + (verb ? 1 : 0);
  for (let i = resourceStart; i < tokens.length; i++) {
    for (const a of aliasesForResource(tokens[i])) {
      aliasSet.add(a);
    }
  }
  // Multi-token resource: also add joined form (resource_groups).
  if (tokens.length - resourceStart >= 2) {
    const joined = tokens.slice(resourceStart).join('_');
    aliasSet.add(joined);
    for (const a of aliasesForResource(joined)) aliasSet.add(a);
  }

  return {
    cloud_provider: cloudProvider,
    service,
    verb,
    cost_class,
    aliases: Array.from(aliasSet),
    inferred: true,
  };
}
