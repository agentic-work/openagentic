/**
 * Scope Enforcement Helper
 *
 * APPLICATION-LEVEL enforcement that runs BEFORE sending to the LLM.
 * Non-admin users are restricted to cloud/infrastructure/tech topics.
 * This cannot be bypassed by the LLM because it runs at the app level.
 */

import type { Logger } from 'pino';

// Keywords that indicate allowed topics
const ALLOWED_KEYWORDS = [
  // Cloud platforms
  'azure', 'aws', 'gcp', 'cloud', 'kubernetes', 'k8s', 'docker', 'container',
  'vm', 'virtual machine', 'ec2', 'lambda', 'function', 'serverless',
  'storage', 'blob', 's3', 'bucket', 'database', 'sql', 'nosql', 'cosmos',
  'redis', 'cache', 'milvus', 'vector', 'embedding',

  // Infrastructure
  'infrastructure', 'infra', 'network', 'vnet', 'subnet', 'firewall', 'nsg',
  'load balancer', 'cdn', 'dns', 'domain', 'ssl', 'tls', 'certificate',
  'vpn', 'gateway', 'peering', 'routing', 'ip', 'port', 'tcp', 'udp',

  // DevOps
  'devops', 'ci/cd', 'cicd', 'pipeline', 'deploy', 'deployment', 'release',
  'build', 'test', 'github', 'gitlab', 'jenkins', 'terraform', 'pulumi',
  'ansible', 'helm', 'argo', 'flux', 'gitops',

  // Security
  'security', 'iam', 'rbac', 'role', 'permission', 'identity', 'authentication',
  'authorization', 'oauth', 'saml', 'sso', 'mfa', '2fa', 'secret', 'vault',
  'encryption', 'key', 'certificate', 'compliance', 'audit', 'log',

  // Monitoring & Observability
  'monitor', 'monitoring', 'metrics', 'alert', 'dashboard', 'grafana',
  'prometheus', 'datadog', 'splunk', 'log', 'logging', 'trace', 'tracing',
  'apm', 'performance', 'latency', 'throughput', 'error rate',

  // Development
  'api', 'rest', 'graphql', 'grpc', 'microservice', 'service', 'endpoint',
  'code', 'function', 'class', 'method', 'bug', 'debug', 'error', 'exception',
  'typescript', 'javascript', 'python', 'go', 'java', 'rust', 'node',
  'npm', 'pip', 'package', 'dependency', 'version', 'migrate', 'migration',

  // Data
  'data', 'etl', 'pipeline', 'stream', 'kafka', 'rabbitmq', 'queue', 'message',
  'batch', 'spark', 'hadoop', 'bigquery', 'snowflake', 'warehouse',

  // AI/ML (work-related)
  'llm', 'model', 'ai', 'ml', 'machine learning', 'embedding', 'rag',
  'prompt', 'token', 'inference', 'training', 'fine-tune', 'vertex', 'bedrock',
  'openai', 'anthropic', 'claude', 'gpt', 'ollama',

  // Documentation & Process
  'document', 'documentation', 'diagram', 'architecture', 'design', 'pattern',
  'best practice', 'runbook', 'playbook', 'sop', 'process', 'workflow',

  // Business Analytics & Reporting (common RAG/knowledge base queries)
  'revenue', 'cost', 'budget', 'spending', 'forecast', 'quarterly', 'annual',
  'report', 'analysis', 'analytics', 'kpi', 'okr', 'target', 'goal',
  'region', 'department', 'team', 'headcount', 'hire', 'attrition',
  'deal', 'pipeline', 'funnel', 'conversion', 'churn', 'retention',
  'compliance', 'risk', 'incident', 'sla', 'slo', 'uptime',
  'knowledge base', 'ingested', 'uploaded', 'search our',

  // Platform-specific
  'openagentic', 'mcp', 'tool', 'slider', 'chat', 'session'
];

// Keywords that indicate OFF-TOPIC queries
const BLOCKED_KEYWORDS = [
  // Entertainment
  'movie', 'film', 'actor', 'actress', 'celebrity', 'music', 'song', 'singer',
  'band', 'album', 'concert', 'game', 'gaming', 'video game', 'playstation',
  'xbox', 'nintendo', 'sports', 'football', 'basketball', 'baseball', 'soccer',
  'nfl', 'nba', 'mlb', 'world series', 'super bowl', 'olympics',

  // Personal
  'recipe', 'cook', 'cooking', 'food', 'restaurant', 'diet', 'health',
  'fitness', 'workout', 'exercise', 'weight loss', 'relationship', 'dating',
  'love', 'romance', 'marriage', 'divorce', 'family', 'parenting', 'baby',

  // General Knowledge (non-work)
  'history', 'historical', 'ancient', 'war', 'battle', 'king', 'queen',
  'president', 'politics', 'election', 'vote', 'geography', 'capital of',
  'country', 'population', 'language', 'culture', 'religion', 'philosophy',

  // Finance (personal)
  'stock', 'invest', 'investing', 'crypto', 'cryptocurrency', 'bitcoin',
  'ethereum', 'trading', 'forex', 'gambling', 'casino', 'lottery', 'bet',
  'rich', 'millionaire', 'passive income',

  // Creative
  'story', 'poem', 'poetry', 'novel', 'fiction', 'fantasy', 'joke', 'funny',
  'creative writing', 'essay', 'homework', 'school',

  // Shopping
  'buy', 'purchase', 'shopping', 'product', 'review', 'recommend', 'best',
  'cheap', 'affordable', 'deal', 'discount', 'coupon'
];

export interface ScopeCheckResult {
  isAllowed: boolean;
  reason?: string;
  blockedKeywords?: string[];
  allowedKeywords?: string[];
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Check if a query is within the allowed scope for non-admin users.
 * This is APPLICATION-LEVEL enforcement - the LLM cannot bypass this.
 */
export function checkQueryScope(
  query: string,
  isAdmin: boolean,
  logger?: Logger
): ScopeCheckResult {
  // Admins bypass scope enforcement
  if (isAdmin) {
    return { isAllowed: true, confidence: 'high', reason: 'Admin user - scope enforcement bypassed' };
  }

  const queryLower = query.toLowerCase();

  // Find matching blocked keywords
  const matchedBlockedKeywords = BLOCKED_KEYWORDS.filter(kw =>
    queryLower.includes(kw.toLowerCase())
  );

  // Find matching allowed keywords
  const matchedAllowedKeywords = ALLOWED_KEYWORDS.filter(kw =>
    queryLower.includes(kw.toLowerCase())
  );

  // Decision logic
  if (matchedBlockedKeywords.length > 0 && matchedAllowedKeywords.length === 0) {
    // Clear off-topic query
    logger?.warn({
      query: query.substring(0, 100),
      blockedKeywords: matchedBlockedKeywords
    }, '🚫 SCOPE ENFORCEMENT: Off-topic query blocked');

    return {
      isAllowed: false,
      reason: 'off-topic',
      blockedKeywords: matchedBlockedKeywords,
      confidence: 'high'
    };
  }

  if (matchedAllowedKeywords.length > 0) {
    // Contains work-related keywords - allow
    return {
      isAllowed: true,
      allowedKeywords: matchedAllowedKeywords,
      confidence: matchedBlockedKeywords.length > 0 ? 'medium' : 'high'
    };
  }

  // Ambiguous - no clear keywords either way
  // For short queries, be more lenient (might be follow-up questions)
  if (query.length < 30) {
    return {
      isAllowed: true,
      confidence: 'low',
      reason: 'Short query - allowing with low confidence'
    };
  }

  // For longer queries without any tech keywords, be more strict
  return {
    isAllowed: false,
    reason: 'Query lacks work-related context',
    confidence: 'medium'
  };
}

/**
 * Generate a scope violation response that the user will see.
 * This is returned INSTEAD of calling the LLM.
 */
export function getScopeViolationResponse(
  result: ScopeCheckResult,
  warningCount: number = 1
): string {
  const blockedList = result.blockedKeywords?.slice(0, 3).join(', ') || 'off-topic content';

  if (warningCount === 1) {
    return `⚠️ **Off-topic request detected.**

I'm designed to help with **cloud computing, infrastructure, DevOps, and technical operations** only.

Your question appears to be about: *${blockedList}*

Please rephrase your question to focus on technical/work-related matters.

*This is warning 1 of 3.*

---

**Examples of what I can help with:**
- ☁️ Cloud platforms (Azure, AWS, GCP)
- 🖥️ Infrastructure & networking
- 🔧 DevOps & CI/CD pipelines
- 🗄️ Databases & data engineering
- 🔐 Security & compliance
- 📊 Monitoring & observability`;
  }

  if (warningCount === 2) {
    return `⚠️ **Second off-topic request.**

This assistant is **strictly for cloud/infrastructure work**. Continued off-topic requests may result in account restrictions.

*Warning 2 of 3.*

Please ask about technical topics like:
- Kubernetes deployments
- Azure resource management
- CI/CD pipelines
- Database queries
- Security configurations`;
  }

  if (warningCount >= 3) {
    return `🔴 **Final warning.**

Your next off-topic request will result in **automatic account lockout**. An administrator will need to re-enable your access.

Please only ask work-related technical questions.

*Warning 3 of 3.*`;
  }

  return `⚠️ Please keep questions focused on cloud, infrastructure, and technical operations.`;
}

/**
 * Increment and get the user's scope violation count.
 * Returns the new count.
 */
export async function incrementScopeViolationCount(
  userId: string,
  redis: any
): Promise<number> {
  if (!redis) return 1;

  const key = `scope_violations:${userId}`;
  const count = await redis.incr(key);

  // Set expiry for 24 hours - warnings reset after a day
  await redis.expire(key, 86400);

  return count;
}

/**
 * Get the user's current scope violation count.
 */
export async function getScopeViolationCount(
  userId: string,
  redis: any
): Promise<number> {
  if (!redis) return 0;

  const key = `scope_violations:${userId}`;
  const count = await redis.get(key);

  return count ? parseInt(count, 10) : 0;
}
