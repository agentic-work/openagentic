/**
 * Webhook Security Service
 *
 * Enterprise-grade inbound webhook security with:
 *   - Global kill switch (instant disable all webhooks)
 *   - Platform-aware signature validation (Slack, PagerDuty, GitHub, Jira, Teams)
 *   - Timestamp replay protection (reject stale requests)
 *   - Redis-backed rate limiting (survives restarts)
 *   - Prompt injection scanning on payloads
 *   - DLP scanning on payloads
 *   - Per-webhook tool scope restrictions
 *   - Full audit logging to webhook_audit_logs table
 *   - Platform CIDR allowlists (auto-populated for known services)
 *   - Admin-configurable via SystemConfiguration
 */

import { createHmac, timingSafeEqual, createHash } from 'crypto';
import { prisma } from '../utils/prisma.js';
import { getRedisClient } from '../utils/redis-client.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookSecurityConfig {
  /** Master kill switch — disables ALL inbound webhooks */
  globalEnabled: boolean;
  /** Maximum payload size in bytes (default 512KB) */
  maxPayloadBytes: number;
  /** Reject requests older than this many seconds (default 300 = 5min) */
  replayWindowSeconds: number;
  /** Global rate limit across ALL webhooks (req/min, 0 = unlimited) */
  globalRateLimitPerMinute: number;
  /** Scan payloads for prompt injection before template interpolation */
  promptInjectionScanEnabled: boolean;
  /** Block (vs log) when prompt injection detected */
  promptInjectionBlockEnabled: boolean;
  /** Prompt injection confidence threshold to block (0-1, default 0.7) */
  promptInjectionThreshold: number;
  /** DLP scan enabled on webhook payloads */
  dlpScanEnabled: boolean;
  /** Allowed content types */
  allowedContentTypes: string[];
  /** Platform-specific IP CIDR allowlists */
  platformAllowlists: Record<string, PlatformAllowlist>;
  /** Tools that are NEVER available in webhook-triggered flows */
  blockedTools: string[];
  /** Require HMAC on ALL webhooks (override per-webhook setting) */
  requireHmacGlobal: boolean;
}

export interface PlatformAllowlist {
  enabled: boolean;
  cidrs: string[];
  signatureHeader: string;
  timestampHeader?: string;
  description: string;
}

export interface WebhookSecurityResult {
  allowed: boolean;
  status: string; // accepted, rejected_*
  statusCode: number;
  rejectionReason?: string;
  platform?: string;
  injectionScore?: number;
  dlpFindings?: any[];
  payloadHash?: string;
}

// ---------------------------------------------------------------------------
// Known platform IP ranges and signature headers
// ---------------------------------------------------------------------------

const KNOWN_PLATFORMS: Record<string, PlatformAllowlist> = {
  slack: {
    enabled: true,
    cidrs: [], // Slack doesn't publish static IPs — use signature validation instead
    signatureHeader: 'x-slack-signature',
    timestampHeader: 'x-slack-request-timestamp',
    description: 'Slack Events API and slash commands',
  },
  pagerduty: {
    enabled: true,
    cidrs: [], // PagerDuty v3 webhooks
    signatureHeader: 'x-pagerduty-signature',
    description: 'PagerDuty Webhooks v3',
  },
  github: {
    enabled: true,
    cidrs: [
      '140.82.112.0/20', '185.199.108.0/22', '192.30.252.0/22', '143.55.64.0/20',
    ],
    signatureHeader: 'x-hub-signature-256',
    description: 'GitHub Webhooks',
  },
  jira: {
    enabled: true,
    cidrs: [
      '13.52.5.96/28', '13.236.8.224/28', '18.136.214.96/28',
      '18.184.99.224/28', '18.234.32.224/28', '18.246.31.224/28',
      '52.215.192.224/28', '104.192.136.0/21', '185.166.140.0/22',
    ],
    signatureHeader: 'x-hub-signature', // Jira uses same as GitHub
    description: 'Atlassian/Jira Webhooks',
  },
  teams: {
    enabled: true,
    cidrs: [], // Teams uses outgoing webhooks with HMAC
    signatureHeader: 'authorization', // Teams sends HMAC in Authorization header
    description: 'Microsoft Teams Outgoing Webhooks',
  },
  servicenow: {
    enabled: true,
    cidrs: [], // ServiceNow instances have dynamic IPs
    signatureHeader: 'x-webhook-signature',
    description: 'ServiceNow Outbound REST Webhooks',
  },
  discord: {
    enabled: true,
    cidrs: [],
    signatureHeader: 'x-signature-ed25519',
    description: 'Discord Interactions',
  },
};

// ---------------------------------------------------------------------------
// Default configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: WebhookSecurityConfig = {
  globalEnabled: true,
  maxPayloadBytes: 512 * 1024, // 512KB
  replayWindowSeconds: 300,     // 5 minutes
  globalRateLimitPerMinute: 600,
  promptInjectionScanEnabled: true,
  promptInjectionBlockEnabled: true,
  promptInjectionThreshold: 0.7,
  dlpScanEnabled: true,
  allowedContentTypes: ['application/json', 'application/x-www-form-urlencoded', 'text/plain'],
  platformAllowlists: KNOWN_PLATFORMS,
  blockedTools: [
    'admin_postgres_raw_query', 'admin_user_create', 'admin_user_delete',
    'admin_config_update', 'k8s_delete', 'k8s_exec',
    'aws_iam_create',
  ],
  requireHmacGlobal: false,
};

const CONFIG_KEY = 'webhook_security';
const REDIS_CONFIG_KEY = 'webhook_security_config';
const REDIS_RATE_PREFIX = 'wh_rate:';
const REDIS_GLOBAL_RATE_KEY = 'wh_global_rate';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class WebhookSecurityService {
  private config: WebhookSecurityConfig = DEFAULT_CONFIG;
  private configLoadedAt = 0;
  private readonly CONFIG_TTL_MS = 30_000; // reload config every 30s

  /**
   * Load configuration from SystemConfiguration (cached in Redis + memory)
   */
  async loadConfig(): Promise<WebhookSecurityConfig> {
    const now = Date.now();
    if (now - this.configLoadedAt < this.CONFIG_TTL_MS) {
      return this.config;
    }

    try {
      // Try Redis cache first
      const redis = getRedisClient();
      if (redis.isConnected()) {
        const cached = await redis.get<WebhookSecurityConfig>(REDIS_CONFIG_KEY);
        if (cached) {
          this.config = { ...DEFAULT_CONFIG, ...cached };
          this.configLoadedAt = now;
          return this.config;
        }
      }

      // Fall back to DB
      const dbConfig = await prisma.systemConfiguration.findFirst({
        where: { key: CONFIG_KEY, is_active: true },
      });

      if (dbConfig?.value) {
        const parsed = dbConfig.value as any;
        this.config = { ...DEFAULT_CONFIG, ...parsed };

        // Cache in Redis for 60s
        if (redis.isConnected()) {
          await redis.set(REDIS_CONFIG_KEY, this.config, 60);
        }
      }
    } catch (err) {
      logger.warn({ err }, '[WebhookSecurity] Failed to load config, using defaults');
    }

    this.configLoadedAt = now;
    return this.config;
  }

  /**
   * Save configuration to DB and invalidate caches
   */
  async saveConfig(config: Partial<WebhookSecurityConfig>): Promise<WebhookSecurityConfig> {
    const merged = { ...this.config, ...config };

    await prisma.systemConfiguration.upsert({
      where: { key: CONFIG_KEY },
      update: { value: merged as any, updated_at: new Date() },
      create: { key: CONFIG_KEY, value: merged as any, description: 'Webhook security configuration', is_active: true },
    });

    // Invalidate caches
    this.configLoadedAt = 0;
    const redis = getRedisClient();
    if (redis.isConnected()) {
      await redis.del(REDIS_CONFIG_KEY);
    }

    this.config = merged;
    return merged;
  }

  /**
   * Main security gate — run all checks on an inbound webhook request
   */
  async validateRequest(params: {
    webhookKey: string;
    webhookSecret?: string | null;
    sourceIp: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
    contentType?: string;
    userAgent?: string;
  }): Promise<WebhookSecurityResult> {
    const config = await this.loadConfig();
    const payloadHash = createHash('sha256').update(params.rawBody).digest('hex');

    // 1. Kill switch
    if (!config.globalEnabled) {
      return { allowed: false, status: 'rejected_kill_switch', statusCode: 503, rejectionReason: 'Inbound webhooks are globally disabled', payloadHash };
    }

    // 2. Payload size
    if (Buffer.byteLength(params.rawBody, 'utf-8') > config.maxPayloadBytes) {
      return { allowed: false, status: 'rejected_payload', statusCode: 413, rejectionReason: `Payload exceeds ${config.maxPayloadBytes} bytes`, payloadHash };
    }

    // 3. Content-Type check
    const ct = (params.contentType || '').split(';')[0].trim().toLowerCase();
    if (ct && config.allowedContentTypes.length > 0 && !config.allowedContentTypes.includes(ct)) {
      return { allowed: false, status: 'rejected_payload', statusCode: 415, rejectionReason: `Content-Type ${ct} not allowed`, payloadHash };
    }

    // 4. Detect platform from headers
    const platform = this.detectPlatform(params.headers);

    // 5. Platform IP allowlist check
    if (platform && config.platformAllowlists[platform]?.enabled) {
      const allowlist = config.platformAllowlists[platform];
      if (allowlist.cidrs.length > 0 && !this.ipInCidrs(params.sourceIp, allowlist.cidrs)) {
        return { allowed: false, status: 'rejected_ip', statusCode: 403, rejectionReason: `IP ${params.sourceIp} not in ${platform} allowlist`, platform, payloadHash };
      }
    }

    // 6. Platform-aware signature validation
    if (config.requireHmacGlobal || params.webhookSecret) {
      const sigResult = this.validatePlatformSignature(platform, params);
      if (!sigResult.valid) {
        return { allowed: false, status: 'rejected_signature', statusCode: 401, rejectionReason: sigResult.reason, platform, payloadHash };
      }
    }

    // 7. Timestamp replay protection
    const tsResult = this.checkTimestamp(platform, params.headers, config.replayWindowSeconds);
    if (!tsResult.valid) {
      return { allowed: false, status: 'rejected_signature', statusCode: 401, rejectionReason: tsResult.reason, platform, payloadHash };
    }

    // 8. Global rate limit (Redis)
    const globalAllowed = await this.checkGlobalRateLimit(config.globalRateLimitPerMinute);
    if (!globalAllowed) {
      return { allowed: false, status: 'rejected_rate_limit', statusCode: 429, rejectionReason: 'Global webhook rate limit exceeded', platform, payloadHash };
    }

    // 9. Per-webhook rate limit (Redis)
    const perWebhookAllowed = await this.checkPerWebhookRateLimit(params.webhookKey);
    if (!perWebhookAllowed) {
      return { allowed: false, status: 'rejected_rate_limit', statusCode: 429, rejectionReason: 'Per-webhook rate limit exceeded', platform, payloadHash };
    }

    // 10. Prompt injection scanning
    let injectionScore: number | undefined;
    if (config.promptInjectionScanEnabled) {
      injectionScore = this.scanForInjection(params.rawBody);
      if (injectionScore >= config.promptInjectionThreshold && config.promptInjectionBlockEnabled) {
        return { allowed: false, status: 'rejected_injection', statusCode: 422, rejectionReason: `Prompt injection detected (score: ${injectionScore.toFixed(2)})`, platform, injectionScore, payloadHash };
      }
    }

    // 11. DLP scan
    let dlpFindings: any[] | undefined;
    if (config.dlpScanEnabled) {
      dlpFindings = this.scanDLP(params.rawBody);
      const critical = dlpFindings.filter(f => f.severity === 'critical');
      if (critical.length > 0) {
        return { allowed: false, status: 'rejected_payload', statusCode: 422, rejectionReason: `DLP: ${critical.length} critical finding(s) blocked`, platform, dlpFindings, payloadHash };
      }
    }

    return { allowed: true, status: 'accepted', statusCode: 200, platform, injectionScore, dlpFindings, payloadHash };
  }

  /**
   * Write audit log entry
   */
  async auditLog(entry: {
    webhookId?: string;
    webhookKey: string;
    workflowId?: string;
    sourceIp: string;
    userAgent?: string;
    contentType?: string;
    payloadSize: number;
    payloadHash?: string;
    status: string;
    statusCode: number;
    rejectionReason?: string;
    dlpFindings?: any[];
    injectionScore?: number;
    executionId?: string;
    responseTimeMs?: number;
    platform?: string;
  }): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO admin.webhook_audit_logs (
          id, webhook_id, webhook_key, workflow_id,
          source_ip, user_agent, content_type, payload_size, payload_hash,
          status, status_code, rejection_reason,
          dlp_findings, injection_score,
          execution_id, response_time_ms, platform,
          created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3,
          $4, $5, $6, $7, $8,
          $9, $10, $11,
          $12, $13,
          $14, $15, $16,
          NOW()
        )
      `,
        entry.webhookId || null, entry.webhookKey, entry.workflowId || null,
        entry.sourceIp, entry.userAgent || null, entry.contentType || null, entry.payloadSize, entry.payloadHash || null,
        entry.status, entry.statusCode, entry.rejectionReason || null,
        entry.dlpFindings ? JSON.stringify(entry.dlpFindings) : null, entry.injectionScore || null,
        entry.executionId || null, entry.responseTimeMs || null, entry.platform || null,
      );
    } catch (err) {
      logger.warn({ err }, '[WebhookSecurity] Failed to write audit log');
    }
  }

  /**
   * Get blocked tools list (tools never available in webhook-triggered flows)
   */
  getBlockedTools(): string[] {
    return this.config.blockedTools;
  }

  /**
   * Get config (for admin API)
   */
  getConfig(): WebhookSecurityConfig {
    return this.config;
  }

  // ─── Private helpers ───────────────────────────────────────────────────

  private detectPlatform(headers: Record<string, string | string[] | undefined>): string | undefined {
    const h = (name: string) => {
      const v = headers[name] || headers[name.toLowerCase()];
      return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
    };

    if (h('x-slack-signature')) return 'slack';
    if (h('x-pagerduty-signature')) return 'pagerduty';
    if (h('x-hub-signature-256') || h('x-github-event')) return 'github';
    if (h('x-signature-ed25519')) return 'discord';
    const ua = (h('user-agent') || '').toLowerCase();
    if (ua.includes('servicenow')) return 'servicenow';
    if (ua.includes('teams') || ua.includes('microsoft')) return 'teams';
    if (ua.includes('atlassian') || ua.includes('jira')) return 'jira';
    return undefined;
  }

  private validatePlatformSignature(platform: string | undefined, params: {
    webhookSecret?: string | null;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): { valid: boolean; reason?: string } {
    const secret = params.webhookSecret;
    if (!secret) return { valid: false, reason: 'Webhook has no secret configured but HMAC is required' };

    const h = (name: string) => {
      const v = params.headers[name] || params.headers[name.toLowerCase()];
      return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
    };

    let signature: string | undefined;
    let computedSignature: string;

    switch (platform) {
      case 'slack': {
        // Slack: v0=sha256(v0:{timestamp}:{body})
        const ts = h('x-slack-request-timestamp');
        signature = h('x-slack-signature');
        if (!signature || !ts) return { valid: false, reason: 'Missing Slack signature or timestamp header' };
        const basestring = `v0:${ts}:${params.rawBody}`;
        computedSignature = 'v0=' + createHmac('sha256', secret).update(basestring).digest('hex');
        break;
      }
      case 'github': {
        // GitHub: sha256=<hex>
        signature = h('x-hub-signature-256');
        if (!signature) return { valid: false, reason: 'Missing X-Hub-Signature-256 header' };
        computedSignature = 'sha256=' + createHmac('sha256', secret).update(params.rawBody).digest('hex');
        break;
      }
      case 'pagerduty': {
        // PagerDuty: v1=<hex> of body
        signature = h('x-pagerduty-signature');
        if (!signature) return { valid: false, reason: 'Missing X-PagerDuty-Signature header' };
        // PD sends multiple signatures separated by commas; check if any match
        const sigs = signature.split(',').map(s => s.trim());
        const expected = 'v1=' + createHmac('sha256', secret).update(params.rawBody).digest('hex');
        const anyMatch = sigs.some(s => {
          try {
            return s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected));
          } catch { return false; }
        });
        return anyMatch ? { valid: true } : { valid: false, reason: 'PagerDuty signature mismatch' };
      }
      default: {
        // Generic: X-Webhook-Signature: sha256=<hex>
        signature = h('x-webhook-signature');
        if (!signature) return { valid: false, reason: 'Missing X-Webhook-Signature header' };
        computedSignature = 'sha256=' + createHmac('sha256', secret).update(params.rawBody).digest('hex');
        break;
      }
    }

    try {
      const provided = signature!.replace(/^(sha256=|v0=)/, '');
      const expected = computedSignature!.replace(/^(sha256=|v0=)/, '');
      if (provided.length !== expected.length) return { valid: false, reason: 'Signature length mismatch' };
      const valid = timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
      return valid ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
    } catch {
      return { valid: false, reason: 'Signature validation error' };
    }
  }

  private checkTimestamp(
    platform: string | undefined,
    headers: Record<string, string | string[] | undefined>,
    maxAgeSeconds: number,
  ): { valid: boolean; reason?: string } {
    // Only enforce timestamp for platforms that send one
    if (platform !== 'slack') return { valid: true };

    const h = (name: string) => {
      const v = headers[name] || headers[name.toLowerCase()];
      return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
    };

    const ts = h('x-slack-request-timestamp');
    if (!ts) return { valid: true }; // No timestamp = skip check

    const requestTime = Number.parseInt(ts, 10);
    if (Number.isNaN(requestTime)) return { valid: false, reason: 'Invalid timestamp' };

    const age = Math.abs(Math.floor(Date.now() / 1000) - requestTime);
    if (age > maxAgeSeconds) {
      return { valid: false, reason: `Request too old (${age}s > ${maxAgeSeconds}s window)` };
    }

    return { valid: true };
  }

  private async checkGlobalRateLimit(limitPerMinute: number): Promise<boolean> {
    if (limitPerMinute <= 0) return true;

    const redis = getRedisClient();
    if (!redis.isConnected()) return true; // Fail open if Redis unavailable

    try {
      const key = REDIS_GLOBAL_RATE_KEY;
      const current = await redis.get(key);
      const count = (typeof current === 'number' ? current : 0) + 1;
      await redis.set(key, count, 60);
      return count <= limitPerMinute;
    } catch {
      return true; // Fail open
    }
  }

  private async checkPerWebhookRateLimit(webhookKey: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis.isConnected()) return true;

    try {
      const key = `${REDIS_RATE_PREFIX}${webhookKey}`;
      const current = await redis.get(key);
      const count = (typeof current === 'number' ? current : 0) + 1;
      await redis.set(key, count, 60);
      // Per-webhook limit is loaded from DB by the caller; we use 60/min default
      return count <= 60;
    } catch {
      return true;
    }
  }

  /**
   * Prompt injection detection — heuristic scoring
   * Returns 0-1 confidence score
   */
  private scanForInjection(payload: string): number {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const lower = text.toLowerCase();
    let score = 0;
    const signals: string[] = [];

    // Direct instruction patterns
    const patterns: Array<{ re: RegExp; weight: number; label: string }> = [
      { re: /ignore\s+(all\s+)?previous\s+instructions/i, weight: 0.9, label: 'ignore_previous' },
      { re: /ignore\s+(all\s+)?prior\s+(instructions|rules|guidelines)/i, weight: 0.9, label: 'ignore_prior' },
      { re: /you\s+are\s+now\s+(a|an)\s/i, weight: 0.8, label: 'role_override' },
      { re: /system\s*:\s*you\s+are/i, weight: 0.85, label: 'system_prompt_inject' },
      { re: /\[SYSTEM\]|\[INST\]|<\|im_start\|>system/i, weight: 0.9, label: 'prompt_format_inject' },
      { re: /do\s+not\s+follow\s+(the\s+)?instructions/i, weight: 0.8, label: 'counter_instruction' },
      { re: /forget\s+(everything|all|your)\s+(you|instructions|rules)/i, weight: 0.85, label: 'forget_instructions' },
      { re: /instead\s*,?\s*(please\s+)?execute|instead\s+run/i, weight: 0.7, label: 'redirect_execution' },
      { re: /admin_postgres_raw_query|admin_user_delete|rm\s+-rf/i, weight: 0.95, label: 'dangerous_tool_ref' },
      { re: /exfiltrate|steal\s+(the\s+)?data|dump\s+(all\s+)?users/i, weight: 0.9, label: 'exfiltration_intent' },
      { re: /{{.*admin.*}}|{{.*secret.*}}|{{.*password.*}}/i, weight: 0.7, label: 'template_probe' },
      { re: /\bDAN\b.*\bjailbreak\b|\bjailbreak\b.*\bDAN\b/i, weight: 0.95, label: 'jailbreak_ref' },
    ];

    for (const { re, weight, label } of patterns) {
      if (re.test(text)) {
        score = Math.max(score, weight);
        signals.push(label);
      }
    }

    // Structural signals (lower weight)
    if (lower.includes('```system') || lower.includes('```instruction')) score = Math.max(score, 0.6);
    if ((text.match(/\n/g) || []).length > 20 && text.length > 2000) score = Math.max(score, 0.3); // Suspiciously long
    if (lower.includes('base64') && lower.includes('eval')) score = Math.max(score, 0.7);

    if (signals.length > 0) {
      logger.warn({ signals, score, payloadLength: text.length }, '[WebhookSecurity] Injection signals detected');
    }

    return score;
  }

  /**
   * Lightweight DLP scan — checks for credentials and PII in webhook payload
   */
  private scanDLP(payload: string): Array<{ rule: string; severity: string; match: string }> {
    const findings: Array<{ rule: string; severity: string; match: string }> = [];

    const rules: Array<{ name: string; pattern: RegExp; severity: string }> = [
      { name: 'aws_access_key', pattern: /AKIA[0-9A-Z]{16}/g, severity: 'critical' },
      { name: 'aws_secret_key', pattern: /[0-9a-zA-Z/+=]{40}/g, severity: 'high' },
      { name: 'github_token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g, severity: 'critical' },
      { name: 'generic_api_key', pattern: /(?:api[_-]?key|apikey|token)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}["']?/gi, severity: 'high' },
      { name: 'private_key', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, severity: 'critical' },
      { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, severity: 'critical' },
      { name: 'credit_card', pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b/g, severity: 'critical' },
      { name: 'connection_string', pattern: /(?:postgres|mysql|mongodb):\/\/[^\s]+:[^\s]+@/gi, severity: 'critical' },
    ];

    for (const rule of rules) {
      const matches = payload.match(rule.pattern);
      if (matches) {
        for (const m of matches.slice(0, 3)) { // Cap at 3 per rule
          findings.push({ rule: rule.name, severity: rule.severity, match: m.substring(0, 8) + '***' });
        }
      }
    }

    return findings;
  }

  /**
   * Check if an IP is within any of the given CIDRs
   */
  private ipInCidrs(ip: string, cidrs: string[]): boolean {
    if (cidrs.length === 0) return true;

    const ipNum = this.ipToNum(ip);
    if (ipNum === null) return false;

    for (const cidr of cidrs) {
      const [base, bits] = cidr.split('/');
      const baseNum = this.ipToNum(base);
      const mask = bits ? ~((1 << (32 - Number.parseInt(bits))) - 1) >>> 0 : 0xFFFFFFFF;
      if (baseNum !== null && (ipNum & mask) === (baseNum & mask)) {
        return true;
      }
    }
    return false;
  }

  private ipToNum(ip: string): number | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }
}

// Singleton
export const webhookSecurityService = new WebhookSecurityService();
