/**
 * Synth (Tool Synthesis) Execution Helper
 *
 * Handles dynamic tool synthesis and execution via Synth.
 * Synth allows the LLM to synthesize one-shot tools for tasks outside built-in capabilities.
 *
 * CRITICAL SECURITY:
 * - Tools ONLY run as the authenticated user (no service accounts)
 * - Credentials come from user's SSO provider
 * - Session-based OAuth for services like GitHub
 */

import type { Logger } from 'pino';
import { SynthService, type SynthRequest, type SynthResult } from '../../../services/SynthService.js';
import type { ToolExecutionResult } from './tool-execution.helper.js';

// Default logger for Synth (replaced when logger is provided)
import pino from 'pino';
const defaultLogger = pino({ name: 'synth-execution' });

/**
 * Get Synth service instance (singleton pattern)
 */
export function getSynthService(logger?: Logger): SynthService {
  return SynthService.getInstance(logger || defaultLogger);
}

/**
 * Check if Synth should be visible to the LLM
 * Returns true if Synth is both enabled AND visibleToLLM is true
 *
 * This allows admins to:
 * - enabled=true, visibleToLLM=true: Synth works normally
 * - enabled=true, visibleToLLM=false: Synth enabled but hidden from LLM (for testing/maintenance)
 * - enabled=false: Synth completely disabled
 */
export function isSynthVisibleToLLM(logger?: Logger): boolean {
  const synthService = getSynthService(logger);
  const config = synthService.getConfig();

  // Both enabled AND visibleToLLM must be true for LLM to see Synth
  return config.enabled && config.visibleToLLM;
}

/**
 * Check if a tool call is a Synth synthesis request
 * The LLM can call 'synth_synthesize' to dynamically create a tool
 */
export function isSynthTool(toolName: string): boolean {
  return toolName === 'synth_synthesize' ||
    toolName === 'synth_execute' ||
    toolName === 'synthesize_tool';
}

/**
 * Get Synth tool definitions to include in available tools
 * This allows the LLM to know it can synthesize tools on-demand
 */
export function getSynthToolDefinitions(): any[] {
  return [
    {
      type: 'function',
      function: {
        name: 'synth_synthesize',
        description: `ABSOLUTE LAST RESORT ONLY. You MUST check all available MCP tools FIRST before even considering this tool.

NEVER use this for:
- Azure operations (use the typed azure_create_*, azure_list_*, azure_get_* tools)
- AWS operations (use aws_*, call_aws)
- Kubernetes operations (use k8s_*)
- GitHub operations (use github_*)
- Web search (use web_search)
- Prometheus/Loki queries (use prometheus_*, loki_*)

ONLY use this for tasks where NO MCP tool exists:
- File format conversion (PDF→DOCX, CSV→JSON)
- Document analysis of uploaded files
- Custom math/statistics computations
- REST API calls to services without a dedicated MCP tool

On-demand Agent Tool (OAT): Synthesize and execute Python code in a secure sandbox.

IMPORTANT — Human-In-The-Middle (HITM):
- Low-risk operations (read-only, data transforms): auto-approved
- Medium-risk (API calls, file writes): may need approval
- High-risk (cloud modifications, credential access): ALWAYS requires human approval
- Tell the user when approval is needed and what the risk level is

When the user uploads a file (PDF, image, document), use this tool with the file_data parameter to process it.
The sandbox has Python 3.11 with common libraries (requests, pandas, python-docx, reportlab, Pillow, etc.)`,
        parameters: {
          type: 'object',
          required: ['intent'],
          properties: {
            intent: {
              type: 'string',
              description: 'Natural language description of what you want to accomplish. Be specific about inputs, expected outputs, and any constraints. When processing uploaded files, describe the file and desired output format.',
            },
            capabilities: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['http', 'json', 'datetime', 'github', 'slack', 'aws', 'azure', 'gcp', 'file_processing'],
              },
              description: 'Capabilities to use. Include "file_processing" when working with uploaded documents/files.',
            },
            file_data: {
              type: 'string',
              description: 'Base64-encoded file content from user upload. Pass the uploaded file data here for processing.',
            },
            file_name: {
              type: 'string',
              description: 'Original filename of the uploaded file (e.g., "report.pdf", "data.csv")',
            },
            file_type: {
              type: 'string',
              description: 'MIME type of the uploaded file (e.g., "application/pdf", "text/csv")',
            },
            dry_run: {
              type: 'boolean',
              default: false,
              description: 'If true, only show the generated code without executing. Use this to preview before running.',
            },
          },
        },
      },
    },
  ];
}

/**
 * Context for Synth tool execution
 */
export interface SynthExecutionContext {
  userId: string;
  userEmail: string;
  sessionId?: string;
  ssoProvider?: string; // 'azure_ad', 'google', 'aws_sso', 'github', 'local'
  cloudCredentials?: {
    aws?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
    azure?: { accessToken: string; tenantId: string };
    gcp?: { accessToken: string; projectId?: string };
    github?: { token: string };
  };
  logger: Logger;
}

/**
 * Execute a Synth tool call
 */
export async function executeSynthToolCall(
  toolCallId: string,
  toolName: string,
  toolArgs: any,
  context: SynthExecutionContext
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const { logger } = context;

  logger.info({
    toolCallId,
    toolName,
    intent: toolArgs.intent?.substring(0, 100),
    userId: context.userId,
    ssoProvider: context.ssoProvider,
  }, '[SYNTH] Starting Synth tool execution');

  const synthService = getSynthService(logger);

  try {
    // Build synthesis request
    const synthesisRequest: SynthRequest = {
      intent: toolArgs.intent,
      userId: context.userId,
      userEmail: context.userEmail,
      capabilities: toolArgs.capabilities,
      dryRun: toolArgs.dry_run || false,
      sessionId: context.sessionId,
      credentials: context.cloudCredentials,
      // File attachment support — pass uploaded file data to sandbox
      ...(toolArgs.file_data ? {
        files: [{
          name: toolArgs.file_name || 'uploaded_file',
          type: toolArgs.file_type || 'application/octet-stream',
          data: toolArgs.file_data,
        }],
      } : {}),
    };

    // Execute synthesis
    const result = await synthService.synthesize(synthesisRequest);

    const executionTimeMs = Date.now() - startTime;

    // Log result
    logger.info({
      toolCallId,
      success: result.success,
      riskLevel: result.tool?.riskLevel,
      executionTimeMs,
      costUsd: result.metrics?.costUsd,
    }, '[SYNTH] Synth tool execution completed');

    // When approval is required, return a clear blocking message to the LLM
    if (result.approval?.required && !result.approval?.approved) {
      return {
        toolCallId,
        toolName,
        result: { status: 'pending_approval', riskLevel: result.tool?.riskLevel },
        processedResult: `⚠️ HUMAN APPROVAL REQUIRED — This operation was classified as ${result.tool?.riskLevel || 'high'} risk. ` +
          `Execution is PAUSED until the user approves or denies in the approval dialog. ` +
          `Do NOT proceed or retry. Wait for the user to respond.`,
        serverName: 'synth',
        executedOn: 'synth-sandbox',
        executionTimeMs,
      };
    }

    // Format result for LLM
    if (result.success) {
      return {
        toolCallId,
        toolName,
        result: result.result,
        processedResult: formatSynthResultForLLM(result),
        serverName: 'synth',
        executedOn: 'synth-sandbox',
        executionTimeMs,
      };
    } else {
      return {
        toolCallId,
        toolName,
        result: { error: result.error },
        processedResult: `Synth Error: ${result.error}\n\nRisk Level: ${result.tool?.riskLevel || 'unknown'}\n\nIf this was a high-risk operation, human approval may be required.`,
        serverName: 'synth',
        executedOn: 'synth-sandbox',
        executionTimeMs,
      };
    }
  } catch (error: any) {
    const executionTimeMs = Date.now() - startTime;

    logger.error({
      toolCallId,
      error: error.message,
      stack: error.stack,
    }, '[SYNTH] Synth tool execution failed');

    return {
      toolCallId,
      toolName,
      result: { error: error.message },
      processedResult: `Synth Execution Error: ${error.message}\n\nThe tool synthesis or execution failed. This could be due to:\n- Invalid intent\n- Missing credentials for requested capabilities\n- Timeout or resource limits\n- Security policy violation`,
      serverName: 'synth',
      executedOn: 'synth-sandbox',
      executionTimeMs,
    };
  }
}

/**
 * Format Synth result for LLM context
 */
function formatSynthResultForLLM(result: SynthResult): string {
  const parts: string[] = [];

  // Add result if present
  if (result.result !== undefined) {
    if (typeof result.result === 'string') {
      parts.push(result.result);
    } else {
      parts.push(JSON.stringify(result.result, null, 2));
    }
  }

  // Add explanation if present
  if (result.tool?.explanation) {
    parts.push(`\n---\nExplanation: ${result.tool.explanation}`);
  }

  // Add metrics summary if available
  if (result.metrics) {
    const metrics = [];
    if (result.metrics.synthesisTimeMs) metrics.push(`Synthesis: ${result.metrics.synthesisTimeMs}ms`);
    if (result.metrics.executionTimeMs) metrics.push(`Execution: ${result.metrics.executionTimeMs}ms`);
    if (result.metrics.costUsd) metrics.push(`Cost: $${result.metrics.costUsd.toFixed(4)}`);
    if (metrics.length > 0) {
      parts.push(`\n---\nMetrics: ${metrics.join(', ')}`);
    }
  }

  return parts.join('\n');
}

/**
 * Check if user has access to requested Synth capabilities based on SSO
 */
export function getAvailableCapabilitiesForUser(ssoProvider?: string): string[] {
  // Base capabilities available to all users
  const baseCapabilities = ['http', 'json', 'datetime', 'file_processing'];

  // Cloud capabilities based on SSO provider
  const cloudCapabilities: Record<string, string[]> = {
    azure_ad: ['azure'],
    google: ['gcp'],
    aws_sso: ['aws'],
    github: ['github'],
    local: [], // Local users only get base capabilities
  };

  const cloud = ssoProvider ? (cloudCapabilities[ssoProvider] || []) : [];
  return [...baseCapabilities, ...cloud];
}

/**
 * Filter requested capabilities to only those available to the user
 */
export function filterCapabilitiesForUser(
  requestedCapabilities: string[] | undefined,
  ssoProvider?: string
): string[] {
  const available = getAvailableCapabilitiesForUser(ssoProvider);

  if (!requestedCapabilities || requestedCapabilities.length === 0) {
    return available;
  }

  return requestedCapabilities.filter(cap => available.includes(cap));
}
