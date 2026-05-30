/**
 * Chat configuration
 */

export const chatConfig = {
  // Use SSE for all chat communication
  useSSE: true,
  // Auto-approve MCP tools (no user interaction needed)
  autoApproveTools: true,
  // Enable these MCP tools by default
  defaultEnabledTools: [
    'list-resources',
    'describe-costs',
    'analyze-costs',
    'get-recommendations',
    'query-logs',
    'read-storage',
    'list-storage'
  ]
};
