/**
 * Workflow Scheduling Documentation Generator
 *
 * Parses WorkflowScheduler.ts to extract:
 * - Schedule types and cron expression support
 * - Polling configuration (interval, max per cycle)
 * - CronFields interface and parsing capabilities
 * - Scheduler lifecycle methods
 */

import type { DocManifest, DocItem, DocSection } from './types.js';
import { readFileIfExists, svcPath, relativePath, regexMatchAll, getLineNumber } from './utils.js';

export async function generateWorkflowScheduling(basePath: string): Promise<DocManifest | null> {
  const filePath = svcPath(basePath, 'openagentic-workflows', 'src', 'services', 'WorkflowScheduler.ts');
  const content = await readFileIfExists(filePath);
  if (!content) return null;

  const sourceFiles = [relativePath(filePath, basePath)];
  const sections: DocSection[] = [];

  // --- Section 1: Scheduler Configuration ---
  const configItems: DocItem[] = [];

  // POLL_INTERVAL_MS
  const pollMatch = content.match(/POLL_INTERVAL_MS\s*=\s*parseInt\(process\.env\.(\w+)\s*\|\|\s*'(\d+)'/);
  if (pollMatch) {
    configItems.push({
      id: 'config-poll-interval',
      name: 'POLL_INTERVAL_MS',
      description: `How often to poll for due schedules (default: ${parseInt(pollMatch[2], 10) / 1000}s)`,
      type: 'config-constant',
      properties: { envVar: pollMatch[1], defaultValue: parseInt(pollMatch[2], 10), unit: 'ms' },
    });
  }

  // MAX_PER_CYCLE
  const maxMatch = content.match(/MAX_PER_CYCLE\s*=\s*parseInt\(process\.env\.(\w+)\s*\|\|\s*'(\d+)'/);
  if (maxMatch) {
    configItems.push({
      id: 'config-max-per-cycle',
      name: 'MAX_PER_CYCLE',
      description: `Maximum schedules to process per poll cycle to prevent thundering herd (default: ${maxMatch[2]})`,
      type: 'config-constant',
      properties: { envVar: maxMatch[1], defaultValue: parseInt(maxMatch[2], 10) },
    });
  }

  sections.push({
    id: 'scheduler-config',
    title: 'Scheduler Configuration',
    description: 'Polling and throughput settings for the workflow scheduler.',
    adminOnly: true,
    items: configItems,
  });

  // --- Section 2: Cron Expression Support ---
  const cronItems: DocItem[] = [];

  // CronFields interface
  const cronBlock = content.match(/interface CronFields\s*\{([\s\S]*?)\}/);
  if (cronBlock) {
    const fieldPattern = /(\w+):\s*([^;]+);/g;
    for (const match of regexMatchAll(cronBlock[1], fieldPattern)) {
      cronItems.push({
        id: `cron-${match[1]}`,
        name: match[1],
        description: `Cron field: ${match[2].trim()}`,
        type: 'cron-field',
        properties: { type: match[2].trim() },
      });
    }
  }

  // Document supported cron syntax from parseCronField
  const syntaxItems: DocItem[] = [
    { id: 'syntax-star', name: '*', description: 'Match all values in the field range', type: 'cron-syntax' },
    { id: 'syntax-value', name: 'N', description: 'Match a specific value (e.g., 5)', type: 'cron-syntax' },
    { id: 'syntax-range', name: 'N-M', description: 'Match a range of values (e.g., 1-5)', type: 'cron-syntax' },
    { id: 'syntax-step', name: 'N/S', description: 'Match every S-th value starting from N (e.g., 0/15)', type: 'cron-syntax' },
    { id: 'syntax-star-step', name: '*/S', description: 'Match every S-th value across full range (e.g., */5)', type: 'cron-syntax' },
    { id: 'syntax-range-step', name: 'N-M/S', description: 'Match every S-th value within a range (e.g., 1-30/5)', type: 'cron-syntax' },
    { id: 'syntax-list', name: 'N,M,...', description: 'Comma-separated list of values or ranges', type: 'cron-syntax' },
  ];

  sections.push({
    id: 'cron-support',
    title: 'Cron Expression Support',
    description: 'Standard 5-field cron expressions: minute hour day-of-month month day-of-week (0=Sunday).',
    adminOnly: false,
    items: [...cronItems, ...syntaxItems],
  });

  // --- Section 3: Cron Field Ranges ---
  const rangeItems: DocItem[] = [];
  const rangePattern = /parseCronField\(parts\[\d+\],\s*(\d+),\s*(\d+)\)/g;
  const fieldNames = ['minutes', 'hours', 'daysOfMonth', 'months', 'daysOfWeek'];
  let fieldIdx = 0;
  for (const match of regexMatchAll(content, rangePattern)) {
    const name = fieldNames[fieldIdx] || `field${fieldIdx}`;
    rangeItems.push({
      id: `range-${name}`,
      name,
      description: `Range: ${match[1]}-${match[2]}`,
      type: 'cron-range',
      properties: { min: parseInt(match[1], 10), max: parseInt(match[2], 10) },
    });
    fieldIdx++;
  }

  if (rangeItems.length > 0) {
    sections.push({
      id: 'cron-field-ranges',
      title: 'Cron Field Ranges',
      description: 'Valid value ranges for each cron expression field.',
      adminOnly: false,
      items: rangeItems,
    });
  }

  // --- Section 4: Scheduler Methods ---
  const methodItems: DocItem[] = [];
  const classBlock = content.match(/export class WorkflowScheduler[\s\S]*/);
  if (classBlock) {
    const methodPattern = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(?:private|public|static)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/g;
    const seenMethods = new Set<string>();
    for (const match of regexMatchAll(classBlock[0], methodPattern)) {
      const name = match[2];
      if (name === 'constructor' || seenMethods.has(name)) continue;
      seenMethods.add(name);
      const jsdoc = match[1]?.replace(/\s*\*\s*/g, ' ').trim() || '';
      methodItems.push({
        id: `method-${name}`,
        name,
        description: jsdoc || `Scheduler method`,
        type: 'method',
        sourceLine: getLineNumber(content, match.index),
        sourceFile: sourceFiles[0],
      });
    }
  }

  if (methodItems.length > 0) {
    sections.push({
      id: 'scheduler-methods',
      title: 'Scheduler Methods',
      description: 'WorkflowScheduler lifecycle and polling methods.',
      adminOnly: true,
      items: methodItems,
    });
  }

  return {
    domain: 'workflow-scheduling',
    title: 'Workflow Scheduling',
    description: 'Cron-based workflow scheduling with setInterval polling, 5-field cron expression parsing, and configurable throughput limits.',
    icon: 'flow',
    category: 'workflows',
    generatedAt: new Date().toISOString(),
    sourceFiles,
    sections,
  };
}
