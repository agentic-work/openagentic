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
 * SecurityAnalyzer — risk classification for tool calls in openagentic-proxy.
 *
 * IMPORTANT: These risk patterns MUST stay in sync with the canonical classifier
 * in services/openagentic-api/src/services/ToolApprovalGate.ts. The two services
 * share the same regex shape so that a tool call gets the same risk level whether
 * it goes through the inline chat ReAct loop (API) or the sub-agent path (proxy).
 *
 * If you change these patterns, change them in both places. We duplicate rather
 * than share-as-package because openagentic-proxy and the API have separate Docker
 * images and build pipelines, and a shared package would couple them too tightly.
 *
 * On a denial: AgentRunner translates the result into a tool-result message saying
 * "Tool X denied (risk: HIGH). Reason: ...". The cloud_operations system prompt
 * (cloud-ops-hitl-denial module) tells the LLM how to react: do not retry, do not
 * try a workaround tool that achieves the same effect, ask the user how to proceed.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
  requiresApproval: boolean;
}

// ─── Risk patterns (mirror of ToolApprovalGate.ts in the API) ──────────────

const LOW_RISK_PATTERNS = [
  /^(?:list|get|describe|show|search|find|read|query|count|check|status|health|info|version|whoami)_/i,
  /^web_/i,
  /^memory_/i,
  /^diagram_/i,
  /^k8s_(?:list|get|describe|cluster_health|status|version|current_context|explain|rollout_status|rollout_history)/i,
  /^admin_(?:system|list|get|show|check|status|health|metrics|version|info)/i,
  /^(?:aws|azure|gcp)_(?:list|get|describe|cost|show|status|health|info|query|identity|help)/i,
  /^azure_graph_(?:list|get|query|search|execute)$/i,
  /^helm_(?:list|status|history|get_values)$/i,
  /^(?:loki|prometheus)_/i,
  /^(?:suggest_|search_tool|list_available|get_tool)/i,
  /^(?:get_|list_|search_)(?:repo|issue|pull|commit|branch|workflow|code|file|user)/i,
  /^vertex_ai_(?:list|get|usage)/i,
  /^suggest_aws_commands$/i,
  /^aws_identity$/i,
  /^synth_/i,
  // Cloud-ops-specific reads added in this release
  /^azure_resource_graph_query(?:_tenant_wide)?$/i,
  /^azure_advisor_recommendations$/i,
  /^azure_service_health_events$/i,
  /^azure_list_(?:public_facing_resources|management_groups|subscriptions_in_management_group|web_apps|front_doors)$/i,
  /^azure_(?:get|show|describe)_/i,
  /^azure_cost_(?:query|forecast|by_service|by_resource|by_tag)(?:_for_resource_group)?$/i,
  /^aws_(?:cost|describe|get|list|search|query)_/i,
];

const MEDIUM_RISK_PATTERNS = [
  /^(?:create|update|put|patch|send|post|upload|deploy|start|stop|restart)_/i,
  /^(?:email|notify|message|alert)_/i,
  /^k8s_(?:create|apply|scale|restart|cordon|uncordon|patch|label|annotate)/i,
  /^admin_(?:create|update|delete|set|configure|enable|disable)/i,
  /^(?:aws|azure|gcp)_(?:create|update|modify|start|stop|restart|set)/i,
  /^azure_arm_execute$/i,
  /^azure_arm_execute_and_wait$/i,
  /^gcp_api_execute$/i,
  /^openagentic_/i,
  /^helm_(?:install|upgrade|rollback|uninstall)$/i,
  /^(?:create_issue|create_pull_request|update_issue|trigger_workflow)$/i,
  /^web_store_knowledge$/i,
];

const HIGH_RISK_PATTERNS = [
  /^(?:execute|run|exec|eval|shell|bash|cmd|command)_/i,
  /^(?:write|delete|remove|drop|truncate|destroy|purge)_/i,
  /^(?:file_write|file_delete|fs_write)$/i,
  /^(?:aws_|gcp_)(?:delete|destroy|remove|purge)/i,
  /^azure_(?:delete)/i,
  /^k8s_(?:delete|drain|cleanup)/i,
  /^credential_/i,
  /^call_aws$/i,
];

const CRITICAL_RISK_PATTERNS = [
  /^(?:bulk|mass|batch)_/i,
  /^(?:infrastructure|iam|permission|role|policy)_(?:delete|modify|create)/i,
  /^(?:database|db)_(?:drop|delete|migrate|execute)/i,
];

const DANGEROUS_ARG_PATTERNS: Array<{ pattern: RegExp; escalateTo: RiskLevel }> = [
  { pattern: /rm\s+-rf/i, escalateTo: 'critical' },
  { pattern: /DROP\s+(?:TABLE|DATABASE)/i, escalateTo: 'critical' },
  { pattern: /DELETE\s+FROM\s+\w+\s*(?:WHERE\s+1\s*=\s*1)?$/i, escalateTo: 'critical' },
  { pattern: /(?:chmod|chown)\s+.*?(?:777|666)/i, escalateTo: 'high' },
  { pattern: /curl\s+.*?\|\s*(?:bash|sh)/i, escalateTo: 'critical' },
  { pattern: /--force|--hard|--no-verify/i, escalateTo: 'high' },
];

const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function matchesAny(toolName: string, patterns: RegExp[]): boolean {
  for (const p of patterns) {
    if (p.test(toolName)) return true;
  }
  return false;
}

function escalateFromArgs(currentLevel: RiskLevel, args: Record<string, any>): RiskLevel {
  let level = currentLevel;
  const argsStr = JSON.stringify(args || {});
  for (const { pattern, escalateTo } of DANGEROUS_ARG_PATTERNS) {
    if (pattern.test(argsStr) && RISK_RANK[escalateTo] > RISK_RANK[level]) {
      level = escalateTo;
    }
  }
  return level;
}

export class SecurityAnalyzer {
  /**
   * Whether MEDIUM risk requires human approval. Defaults to TRUE (matching the
   * API ToolApprovalGate default — every CRUD/write tool requires HITL). The
   * spawn request can override this per-execution if needed.
   */
  private mediumRiskRequiresApproval: boolean;

  constructor(opts?: { mediumRiskRequiresApproval?: boolean }) {
    this.mediumRiskRequiresApproval = opts?.mediumRiskRequiresApproval ?? true;
  }

  assess(toolName: string, args: Record<string, any>): RiskAssessment {
    const name = (toolName || '').toString();

    let level: RiskLevel = 'low';
    let reason = 'Read-only or low-risk operation';

    if (matchesAny(name, CRITICAL_RISK_PATTERNS)) {
      level = 'critical';
      reason = `Tool '${name}' matches critical-risk pattern (bulk/permission/destructive)`;
    } else if (matchesAny(name, HIGH_RISK_PATTERNS)) {
      level = 'high';
      reason = `Tool '${name}' matches high-risk pattern (delete/execute/credential)`;
    } else if (matchesAny(name, MEDIUM_RISK_PATTERNS)) {
      level = 'medium';
      reason = `Tool '${name}' matches medium-risk pattern (create/update/CRUD/cloud mutation)`;
    } else if (matchesAny(name, LOW_RISK_PATTERNS)) {
      level = 'low';
      reason = `Tool '${name}' is a low-risk read-only operation`;
    } else {
      // Unknown tool — default to medium so a human approves before execution.
      // Better to over-approve than to silently let a new write tool slip through.
      level = 'medium';
      reason = `Tool '${name}' is unclassified — defaulting to medium-risk for safety`;
    }

    // Argument-based escalation (e.g., rm -rf, DROP TABLE in args)
    level = escalateFromArgs(level, args || {});

    const requiresApproval =
      level === 'critical' ||
      level === 'high' ||
      (level === 'medium' && this.mediumRiskRequiresApproval);

    return { level, reason, requiresApproval };
  }
}
