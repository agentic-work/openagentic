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
 * IntegrationMessageFormatter
 * Converts workflow execution outputs into platform-specific rich messages.
 */

export interface WorkflowOutput {
  status: 'success' | 'error' | 'partial';
  summary: string;
  executionId?: string;
  workflowName?: string;
  duration?: number; // ms
  outputs: Record<string, any>;
  nodeResults?: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    status: string;
    output?: any;
    error?: string;
    duration?: number;
  }>;
  error?: string;
}

// --- Slack Block Kit ---

export function formatSlackBlocks(result: WorkflowOutput): any[] {
  const blocks: any[] = [];
  const statusEmoji = result.status === 'success' ? ':white_check_mark:' : result.status === 'error' ? ':x:' : ':warning:';

  // Header
  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: `${result.workflowName || 'Workflow'} — ${result.status === 'success' ? 'Completed' : result.status === 'error' ? 'Failed' : 'Partial'}`, emoji: true }
  });

  // Summary section
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `${statusEmoji} ${result.summary}` }
  });

  // Duration & execution ID
  const meta: string[] = [];
  if (result.duration) meta.push(`Duration: ${(result.duration / 1000).toFixed(1)}s`);
  if (result.executionId) meta.push(`ID: \`${result.executionId}\``);
  if (meta.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: meta.join(' | ') }]
    });
  }

  // Node results (if available)
  if (result.nodeResults && result.nodeResults.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Step Results*' }
    });

    for (const node of result.nodeResults.slice(0, 8)) {
      const nodeEmoji = node.status === 'completed' ? ':white_check_mark:' : node.status === 'error' ? ':x:' : ':hourglass:';
      let text = `${nodeEmoji} *${node.nodeName}* (${node.nodeType})`;
      if (node.duration) text += ` — ${(node.duration / 1000).toFixed(1)}s`;
      if (node.error) text += `\n> :warning: ${node.error.substring(0, 100)}`;
      if (node.output && typeof node.output === 'string') text += `\n> ${node.output.substring(0, 200)}`;

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text }
      });
    }
  }

  // Key outputs
  if (result.outputs && Object.keys(result.outputs).length > 0) {
    blocks.push({ type: 'divider' });
    const fields = Object.entries(result.outputs)
      .filter(([, v]) => v !== null && v !== undefined)
      .slice(0, 10)
      .map(([key, value]) => ({
        type: 'mrkdwn',
        text: `*${key}:*\n${formatValue(value)}`
      }));

    for (let i = 0; i < fields.length; i += 2) {
      blocks.push({ type: 'section', fields: fields.slice(i, i + 2) });
    }
  }

  // Error details
  if (result.error) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `:x: *Error:* ${result.error.substring(0, 500)}` }
    });
  }

  // Footer
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '_Powered by OpenAgentic Flows_' }]
  });

  return blocks;
}

// --- Teams Adaptive Card ---

export function formatAdaptiveCard(result: WorkflowOutput): any {
  const body: any[] = [];
  const statusColor = result.status === 'success' ? 'good' : result.status === 'error' ? 'attention' : 'warning';

  // Header with status
  body.push({
    type: 'ColumnSet',
    columns: [
      {
        type: 'Column',
        width: 'stretch',
        items: [
          { type: 'TextBlock', text: result.workflowName || 'Workflow', weight: 'bolder', size: 'large' },
          { type: 'TextBlock', text: result.summary, wrap: true, spacing: 'small' }
        ]
      },
      {
        type: 'Column',
        width: 'auto',
        items: [
          { type: 'TextBlock', text: result.status === 'success' ? 'Completed' : result.status === 'error' ? 'Failed' : 'Partial', color: statusColor, weight: 'bolder', horizontalAlignment: 'right' }
        ]
      }
    ]
  });

  // Metadata
  const facts: any[] = [];
  if (result.executionId) facts.push({ title: 'Execution ID', value: result.executionId });
  if (result.duration) facts.push({ title: 'Duration', value: `${(result.duration / 1000).toFixed(1)}s` });
  if (facts.length > 0) {
    body.push({ type: 'FactSet', facts, separator: true });
  }

  // Node results
  if (result.nodeResults && result.nodeResults.length > 0) {
    body.push({ type: 'TextBlock', text: 'Step Results', weight: 'bolder', separator: true, spacing: 'medium' });

    for (const node of result.nodeResults.slice(0, 8)) {
      const statusIcon = node.status === 'completed' ? '✅' : node.status === 'error' ? '❌' : '⏳';
      body.push({
        type: 'ColumnSet',
        columns: [
          { type: 'Column', width: 'auto', items: [{ type: 'TextBlock', text: statusIcon }] },
          {
            type: 'Column',
            width: 'stretch',
            items: [
              { type: 'TextBlock', text: `**${node.nodeName}** (${node.nodeType})${node.duration ? ` — ${(node.duration / 1000).toFixed(1)}s` : ''}`, wrap: true },
              ...(node.error ? [{ type: 'TextBlock', text: node.error.substring(0, 100), color: 'attention', size: 'small', wrap: true }] : [])
            ]
          }
        ],
        spacing: 'small'
      });
    }
  }

  // Key outputs
  if (result.outputs && Object.keys(result.outputs).length > 0) {
    const outputFacts = Object.entries(result.outputs)
      .filter(([, v]) => v !== null && v !== undefined)
      .slice(0, 10)
      .map(([key, value]) => ({ title: key, value: formatValue(value) }));

    if (outputFacts.length > 0) {
      body.push({ type: 'TextBlock', text: 'Outputs', weight: 'bolder', separator: true, spacing: 'medium' });
      body.push({ type: 'FactSet', facts: outputFacts });
    }
  }

  // Error
  if (result.error) {
    body.push({
      type: 'TextBlock',
      text: `Error: ${result.error.substring(0, 500)}`,
      color: 'attention',
      wrap: true,
      separator: true
    });
  }

  // Footer
  body.push({
    type: 'TextBlock',
    text: 'Powered by OpenAgentic Flows',
    size: 'small',
    isSubtle: true,
    separator: true,
    spacing: 'medium'
  });

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body
  };
}

// Helper to format values for display
function formatValue(value: any): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string') return value.substring(0, 300);
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return JSON.stringify(value).substring(0, 200);
  return String(value);
}
