/**
 * ToolResultSummary - Smart one-line summary for ANY MCP tool that CRUDs
 *
 * Renders a compact inline chip under the ToolCallCard header describing what
 * the tool actually did — e.g. "resource group: rg-aw-fd-abc123 — Succeeded (eastus)"
 * or "5 virtual_networks · vnet-a, vnet-b, vnet-c +2 more".
 *
 * Works across any MCP following the conventional wrapper shape:
 *   { success: true, <resource_name>: {...}, executed_as: {...} }        // singleton
 *   { success: true, <resource_names>: [...], count: N, executed_as: {} } // list
 *   { success: false, error: "..." }                                     // failure
 *
 * Also falls back to raw ARM / AWS SDK shapes when the wrapper isn't there.
 */

import React, { useMemo } from 'react';
import {
  Cloud,
  Server,
  Globe,
  Shield,
  Database,
  Key,
  HardDrive,
} from '@/shared/icons';

interface ToolResultSummaryProps {
  toolName: string;
  output: unknown;
  className?: string;
}

// Resource-type (or tool-name) → icon mapping. Patterns are substring-matched.
const RESOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  // Azure
  'Microsoft.Network/applicationGateways': Globe,
  'Microsoft.Network/virtualNetworks': Globe,
  'Microsoft.Network/networkSecurityGroups': Shield,
  'Microsoft.Network/publicIPAddresses': Globe,
  'Microsoft.Network/loadBalancers': Globe,
  'Microsoft.Compute/virtualMachines': Server,
  'Microsoft.Compute/virtualMachineScaleSets': Server,
  'Microsoft.ContainerService/managedClusters': Server,
  'Microsoft.Storage/storageAccounts': HardDrive,
  'Microsoft.KeyVault/vaults': Key,
  'Microsoft.Sql/servers': Database,
  'Microsoft.DocumentDB/databaseAccounts': Database,
  'Microsoft.Web/sites': Globe,
  'Microsoft.Cdn/profiles': Globe,
  // Heuristic keywords
  'key_vault': Key,
  'vault': Key,
  'secret': Key,
  'database': Database,
  'db': Database,
  'storage': HardDrive,
  'bucket': HardDrive,
  's3': HardDrive,
  'vm': Server,
  'instance': Server,
  'cluster': Server,
  'function': Server,
  'container': Server,
  'network': Globe,
  'vnet': Globe,
  'subnet': Globe,
  'firewall': Shield,
  'nsg': Shield,
  'role': Shield,
  'policy': Shield,
};

function getResourceIcon(resourceTypeOrHint?: string): React.FC<{ className?: string }> {
  if (!resourceTypeOrHint) return Cloud;
  const lower = resourceTypeOrHint.toLowerCase();
  for (const [pattern, icon] of Object.entries(RESOURCE_ICONS)) {
    if (lower.includes(pattern.toLowerCase())) return icon;
  }
  return Cloud;
}

function getStateColor(state?: string): string {
  if (!state) return 'text-[var(--color-textMuted)]';
  const lower = state.toLowerCase();
  if (lower === 'succeeded' || lower === 'completed' || lower === 'available' || lower === 'running' || lower === 'active' || lower === 'healthy' || lower === 'ok')
    return 'text-[var(--color-success)]';
  if (lower === 'failed' || lower === 'canceled' || lower === 'cancelled' || lower === 'error' || lower === 'unhealthy' || lower === 'degraded')
    return 'text-[var(--color-error)]';
  if (lower === 'creating' || lower === 'updating' || lower === 'deleting' || lower === 'pending' || lower === 'provisioning' || lower === 'in_progress')
    return 'text-amber-500';
  return 'text-[var(--color-textMuted)]';
}

function getMethodBadgeColor(method?: string): string {
  if (!method) return '';
  switch (method.toUpperCase()) {
    case 'PUT': return 'bg-blue-500/20 text-blue-400';
    case 'POST': return 'bg-green-500/20 text-green-400';
    case 'DELETE': return 'bg-red-500/20 text-red-400';
    case 'PATCH': return 'bg-amber-500/20 text-amber-400';
    default: return 'bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)]';
  }
}

// Fields that MCP wrappers commonly add alongside the resource payload — skip them
// when scanning for "which key holds the resource?".
const RESERVED_WRAPPER_KEYS = new Set([
  'success', 'error', 'error_type', 'hint', 'status_code', 'code',
  'executed_as', 'subscription_id', 'tenant_id', 'resource_group',
  'filters', 'summary', 'count', 'total', 'result', 'raw',
  'is_long_running', 'total_wait_time', 'provisioning_state',
  'location', 'region', 'tags', 'id', 'type',
  'method', 'url', 'request_id', 'timestamp', 'body',
  'message', 'warnings', 'notes', 'meta',
]);

// Convert a snake_case resource key to a human label ("app_gateway" → "app gateway").
function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').trim();
}

// Look for any singleton resource object on the output that has a name-ish identifier.
function findSingletonResource(output: any): { key: string; obj: any } | null {
  for (const [key, value] of Object.entries(output)) {
    if (RESERVED_WRAPPER_KEYS.has(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const obj = value as any;
    // Match ANYTHING that looks like a resource: has one of these ident fields.
    if (obj.name || obj.id || obj.arn || obj.display_name || obj.displayName || obj.uri || obj.url || obj.endpoint || obj.host_name || obj.hostName) {
      return { key, obj };
    }
  }
  return null;
}

// Look for any list of resources on the output.
function findListResource(output: any): { key: string; items: any[]; count: number } | null {
  for (const [key, value] of Object.entries(output)) {
    if (RESERVED_WRAPPER_KEYS.has(key)) continue;
    if (!Array.isArray(value)) continue;
    if (value.length === 0) {
      // Empty list — still a valid result if `count` is also 0
      if (output.count === 0 || value.length === 0) {
        return { key, items: value, count: 0 };
      }
      continue;
    }
    const first = value[0];
    // Is this a list of resources? (as opposed to e.g. a string list)
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return {
        key,
        items: value,
        count: typeof output.count === 'number' ? output.count : value.length,
      };
    }
  }
  return null;
}

// Collect a short list of "interesting" fields from a resource object for inline display.
function extractInterestingFields(obj: any): string[] {
  const extras: string[] = [];
  const PICKS: Array<{ key: string; fmt?: (v: any) => string }> = [
    { key: 'sku',                fmt: (v) => typeof v === 'string' ? v : (v?.name || v?.tier || '') },
    { key: 'tier' },
    { key: 'frontend_ip',        fmt: (v) => `ip ${v}` },
    { key: 'public_ip',          fmt: (v) => `ip ${v}` },
    { key: 'private_ip',         fmt: (v) => `priv ${v}` },
    { key: 'ip_address',         fmt: (v) => `ip ${v}` },
    { key: 'endpoint' },
    { key: 'host_name' },
    { key: 'hostName' },
    { key: 'uri' },
    { key: 'url' },
    { key: 'arn' },
    { key: 'address_space',      fmt: (v) => Array.isArray(v) ? v.join(',') : String(v) },
    { key: 'address_prefix' },
    { key: 'cidr' },
    { key: 'backend_pool_count', fmt: (v) => `${v} pools` },
    { key: 'rule_count',         fmt: (v) => `${v} rules` },
    { key: 'subnets',            fmt: (v) => Array.isArray(v) ? `${v.length} subnets` : '' },
    { key: 'capacity',           fmt: (v) => `cap ${v}` },
    { key: 'size' },
    { key: 'runtime' },
    { key: 'version' },
    { key: 'kind' },
  ];
  for (const { key, fmt } of PICKS) {
    if (obj[key] === undefined || obj[key] === null) continue;
    const val = obj[key];
    const str = fmt ? fmt(val) : String(val);
    if (str) extras.push(str);
    if (extras.length >= 3) break;
  }
  return extras;
}

interface ParsedResult {
  summary: string;
  resourceType?: string;
  resourceName?: string;
  location?: string;
  provisioningState?: string;
  isLRO?: boolean;
  totalWaitTime?: number;
  itemCount?: number;
}

function parseCrudResult(output: any, toolName: string): ParsedResult | null {
  if (!output || typeof output !== 'object') return null;

  // 1) Surface tool errors first
  if (output.success === false && output.error) {
    return {
      summary: `error: ${String(output.error).slice(0, 140)}`,
      provisioningState: 'Failed',
    };
  }

  // Unwrap common nesting (.result) before further scanning
  const inner = (output.result && typeof output.result === 'object' && !Array.isArray(output.result))
    ? { ...output, ...output.result }
    : output;

  // 2) TYPED-TOOL SINGLETON: pick any nested resource object with a name-ish field
  const singleton = findSingletonResource(inner);
  if (singleton) {
    const { key, obj } = singleton;
    const label = humanizeKey(key);
    const name = obj.name || obj.display_name || obj.displayName || obj.arn || (obj.id ? String(obj.id).split('/').pop() : undefined);
    const state = obj.provisioning_state || obj.provisioningState || obj.state || obj.status;
    const loc = obj.location || obj.region;
    const extras = extractInterestingFields(obj);
    let summary = `${label}: ${name ?? '<unknown>'}`;
    if (state) summary += ` — ${state}`;
    if (loc) summary += ` (${loc})`;
    if (extras.length) summary += ` · ${extras.join(' · ')}`;
    return {
      summary,
      resourceType: obj.type || key,
      resourceName: name,
      location: loc,
      provisioningState: state,
    };
  }

  // 3) TYPED-TOOL LIST: pick any array of resources
  const list = findListResource(inner);
  if (list) {
    const label = humanizeKey(list.key);
    const names = list.items
      .slice(0, 3)
      .map((it: any) => it?.name || it?.display_name || it?.displayName || it?.arn || (it?.id ? String(it.id).split('/').pop() : '?'))
      .filter(Boolean);
    const preview = names.length
      ? ` · ${names.join(', ')}${list.count > names.length ? ` +${list.count - names.length} more` : ''}`
      : '';
    return {
      summary: `${list.count} ${label}${preview}`,
      itemCount: list.count,
      resourceType: list.items[0]?.type || list.key,
    };
  }

  // 4) RAW ARM SHAPE: list via .value[]
  if (Array.isArray(inner?.value)) {
    const items = inner.value;
    const firstType = items[0]?.type;
    const typeName = firstType ? firstType.split('/').pop() : 'resources';
    return {
      summary: `${items.length} ${typeName} found`,
      itemCount: items.length,
      resourceType: firstType,
    };
  }

  // 5) RAW ARM SHAPE: singleton via .type or .properties.provisioningState
  if (inner?.type || inner?.properties?.provisioningState) {
    const name = inner.name || inner.id?.split('/').pop();
    const state = inner.properties?.provisioningState || inner.provisioningState;
    let summary = '';
    if (name) summary += name;
    if (state) summary += ` — ${state}`;
    if (inner.location) summary += ` (${inner.location})`;
    if (output.total_wait_time) summary += ` — ${output.total_wait_time}s`;
    return {
      summary,
      resourceType: inner.type,
      resourceName: name,
      location: inner.location,
      provisioningState: state,
      isLRO: output.is_long_running,
      totalWaitTime: output.total_wait_time,
    };
  }

  // 6) LRO-only
  if (output.provisioning_state) {
    return {
      summary: `${output.provisioning_state}${output.total_wait_time ? ` (${output.total_wait_time}s)` : ''}`,
      provisioningState: output.provisioning_state,
      totalWaitTime: output.total_wait_time,
    };
  }

  // 7) Generic success with count (no list key found)
  if (output.success === true && typeof output.count === 'number') {
    return { summary: `${output.count} items`, itemCount: output.count };
  }

  // 8) Last resort: if output has `success` and a top-level `name`, surface it
  if (output.success === true && output.name) {
    return {
      summary: String(output.name),
      resourceName: String(output.name),
      provisioningState: output.state || output.status,
    };
  }

  return null;
}

// Looser gate: any tool that looks like an MCP CRUD call. We still skip very
// short "trivial" tool names (< 3 chars) and obvious non-CRUD helpers.
function looksLikeMcpCrudTool(toolName: string): boolean {
  if (!toolName || toolName.length < 3) return false;
  // Anything with an underscore or dot (namespace) is fair game — MCP tools all use snake_case/namespace.
  if (toolName.includes('_') || toolName.includes('.')) return true;
  return false;
}

export const ToolResultSummary: React.FC<ToolResultSummaryProps> = ({
  toolName,
  output,
  className = '',
}) => {
  const parsed = useMemo(() => {
    if (!output || !looksLikeMcpCrudTool(toolName)) return null;
    const data = typeof output === 'string'
      ? (() => { try { return JSON.parse(output); } catch { return null; } })()
      : output;
    if (!data || typeof data !== 'object') return null;
    return parseCrudResult(data, toolName);
  }, [toolName, output]);

  if (!parsed) return null;

  // Prefer an icon matched against the specific resource type, else fall back to the tool name as a hint.
  const IconComponent = getResourceIcon(parsed.resourceType || toolName);

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border)]/20 ${className}`}>
      <IconComponent className="w-3.5 h-3.5 text-[var(--color-textMuted)] flex-shrink-0" />
      {parsed.provisioningState && (
        <span className={`text-xs font-medium ${getStateColor(parsed.provisioningState)}`}>
          {parsed.provisioningState}
        </span>
      )}
      <span className="text-xs text-[var(--color-textSecondary)] truncate">
        {parsed.summary}
      </span>
      {parsed.itemCount !== undefined && (
        <span className="text-xs text-[var(--color-textMuted)] ml-auto flex-shrink-0">
          {parsed.itemCount} items
        </span>
      )}
    </div>
  );
};

// Operation type badge component
export const OperationBadge: React.FC<{ method?: string }> = ({ method }) => {
  if (!method || method.toUpperCase() === 'GET') return null;
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getMethodBadgeColor(method)}`}>
      {method.toUpperCase()}
    </span>
  );
};

export default ToolResultSummary;
