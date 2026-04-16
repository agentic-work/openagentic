/**
 * ToolResultSummary - Smart rendering for Azure ARM and other tool results
 *
 * Parses structured JSON results from Azure ARM operations and renders
 * a human-readable one-line summary instead of raw JSON.
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

// Azure resource type → icon mapping
const RESOURCE_ICONS: Record<string, React.FC<{ className?: string }>> = {
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
};

// Get icon for a resource type
function getResourceIcon(resourceType?: string): React.FC<{ className?: string }> {
  if (!resourceType) return Cloud;
  for (const [pattern, icon] of Object.entries(RESOURCE_ICONS)) {
    if (resourceType.includes(pattern)) return icon;
  }
  return Cloud;
}

// Extract provisioning state color
function getStateColor(state?: string): string {
  if (!state) return 'text-[var(--color-textMuted)]';
  const lower = state.toLowerCase();
  if (lower === 'succeeded' || lower === 'completed') return 'text-[var(--color-success)]';
  if (lower === 'failed' || lower === 'canceled' || lower === 'cancelled') return 'text-[var(--color-error)]';
  if (lower === 'creating' || lower === 'updating' || lower === 'deleting') return 'text-amber-500';
  return 'text-[var(--color-textMuted)]';
}

// Extract HTTP method badge color
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

// Parse Azure ARM result into summary
function parseAzureResult(output: any): {
  summary: string;
  resourceType?: string;
  resourceName?: string;
  location?: string;
  provisioningState?: string;
  isLRO?: boolean;
  totalWaitTime?: number;
  itemCount?: number;
} | null {
  if (!output || typeof output !== 'object') return null;

  const result = output.result || output;

  // Handle list responses (value array)
  if (result?.value && Array.isArray(result.value)) {
    const items = result.value;
    const count = items.length;
    // Try to determine resource type from first item
    const firstType = items[0]?.type;
    const typeName = firstType ? firstType.split('/').pop() : 'resources';
    return {
      summary: `${count} ${typeName} found`,
      itemCount: count,
      resourceType: firstType,
    };
  }

  // Handle single resource response
  if (result?.type || result?.properties?.provisioningState) {
    const name = result.name || result.id?.split('/').pop();
    const type = result.type;
    const location = result.location;
    const state = result.properties?.provisioningState;

    let summary = '';
    if (name) summary += name;
    if (state) summary += ` — ${state}`;
    if (location) summary += ` (${location})`;
    if (output.total_wait_time) summary += ` — ${output.total_wait_time}s`;

    return {
      summary,
      resourceType: type,
      resourceName: name,
      location,
      provisioningState: state,
      isLRO: output.is_long_running,
      totalWaitTime: output.total_wait_time,
    };
  }

  // Handle LRO-specific fields from azure_arm_execute_and_wait
  if (output.provisioning_state) {
    return {
      summary: `${output.provisioning_state}${output.total_wait_time ? ` (${output.total_wait_time}s)` : ''}`,
      provisioningState: output.provisioning_state,
      totalWaitTime: output.total_wait_time,
    };
  }

  return null;
}

export const ToolResultSummary: React.FC<ToolResultSummaryProps> = ({
  toolName,
  output,
  className = '',
}) => {
  const isAzureTool = toolName.includes('azure_arm') || toolName.includes('azure_');

  const parsed = useMemo(() => {
    if (!isAzureTool || !output) return null;
    const data = typeof output === 'string' ? (() => { try { return JSON.parse(output); } catch { return null; } })() : output;
    if (!data) return null;
    return parseAzureResult(data);
  }, [isAzureTool, output]);

  if (!parsed) return null;

  const IconComponent = getResourceIcon(parsed.resourceType);

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
