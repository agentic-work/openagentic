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

import type { Logger } from 'pino';

/**
 * Error Handling Helper
 *
 * Handles LLM provider error stream reading and parsing
 * Includes Ollama-based error diagnostics for admin users
 */

/**
 * EnrichedError interface for admin error display
 */
export interface EnrichedError {
  stage: string;
  message: string;
  technicalMessage: string;
  code: string;
  retryable: boolean;
  recommendations: string[];
  details?: Record<string, unknown>;
}

/**
 * Read error response from a stream (when responseType: 'stream')
 */
export async function readErrorStream(stream: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    stream.on('error', (error: Error) => {
      reject(error);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      reject(new Error('Timeout reading error stream'));
    }, 5000);
  });
}

/**
 * Parse and log LLM provider error response
 */
export async function parseLLMProviderError(error: any, logger: Logger): Promise<void> {
  if (!error.response) return;

  try {
    const errorData = await readErrorStream(error.response.data);

    logger.error({
      status: error.response.status,
      statusText: error.response.statusText,
      headers: error.response.headers,
      errorBody: errorData
    }, 'LLM provider returned error response');

    // Attach parsed error to error object
    if (errorData) {
      try {
        error.providerError = JSON.parse(errorData);
      } catch (e) {
        error.providerError = { raw: errorData };
      }
    }
  } catch (readError: any) {
    logger.error({
      status: error.response.status,
      statusText: error.response.statusText,
      readError: readError.message
    }, 'Failed to read LLM provider error response stream');
  }
}

/**
 * Extract error message from various error formats
 */
export function extractErrorMessage(error: any): string {
  // Check provider error we parsed
  if (error.providerError) {
    if (error.providerError.error?.message) {
      return error.providerError.error.message;
    }
    if (error.providerError.message) {
      return error.providerError.message;
    }
    if (error.providerError.raw) {
      return `Provider error: ${error.providerError.raw.substring(0, 500)}`;
    }
  }

  // Standard error locations
  if (error.response?.data?.error?.message) {
    return error.response.data.error.message;
  }
  if (error.response?.data?.message) {
    return error.response.data.message;
  }
  if (error.message) {
    return error.message;
  }

  return 'Unknown completion error';
}

/**
 * Check if error is a throttling/rate limit error
 * Detects AWS Bedrock ThrottlingException, HTTP 429, and rate limit messages
 */
export function isThrottlingError(error: any): boolean {
  const message = error.message?.toLowerCase() || '';
  const errorName = error.name || '';
  const status = error.status || error.$metadata?.httpStatusCode || 0;

  return (
    // AWS Bedrock specific
    errorName === 'ThrottlingException' ||
    message.includes('throttlingexception') ||
    message.includes('too many tokens') ||
    message.includes('too many requests') ||
    // Generic rate limiting
    status === 429 ||
    error.code === 'rate_limit_exceeded' ||
    message.includes('rate limit') ||
    message.includes('rate_limit') ||
    message.includes('quota exceeded')
  );
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: any): boolean {
  const retryableCodes = [
    'rate_limit_exceeded',
    'model_overloaded',
    'server_error',
    'timeout'
  ];

  // Throttling errors are always retryable
  if (isThrottlingError(error)) {
    return true;
  }

  return (
    retryableCodes.includes(error.code) ||
    error.message?.includes('rate limit') ||
    error.message?.includes('timeout') ||
    error.status >= 500
  );
}

/**
 * Get default recommendations based on error stage and type
 */
export function getDefaultRecommendations(stage: string, error: any): string[] {
  const message = error.message?.toLowerCase() || '';

  // Stage-specific recommendations
  const stageRecommendations: Record<string, string[]> = {
    'completion': [
      'Check if the LLM provider service is reachable',
      'Verify API keys are configured correctly in System Settings',
      'Check provider rate limits and quotas'
    ],
    'mcp': [
      'Verify MCP Proxy is running: docker logs openagentic-mcp-proxy',
      'Check MCP server configuration in mcp_servers.yaml',
      'Restart MCP Proxy: docker restart openagentic-mcp-proxy'
    ],
    'auth': [
      'Check Azure AD configuration',
      'Verify API tokens have not expired',
      'Check user permissions and role assignments'
    ],
    'validation': [
      'Check message format and content',
      'Verify input length is within limits',
      'Review validation rules in configuration'
    ],
    'prompt': [
      'Check system prompt template configuration',
      'Verify prompt injection safeguards are not blocking valid content',
      'Review prompt engineering settings'
    ],
    'rag': [
      'Verify Milvus vector database is running',
      'Check embedding service configuration',
      'Verify collection exists and has data'
    ]
  };

  // Error type-specific recommendations
  if (message.includes('timeout') || message.includes('timed out')) {
    return [
      'Request timed out - retrying with current or fallback model',
      'If the issue persists, try simplifying your request',
      'Check network connectivity if this continues'
    ];
  }

  if (message.includes('rate limit') || message.includes('429')) {
    return [
      'API rate limit reached - wait a few minutes before retrying',
      'Consider upgrading API plan for higher limits',
      'Enable request queuing in system settings'
    ];
  }

  if (message.includes('connection') || message.includes('connect') || message.includes('network')) {
    return [
      'Verify network connectivity to backend services',
      'Check if the API server is running',
      'Review firewall and security group settings'
    ];
  }

  if (message.includes('401') || message.includes('unauthorized') || message.includes('forbidden')) {
    return [
      'API authentication failed - check API keys',
      'Verify OAuth tokens have not expired',
      'Check user permissions and role assignments'
    ];
  }

  if (message.includes('model') && (message.includes('not found') || message.includes('invalid'))) {
    return [
      'The requested model may not be available',
      'Check model deployment configuration',
      'Verify model name in provider settings'
    ];
  }

  // Return stage-specific or default recommendations
  return stageRecommendations[stage] || [
    'Check system logs for more details',
    'Verify all required services are running',
    'Contact platform administrator if the issue persists'
  ];
}

/**
 * Get human-readable error message
 */
export function getHumanReadableMessage(error: any): string {
  const message = error.message?.toLowerCase() || '';

  if (message.includes('timeout') || message.includes('timed out')) {
    return 'Request timed out - the model took too long to respond';
  }
  if (message.includes('rate limit') || message.includes('429')) {
    return 'Rate limit exceeded - too many requests in a short period';
  }
  if (message.includes('401') || message.includes('unauthorized')) {
    return 'Authentication failed - invalid or expired credentials';
  }
  if (message.includes('403') || message.includes('forbidden')) {
    return 'Access denied - insufficient permissions';
  }
  if (message.includes('connection') || message.includes('connect')) {
    return 'Connection failed - unable to reach the service';
  }
  if (message.includes('model') && message.includes('not found')) {
    return 'Model not found - the requested model is unavailable';
  }
  if (message.includes('context') && message.includes('length')) {
    return 'Context too long - the message exceeds model limits';
  }

  return error.message || 'An unexpected error occurred';
}

/**
 * Check if Ollama is properly configured for diagnostics
 * Returns configuration if available, null otherwise
 */
function getOllamaConfig(): { baseUrl: string; model: string } | null {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_CHAT_MODEL || process.env.OLLAMA_MODEL;

  // Both baseUrl and model must be configured - no fallbacks
  if (!baseUrl || !model) {
    return null;
  }

  return { baseUrl, model };
}

/**
 * Call Ollama to generate error diagnostics and recommendations
 * Only attempts if Ollama is properly configured via environment variables
 * Returns null if Ollama is not available (caller should use default recommendations)
 */
export async function callOllamaForDiagnostics(
  error: any,
  stage: string,
  logger: Logger
): Promise<string[] | null> {
  // Check if Ollama is configured - no hardcoded fallbacks
  const ollamaConfig = getOllamaConfig();
  if (!ollamaConfig) {
    logger.debug('Ollama not configured for diagnostics, skipping AI-assisted recommendations');
    return null;
  }

  const prompt = `You are a system diagnostics assistant for an AI chat platform. Analyze this error and provide 2-3 specific actionable recommendations.

Error Stage: ${stage}
Error Message: ${error.message}
Error Code: ${error.code || 'unknown'}

Provide recommendations as a JSON array of strings. Focus on:
1. What likely caused this error
2. What the admin should check
3. How to prevent it in the future

Response format (JSON only, no other text):
{"recommendations": ["First recommendation", "Second recommendation", "Third recommendation"]}`;

  try {
    const response = await fetch(`${ollamaConfig.baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: ollamaConfig.model,
        prompt,
        format: 'json',
        stream: false,
        options: {
          temperature: 0.3,  // Low temperature for consistent, factual responses
          num_predict: 200   // Limit response length
        }
      }),
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = await response.json();
    const parsed = JSON.parse(data.response);

    if (Array.isArray(parsed.recommendations)) {
      return parsed.recommendations.slice(0, 3);
    }

    throw new Error('Invalid response format');
  } catch (ollamaError: any) {
    logger.warn({ ollamaError: ollamaError.message, stage }, 'Ollama diagnostics call failed');
    return null; // Return null to signal caller should use defaults
  }
}

/**
 * Enrich error for admin display
 * Includes Ollama-generated recommendations when available, otherwise uses defaults
 */
export async function enrichErrorForAdmin(
  error: any,
  stage: string,
  context: { model?: string; userId?: string },
  logger: Logger
): Promise<EnrichedError> {
  const enriched: EnrichedError = {
    stage,
    message: getHumanReadableMessage(error),
    technicalMessage: extractErrorMessage(error),
    code: error.code || error.name || 'UNKNOWN_ERROR',
    retryable: isRetryableError(error),
    recommendations: [],
    details: {
      model: context.model,
      timestamp: new Date().toISOString(),
      stack: error.stack
    }
  };

  // Try to get Ollama-generated recommendations if Ollama is configured
  // Returns null if Ollama is not available or call fails
  const ollamaRecommendations = await callOllamaForDiagnostics(error, stage, logger);

  // Use Ollama recommendations if available, otherwise use defaults
  enriched.recommendations = ollamaRecommendations || getDefaultRecommendations(stage, error);

  return enriched;
}
