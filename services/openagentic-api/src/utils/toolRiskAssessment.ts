/**
 * Tool Risk Assessment Utilities
 * 
 * Provides security risk assessment for MCP tools and AI model capabilities.
 * Evaluates potential security risks, required permissions, and safety levels
 * for tool execution in chat environments.
 * 

 */

export interface ToolRisk {
  risks: string[];
  permissions?: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Assess the risks associated with a tool execution
 */
export function assessToolRisks(toolName: string, args: any): ToolRisk {
  const risks: string[] = [];
  const permissions: string[] = [];
  let severity: 'low' | 'medium' | 'high' = 'low';

  // File system operations
  if (toolName.includes('write') || toolName.includes('create')) {
    risks.push('This operation will create or modify files');
    permissions.push('File Write');
    severity = 'medium';
  }

  if (toolName.includes('delete') || toolName.includes('remove')) {
    risks.push('This operation will DELETE files or data');
    permissions.push('File Delete');
    severity = 'high';
  }

  if (toolName.includes('read') || toolName.includes('list')) {
    risks.push('This operation will read file contents');
    permissions.push('File Read');
  }

  // Code execution
  if (toolName.includes('exec') || toolName.includes('run') || toolName.includes('eval')) {
    risks.push('This operation will EXECUTE CODE on the system');
    permissions.push('Code Execution');
    severity = 'high';
  }

  // Network operations
  if (toolName.includes('fetch') || toolName.includes('request') || toolName.includes('http')) {
    risks.push('This operation will make network requests');
    permissions.push('Network Access');
    severity = 'medium';
  }

  // Database operations
  if (toolName.includes('query') || toolName.includes('database') || toolName.includes('sql')) {
    risks.push('This operation will access database');
    permissions.push('Database Access');
    severity = 'medium';
  }

  // Azure specific operations
  if (toolName.startsWith('azure_')) {
    risks.push('This operation will access your Azure resources');
    permissions.push('Azure API Access');
    
    if (toolName.includes('create') || toolName.includes('deploy')) {
      risks.push('This may incur Azure costs');
      severity = 'high';
    }
    
    if (toolName.includes('delete') || toolName.includes('remove')) {
      risks.push('This will DELETE Azure resources');
      severity = 'high';
    }
  }

  // Sequential thinking operations
  if (toolName.includes('sequential_thinking')) {
    risks.push('This will use sequential reasoning to solve the problem');
    permissions.push('Reasoning Engine');
    severity = 'low';
  }

  // Check arguments for additional risks
  if (args) {
    // Check for paths pointing outside safe directories
    const pathArgs = ['path', 'filepath', 'filename', 'directory', 'dir'];
    for (const key of pathArgs) {
      if (args[key] && typeof args[key] === 'string') {
        const path = args[key];
        if (path.includes('..') || path.startsWith('/etc') || path.startsWith('/sys')) {
          risks.push('⚠️ Attempting to access system directories');
          severity = 'high';
        }
      }
    }

    // Check for potentially dangerous commands
    if (args.command && typeof args.command === 'string') {
      const dangerous = ['rm', 'del', 'format', 'sudo', 'chmod', 'chown'];
      if (dangerous.some(cmd => args.command.includes(cmd))) {
        risks.push('⚠️ Command contains potentially dangerous operations');
        severity = 'high';
      }
    }
  }

  // Default risk if none identified
  if (risks.length === 0) {
    risks.push('This operation will execute an external tool');
    permissions.push('Tool Execution');
  }

  return { risks, permissions, severity };
}

/**
 * Format tool arguments for display
 */
export function formatToolArguments(args: any): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
