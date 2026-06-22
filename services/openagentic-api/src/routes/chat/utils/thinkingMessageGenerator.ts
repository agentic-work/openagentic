/**
 * Thinking Message Generator
 *
 * Generates contextual "thinking" messages based on user query analysis.
 * Provides immediate feedback to users about what the assistant is doing.
 *
 * Claude Desktop Style: Shows detailed step-by-step thinking in a static box
 */

export interface ThinkingContext {
  userQuery: string;
  detectedTools?: string[];
  hasFiles?: boolean;
  model?: string;
  stage?: string;
}

/**
 * Generate a contextual thinking message based on the user's query
 * This runs instantly (no LLM call) to provide immediate feedback
 *
 * Now returns verbose, step-by-step thinking content for Claude Desktop-style display
 */
export function generateThinkingMessage(context: ThinkingContext): string {
  const { userQuery, detectedTools = [], hasFiles = false, model, stage } = context;
  const query = userQuery.toLowerCase();
  const lines: string[] = [];

  // Initial analysis
  lines.push('Analyzing request...');

  // Query type detection
  const queryType = detectQueryType(query);
  lines.push(`Query type: ${queryType}`);

  // File analysis
  if (hasFiles) {
    lines.push('Processing uploaded files...');
    lines.push('Extracting content for analysis...');
  }

  // Azure-specific queries
  if (/azure|subscription|resource group|vm|virtual machine|storage|aks|kubernetes/.test(query)) {
    lines.push('Detected Azure infrastructure query');
    if (/list|show|get|view|find/.test(query)) {
      lines.push('Action: Querying Azure resources');
      lines.push('Connecting to Azure Resource Manager...');
    } else if (/create|deploy|provision/.test(query)) {
      lines.push('Action: Planning Azure deployment');
      lines.push('Validating resource configuration...');
    } else if (/analyze|check|status|health/.test(query)) {
      lines.push('Action: Analyzing infrastructure health');
      lines.push('Gathering metrics and status data...');
    } else if (/cost|spending|budget|price/.test(query)) {
      lines.push('Action: Analyzing costs');
      lines.push('Retrieving billing and usage data...');
    }
  }

  // Database queries
  if (/database|postgres|redis|milvus|sql|query/.test(query)) {
    lines.push('Detected database query');
    lines.push('Preparing database operation...');
  }

  // Code requests
  if (/implement|code|function|create.*function|write.*code/.test(query)) {
    lines.push('Detected code generation request');
    lines.push('Analyzing requirements...');
    lines.push('Selecting appropriate patterns...');
  }

  // Diagram requests
  if (/diagram|chart|visualize|graph|architecture/.test(query)) {
    lines.push('Detected visualization request');
    lines.push('Determining diagram type...');
  }

  // Explanation requests
  if (/explain|how does|what is|why|describe/.test(query)) {
    lines.push('Detected explanation request');
    lines.push('Gathering relevant information...');
    lines.push('Formulating clear explanation...');
  }

  // Debugging requests
  if (/error|bug|fix|debug|issue|problem|not working/.test(query)) {
    lines.push('Detected debugging request');
    lines.push('Analyzing potential causes...');
    lines.push('Checking common solutions...');
  }

  // Tool detection
  if (detectedTools.length > 0) {
    lines.push(`Tools available: ${detectedTools.join(', ')}`);
    lines.push('Determining which tools to use...');
  }

  // Model info
  if (model) {
    lines.push(`Model: ${model}`);
  }

  // Processing stage
  lines.push('Generating response...');

  return lines.join('\n');
}

/**
 * Detect the type of query for better thinking output
 */
function detectQueryType(query: string): string {
  if (/\?$/.test(query.trim())) return 'Question';
  if (/^(please|can you|could you|would you)/i.test(query)) return 'Request';
  if (/^(create|make|generate|build|write)/i.test(query)) return 'Creation';
  if (/^(explain|describe|what|why|how)/i.test(query)) return 'Explanation';
  if (/^(fix|debug|solve|resolve)/i.test(query)) return 'Troubleshooting';
  if (/^(list|show|get|find|search)/i.test(query)) return 'Query';
  if (/^(compare|analyze|evaluate)/i.test(query)) return 'Analysis';
  return 'General';
}

/**
 * Generate stage-specific thinking content
 * Call this when entering different pipeline stages for real-time updates
 */
export function generateStageThinking(stage: string, details?: Record<string, any>): string {
  const lines: string[] = [];

  switch (stage) {
    case 'message-preparation':
      lines.push('Preparing message context...');
      lines.push('Loading conversation history...');
      break;

    case 'prompt-engineering':
      lines.push('Engineering optimal prompt...');
      lines.push('Applying prompt techniques...');
      if (details?.techniques) {
        lines.push(`Techniques: ${details.techniques.join(', ')}`);
      }
      break;

    case 'tool-discovery':
      lines.push('Discovering available tools...');
      if (details?.toolCount) {
        lines.push(`Found ${details.toolCount} available tools`);
      }
      break;

    case 'completion':
      lines.push('Sending request to LLM...');
      if (details?.model) {
        lines.push(`Model: ${details.model}`);
      }
      lines.push('Waiting for response...');
      break;

    case 'tool-execution':
      lines.push('Executing tool calls...');
      if (details?.toolName) {
        lines.push(`Running: ${details.toolName}`);
      }
      break;

    case 'response-processing':
      lines.push('Processing response...');
      lines.push('Formatting output...');
      break;

    default:
      lines.push(`Processing: ${stage}...`);
  }

  return lines.join('\n');
}
