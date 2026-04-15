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
 * Server-Side Tool Approval Gate (HITL Enforcement)
 *
 * Hybrid risk classification:
 *  1. DB overrides — admin can set per-tool risk levels
 *  2. User behavior learning — tracks approval history per user/tool
 *     to auto-approve tools the user always approves (trust score)
 *  3. Hardcoded defaults — fallback regex patterns for unknown tools
 *
 * Flow:
 *  1. Tool call arrives → gate evaluates risk
 *  2. LOW → auto-approve + log
 *  3. MEDIUM → require approval IF admin policy says so (unless user trust score > threshold)
 *  4. HIGH/CRITICAL → ALWAYS require approval (structural, not configurable)
 *  5. If approval required: emit SSE event, wait for response
 *  6. Timeout → auto-deny
 *  7. Record decision → update user trust score for this tool
 */

import { prisma } from '../utils/prisma.js';
import type { Logger } from 'pino';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ToolCallInfo {
  toolName: string;
  serverName?: string;
  arguments: Record<string, unknown>;
  userId: string;
  sessionId?: string;
  messageId?: string;
}

export interface ApprovalResult {
  approved: boolean;
  riskLevel: RiskLevel;
  reason: string;
  requiresHuman: boolean;
  approvedBy?: string;       // 'auto' | 'trust' | userId
  approvalTimeMs?: number;
  trustScore?: number;       // User's trust for this tool (0-1)
}

export interface ApprovalRequest {
  id: string;
  toolCall: ToolCallInfo;
  riskLevel: RiskLevel;
  reason: string;
  createdAt: number;
  expiresAt: number;
}

interface ToolRiskOverride {
  pattern: string;       // regex pattern string
  riskLevel: RiskLevel;
  source: 'admin';
}

interface UserToolTrust {
  totalCalls: number;
  approvedCalls: number;
  deniedCalls: number;
  lastUsed: number;
  trustScore: number;    // 0.0 to 1.0
}

// ---------------------------------------------------------------------------
// Default risk classification patterns (fallback when no DB config)
// ---------------------------------------------------------------------------

const DEFAULT_LOW_RISK_PATTERNS = [
  /^(?:list|get|describe|show|search|find|read|query|count|check|status|health|info|version|whoami)_/i,
  /^web_/i,
  /^memory_/i,
  /^diagram_/i,
  /^k8s_(?:list|get|describe|cluster_health|status|version|current_context|explain|rollout_status|rollout_history)/i,
  /^admin_(?:system|list|get|show|check|status|health|metrics|version|info)/i,
  /^(?:aws|azure|gcp)_(?:list|get|describe|cost|show|status|health|info|query|identity|help)/i,
  // Azure Resource Graph read-only query tools (cross-sub KQL queries are
  // read-only by definition; the SDK method is `resources()` which does not
  // mutate anything). Without this, tool names like
  // `azure_resource_graph_query_tenant_wide` fall through to medium-risk
  // and hit the HITL approval gate, which times out at 120s and looks
  // like a tool failure to the calling agent.
  /^azure_(?:resource_)?graph_(?:list|get|query|search|execute)/i,
  // Azure read-only inspection tools that have a noun BETWEEN "azure_" and
  // the read verb. The line above only catches azure_<verb> at the start;
  // tools like azure_advisor_recommendations, azure_security_list_assessments,
  // azure_monitor_query_metrics, azure_cost_by_service, etc. need their own
  // patterns. Adding broad coverage for the well-known read-only namespaces.
  /^azure_advisor_/i,
  /^azure_security_(?:list|get|describe|show|read|query)_/i,
  /^azure_monitor_(?:list|get|describe|show|read|query)_/i,
  /^azure_cost_(?:by_|query|forecast|show|get|list|describe)/i,
  /^azure_billing_(?:list|get|describe|show|read|query)_/i,
  /^azure_policy_(?:list|get|describe|show|read|query)_/i,
  /^azure_log_(?:list|get|describe|show|read|query)_/i,
  // AWS documentation + read-only search tools (3P AWS MCP servers use
  // double-underscore naming like `aws___search_documentation`). Docs
  // search is read-only, never mutates infrastructure.
  /^aws_+(?:search|read|get|list|describe|query)_/i,
  /_search_documentation$/i,
  /^helm_(?:list|status|history|get_values)$/i,
  /^(?:loki|prometheus)_/i,
  /^(?:suggest_|search_tool|list_available|get_tool)/i,
  /^(?:get_|list_|search_)(?:repo|issue|pull|commit|branch|workflow|code|file|user)/i,
  /^vertex_ai_(?:list|get|usage)/i,
  /^suggest_aws_commands$/i,
  /^aws_identity$/i,
  /^synth_/i,
];

const DEFAULT_MEDIUM_RISK_PATTERNS = [
  /^(?:create|update|put|patch|send|post|upload|deploy|start|stop|restart)_/i,
  /^(?:email|notify|message|alert)_/i,
  /^k8s_(?:create|apply|scale|restart|cordon|uncordon|patch|label|annotate)/i,
  /^admin_(?:create|update|delete|set|configure|enable|disable)/i,
  /^(?:aws|azure|gcp)_(?:create|update|modify|start|stop|restart|set)/i,
  /^azure_arm_execute$/i,
  /^gcp_api_execute$/i,
  /^openagentic_/i,
  /^helm_(?:install|upgrade|rollback|uninstall)$/i,
  /^(?:create_issue|create_pull_request|update_issue|trigger_workflow)$/i,
  /^web_store_knowledge$/i,
];

const DEFAULT_HIGH_RISK_PATTERNS = [
  /^(?:execute|run|exec|eval|shell|bash|cmd|command)_/i,
  /^(?:write|delete|remove|drop|truncate|destroy|purge)_/i,
  /^(?:file_write|file_delete|fs_write)$/i,
  /^(?:aws_|gcp_)(?:delete|destroy|remove|purge)/i,
  /^azure_(?:delete)/i,
  /^k8s_(?:delete|drain|cleanup)/i,
  /^credential_/i,
  /^call_aws$/i,
];

const DEFAULT_CRITICAL_RISK_PATTERNS = [
  /^(?:bulk|mass|batch)_/i,
  /^(?:infrastructure|iam|permission|role|policy)_(?:delete|modify|create)/i,
  /^(?:database|db)_(?:drop|delete|migrate|execute)/i,
];

/** Argument patterns that escalate risk */
const DANGEROUS_ARG_PATTERNS: Array<{ pattern: RegExp; escalateTo: RiskLevel }> = [
  { pattern: /rm\s+-rf/i, escalateTo: 'critical' },
  { pattern: /DROP\s+(?:TABLE|DATABASE)/i, escalateTo: 'critical' },
  { pattern: /DELETE\s+FROM\s+\w+\s*(?:WHERE\s+1\s*=\s*1)?$/i, escalateTo: 'critical' },
  { pattern: /(?:chmod|chown)\s+.*?(?:777|666)/i, escalateTo: 'high' },
  { pattern: /curl\s+.*?\|\s*(?:bash|sh)/i, escalateTo: 'critical' },
  { pattern: /--force|--hard|--no-verify/i, escalateTo: 'high' },
];

// ---------------------------------------------------------------------------
// ToolApprovalGate
// ---------------------------------------------------------------------------

export class ToolApprovalGate {
  private logger: Logger;
  private approvalEmitter = new EventEmitter();
  private pendingApprovals = new Map<string, ApprovalRequest>();
  private defaultTimeoutMs: number;
  private mediumRiskRequiresApproval: boolean;

  // DB-driven overrides (loaded from SystemConfiguration)
  private dbOverrides: ToolRiskOverride[] = [];
  private dbOverridesLoaded = false;

  // User behavior tracking (in-memory, periodically flushed to DB)
  private userToolTrust = new Map<string, UserToolTrust>(); // key: `${userId}:${toolName}`
  private trustThreshold = 0.85; // Auto-approve if user trust > this for MEDIUM risk
  private minCallsForTrust = 5;  // Need at least N calls before trusting

  constructor(logger: Logger, opts?: { timeoutMs?: number }) {
    this.logger = logger.child({ component: 'ToolApprovalGate' });
    // 10s default — keeps UX snappy and prevents the LLM tool loop from
    // stalling on unattended CRUD/high-risk requests. Auto-deny on timeout
    // so the LLM gets a clear "denied" result and can respond to the user.
    this.defaultTimeoutMs = opts?.timeoutMs ?? 120_000;
    // All CRUD/medium-risk tools require HITL by default (user requirement).
    // DB hitl_policy can still override via loadConfig().
    this.mediumRiskRequiresApproval = true;
    this.approvalEmitter.setMaxListeners(100);
  }

  /**
   * Load admin configuration + DB overrides + user trust data.
   */
  async loadConfig(): Promise<void> {
    try {
      // Load HITL policy
      const policy = await prisma.systemConfiguration.findFirst({
        where: { key: 'hitl_policy' },
      });
      if (policy?.value) {
        const val = typeof policy.value === 'string' ? JSON.parse(policy.value) : policy.value;
        if (val.mediumRiskRequiresApproval !== undefined) {
          this.mediumRiskRequiresApproval = val.mediumRiskRequiresApproval;
        }
        if (val.timeoutMs !== undefined) {
          this.defaultTimeoutMs = val.timeoutMs;
        }
        if (val.trustThreshold !== undefined) {
          this.trustThreshold = val.trustThreshold;
        }
        if (val.minCallsForTrust !== undefined) {
          this.minCallsForTrust = val.minCallsForTrust;
        }
        this.logger.info({
          mediumRiskRequiresApproval: this.mediumRiskRequiresApproval,
          timeoutMs: this.defaultTimeoutMs,
          trustThreshold: this.trustThreshold,
        }, '[HITL] Loaded hitl_policy from DB');
      } else {
        // GAP-#274: seed the hitl_policy row with current in-memory defaults so
        // (a) admin UI has something to read/edit, (b) the policy persists across
        // restarts, (c) other services can introspect what HITL is doing.
        // Idempotent — only runs when the row doesn't exist yet.
        try {
          const seedValue = {
            mediumRiskRequiresApproval: this.mediumRiskRequiresApproval,
            timeoutMs: this.defaultTimeoutMs,
            trustThreshold: this.trustThreshold,
            minCallsForTrust: this.minCallsForTrust,
            seededAt: new Date().toISOString(),
            seededBy: 'ToolApprovalGate.loadConfig',
          };
          await prisma.systemConfiguration.create({
            data: {
              key: 'hitl_policy',
              value: seedValue as any,
              description: 'HITL approval gate runtime policy. Edit via admin UI to tune timeouts and risk thresholds.',
            },
          });
          this.logger.info({ ...seedValue }, '[HITL] Seeded hitl_policy in DB with current defaults');
        } catch (seedErr) {
          // Race conditions across multiple API replicas seeding at the same time
          // are fine — we just want SOMETHING in the row.
          this.logger.info({ mediumRiskRequiresApproval: this.mediumRiskRequiresApproval }, '[HITL] No hitl_policy in DB, using defaults (seed attempt failed — likely race)');
        }
      }

      // Load DB-driven tool risk overrides
      const overrides = await prisma.systemConfiguration.findFirst({
        where: { key: 'tool_risk_overrides' },
      });
      if (overrides?.value) {
        const val = typeof overrides.value === 'string' ? JSON.parse(overrides.value) : overrides.value;
        if (Array.isArray(val.overrides)) {
          this.dbOverrides = val.overrides;
          this.logger.info({ count: this.dbOverrides.length }, '[HITL] Loaded DB risk overrides');
        }
      }
      this.dbOverridesLoaded = true;

      // Load user trust data from DB
      await this.loadUserTrust();

    } catch (error) {
      this.logger.warn({ error }, '[HITL] Failed to load config, using defaults');
    }
  }

  /**
   * Load user trust scores from DB
   */
  private async loadUserTrust(): Promise<void> {
    try {
      const trustConfig = await prisma.systemConfiguration.findFirst({
        where: { key: 'tool_user_trust' },
      });
      if (trustConfig?.value) {
        const val = typeof trustConfig.value === 'string' ? JSON.parse(trustConfig.value) : trustConfig.value;
        if (val.trust && typeof val.trust === 'object') {
          for (const [key, data] of Object.entries(val.trust)) {
            this.userToolTrust.set(key, data as UserToolTrust);
          }
          this.logger.info({ entries: this.userToolTrust.size }, '[HITL] Loaded user trust data');
        }
      }
    } catch {
      // No trust data yet
    }
  }

  /**
   * Flush user trust data to DB (called periodically or after decisions)
   */
  private async flushUserTrust(): Promise<void> {
    try {
      const trust: Record<string, UserToolTrust> = {};
      for (const [key, data] of this.userToolTrust) {
        trust[key] = data;
      }
      await prisma.systemConfiguration.upsert({
        where: { key: 'tool_user_trust' },
        create: {
          key: 'tool_user_trust',
          value: JSON.stringify({ trust }),
          description: 'User tool approval trust scores (learned from usage)',
        },
        update: {
          value: JSON.stringify({ trust }),
          updated_at: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn({ error }, '[HITL] Failed to flush user trust data');
    }
  }

  /**
   * Record a tool approval decision to update trust scores
   */
  private recordDecision(toolCall: ToolCallInfo, approved: boolean): void {
    const key = `${toolCall.userId}:${toolCall.toolName}`;
    const existing = this.userToolTrust.get(key) || {
      totalCalls: 0,
      approvedCalls: 0,
      deniedCalls: 0,
      lastUsed: 0,
      trustScore: 0,
    };

    existing.totalCalls++;
    if (approved) {
      existing.approvedCalls++;
    } else {
      existing.deniedCalls++;
    }
    existing.lastUsed = Date.now();

    // Calculate trust score (weighted: recent approvals matter more)
    // Simple: approval rate with a decay for denials
    if (existing.totalCalls > 0) {
      existing.trustScore = existing.approvedCalls / existing.totalCalls;
      // Penalize recent denials more heavily
      if (existing.deniedCalls > 0) {
        existing.trustScore *= Math.pow(0.9, existing.deniedCalls);
      }
    }

    this.userToolTrust.set(key, existing);

    // Flush every 10 decisions
    if (existing.totalCalls % 10 === 0) {
      this.flushUserTrust().catch(() => {});
    }
  }

  /**
   * Get user trust score for a specific tool
   */
  private getUserTrust(userId: string, toolName: string): UserToolTrust | undefined {
    return this.userToolTrust.get(`${userId}:${toolName}`);
  }

  /**
   * Evaluate a tool call and determine if approval is needed.
   * If approval is required, this method BLOCKS until approval or timeout.
   */
  async evaluate(toolCall: ToolCallInfo, emit: (event: string, data: unknown) => void): Promise<ApprovalResult> {
    const riskLevel = this.classifyRisk(toolCall);
    const userTrust = this.getUserTrust(toolCall.userId, toolCall.toolName);
    let requiresHuman = this.requiresApproval(riskLevel);

    // User trust override: if MEDIUM risk and user always approves this tool, auto-approve
    if (requiresHuman && riskLevel === 'medium' && userTrust) {
      if (userTrust.totalCalls >= this.minCallsForTrust && userTrust.trustScore >= this.trustThreshold) {
        this.logger.info({
          tool: toolCall.toolName,
          userId: toolCall.userId,
          trustScore: userTrust.trustScore,
          totalCalls: userTrust.totalCalls,
        }, '[HITL] Auto-approved via user trust (learned behavior)');

        this.recordDecision(toolCall, true);
        return {
          approved: true,
          riskLevel,
          reason: `Auto-approved — user always approves this tool (trust: ${(userTrust.trustScore * 100).toFixed(0)}%)`,
          requiresHuman: false,
          approvedBy: 'trust',
          trustScore: userTrust.trustScore,
        };
      }
    }

    this.logger.info({
      tool: toolCall.toolName,
      riskLevel,
      requiresHuman,
      userId: toolCall.userId,
      trustScore: userTrust?.trustScore,
    }, `[HITL] Tool risk: ${riskLevel}, approval: ${requiresHuman ? 'required' : 'auto'}`);

    if (!requiresHuman) {
      this.recordDecision(toolCall, true);
      return {
        approved: true,
        riskLevel,
        reason: 'Auto-approved (low risk)',
        requiresHuman: false,
        approvedBy: 'auto',
      };
    }

    // Create approval request
    const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: ApprovalRequest = {
      id: requestId,
      toolCall,
      riskLevel,
      reason: this.getRiskReason(toolCall, riskLevel),
      createdAt: Date.now(),
      expiresAt: Date.now() + this.defaultTimeoutMs,
    };

    this.pendingApprovals.set(requestId, request);

    // Emit SSE event to client — UI shows HITL approval popup
    emit('mcp_approval_required', {
      requestId,
      toolName: toolCall.toolName,
      serverName: toolCall.serverName,
      arguments: this.sanitizeArgsForDisplay(toolCall.arguments),
      riskLevel,
      reason: request.reason,
      timeoutMs: this.defaultTimeoutMs,
      trustScore: userTrust?.trustScore,
      totalCalls: userTrust?.totalCalls,
    });

    this.logger.info({ requestId, tool: toolCall.toolName }, '[HITL] Waiting for human approval');

    // Wait for approval or timeout
    const result = await this.waitForApproval(requestId, riskLevel);

    // Record the decision for learning
    this.recordDecision(toolCall, result.approved);

    return result;
  }

  /**
   * Submit an approval response (called from frontend via API/WebSocket).
   */
  submitApproval(requestId: string, approved: boolean, userId: string): boolean {
    const request = this.pendingApprovals.get(requestId);
    if (!request) {
      this.logger.warn({ requestId }, '[HITL] Approval for unknown request');
      return false;
    }

    this.pendingApprovals.delete(requestId);
    this.approvalEmitter.emit(requestId, { approved, userId });

    this.logger.info({
      requestId,
      approved,
      userId,
      tool: request.toolCall.toolName,
    }, `[HITL] Approval response: ${approved ? 'APPROVED' : 'DENIED'}`);

    return true;
  }

  /**
   * Classify the risk level of a tool call.
   *
   * Priority order:
   *  1. DB overrides (admin-set per-tool)
   *  2. Default patterns (hardcoded)
   *  3. Argument escalation
   */
  classifyRisk(toolCall: ToolCallInfo): RiskLevel {
    const { toolName, arguments: args } = toolCall;
    let risk: RiskLevel = 'low';

    // 1. Check DB overrides first (admin-configurable)
    const dbRisk = this.classifyFromDB(toolName);
    if (dbRisk !== null) {
      risk = dbRisk;
    } else {
      // 2. Fall back to default patterns
      if (DEFAULT_CRITICAL_RISK_PATTERNS.some(p => p.test(toolName))) {
        risk = 'critical';
      } else if (DEFAULT_HIGH_RISK_PATTERNS.some(p => p.test(toolName))) {
        risk = 'high';
      } else if (DEFAULT_MEDIUM_RISK_PATTERNS.some(p => p.test(toolName))) {
        risk = 'medium';
      } else if (DEFAULT_LOW_RISK_PATTERNS.some(p => p.test(toolName))) {
        risk = 'low';
      } else {
        // Unknown tools default to medium
        risk = 'medium';
      }
    }

    // 3. Check argument patterns for escalation (only escalates, never downgrades)
    const argsStr = JSON.stringify(args);
    for (const { pattern, escalateTo } of DANGEROUS_ARG_PATTERNS) {
      if (pattern.test(argsStr)) {
        const escalateOrder = { low: 0, medium: 1, high: 2, critical: 3 };
        if (escalateOrder[escalateTo] > escalateOrder[risk]) {
          this.logger.warn({
            tool: toolName,
            from: risk,
            to: escalateTo,
            pattern: pattern.source,
          }, '[HITL] Risk escalated by argument pattern');
          risk = escalateTo;
        }
      }
    }

    return risk;
  }

  /**
   * Check DB overrides for a tool name. Returns null if no override found.
   */
  private classifyFromDB(toolName: string): RiskLevel | null {
    if (!this.dbOverridesLoaded || this.dbOverrides.length === 0) return null;

    for (const override of this.dbOverrides) {
      try {
        const regex = new RegExp(override.pattern, 'i');
        if (regex.test(toolName)) {
          return override.riskLevel;
        }
      } catch {
        // Invalid regex pattern, skip
      }
    }
    return null;
  }

  /**
   * Get pending approval requests (for admin monitoring).
   */
  getPendingApprovals(): ApprovalRequest[] {
    const now = Date.now();
    for (const [id, req] of this.pendingApprovals) {
      if (now >= req.expiresAt) this.pendingApprovals.delete(id);
    }
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Get user trust data (for admin console).
   */
  getUserTrustData(): Record<string, UserToolTrust> {
    const data: Record<string, UserToolTrust> = {};
    for (const [key, trust] of this.userToolTrust) {
      data[key] = { ...trust };
    }
    return data;
  }

  /**
   * Admin API: Set tool risk override
   */
  async setToolRiskOverride(pattern: string, riskLevel: RiskLevel): Promise<void> {
    // Validate the pattern compiles
    new RegExp(pattern, 'i');

    // Remove existing override for same pattern
    this.dbOverrides = this.dbOverrides.filter(o => o.pattern !== pattern);
    this.dbOverrides.push({ pattern, riskLevel, source: 'admin' });

    // Persist to DB
    await prisma.systemConfiguration.upsert({
      where: { key: 'tool_risk_overrides' },
      create: {
        key: 'tool_risk_overrides',
        value: JSON.stringify({ overrides: this.dbOverrides }),
        description: 'Admin-configured tool risk level overrides',
      },
      update: {
        value: JSON.stringify({ overrides: this.dbOverrides }),
        updated_at: new Date(),
      },
    });

    this.logger.info({ pattern, riskLevel }, '[HITL] Tool risk override set');
  }

  /**
   * Admin API: Remove tool risk override
   */
  async removeToolRiskOverride(pattern: string): Promise<void> {
    this.dbOverrides = this.dbOverrides.filter(o => o.pattern !== pattern);

    await prisma.systemConfiguration.upsert({
      where: { key: 'tool_risk_overrides' },
      create: {
        key: 'tool_risk_overrides',
        value: JSON.stringify({ overrides: this.dbOverrides }),
        description: 'Admin-configured tool risk level overrides',
      },
      update: {
        value: JSON.stringify({ overrides: this.dbOverrides }),
        updated_at: new Date(),
      },
    });

    this.logger.info({ pattern }, '[HITL] Tool risk override removed');
  }

  /**
   * Admin API: Get all current overrides
   */
  getToolRiskOverrides(): ToolRiskOverride[] {
    return [...this.dbOverrides];
  }

  /**
   * Admin API: Reset user trust for a specific tool
   */
  async resetUserTrust(userId: string, toolName?: string): Promise<void> {
    if (toolName) {
      this.userToolTrust.delete(`${userId}:${toolName}`);
    } else {
      // Reset all trust for this user
      for (const key of this.userToolTrust.keys()) {
        if (key.startsWith(`${userId}:`)) {
          this.userToolTrust.delete(key);
        }
      }
    }
    await this.flushUserTrust();
    this.logger.info({ userId, toolName }, '[HITL] User trust reset');
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private requiresApproval(riskLevel: RiskLevel): boolean {
    switch (riskLevel) {
      case 'low': return false;
      case 'medium': return this.mediumRiskRequiresApproval;
      // HIGH and CRITICAL ALWAYS require approval — structural, not configurable
      case 'high': return true;
      case 'critical': return true;
    }
  }

  private waitForApproval(requestId: string, riskLevel: RiskLevel): Promise<ApprovalResult> {
    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        this.approvalEmitter.removeAllListeners(requestId);
        this.logger.warn({ requestId }, '[HITL] Approval timed out — auto-denied');
        resolve({
          approved: false,
          riskLevel,
          reason: 'Approval timed out — automatically denied',
          requiresHuman: true,
          approvedBy: 'timeout',
        });
      }, this.defaultTimeoutMs);

      this.approvalEmitter.once(requestId, (response: { approved: boolean; userId: string }) => {
        clearTimeout(timer);
        resolve({
          approved: response.approved,
          riskLevel,
          reason: response.approved ? 'Human approved' : 'Human denied',
          requiresHuman: true,
          approvedBy: response.userId,
          approvalTimeMs: Date.now() - (this.pendingApprovals.get(requestId)?.createdAt ?? Date.now()),
        });
      });
    });
  }

  private getRiskReason(toolCall: ToolCallInfo, riskLevel: RiskLevel): string {
    switch (riskLevel) {
      case 'critical': return `Critical operation: "${toolCall.toolName}" requires mandatory approval`;
      case 'high': return `High-risk operation: "${toolCall.toolName}" may modify resources`;
      case 'medium': return `Write operation: "${toolCall.toolName}" will make changes`;
      default: return `Tool call: "${toolCall.toolName}"`;
    }
  }

  private sanitizeArgsForDisplay(args: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (typeof value === 'string' && value.length > 500) {
        sanitized[key] = value.slice(0, 200) + '...[truncated]';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ToolApprovalGate | null = null;

export function getToolApprovalGate(logger: Logger): ToolApprovalGate {
  if (!_instance) {
    _instance = new ToolApprovalGate(logger);
    _instance.loadConfig().catch(() => {});
  }
  return _instance;
}
