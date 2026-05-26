/**
 * Template 03 — Splunk Detection Triage
 *
 * Flow: splunk_search (notable_create detection query) →
 *       llm_completion (summarize) →
 *       condition (high severity?) →
 *       pagerduty_incident (trigger) →
 *       knowledge_ingest (store in KB)
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    data: {
      label: 'Schedule — Every 15 min',
      triggerType: 'schedule',
      schedule: '*/15 * * * *',
      description: 'Polls Splunk for new detection notables every 15 minutes.',
    },
    position: { x: 0, y: 0 },
  },
  {
    id: 'splunk-search-1',
    type: 'splunk_search',
    data: {
      label: 'Splunk — Fetch New Notables',
      operation: 'search',
      host: '{{secret:SPLUNK_HOST}}',
      token: '{{secret:SPLUNK_TOKEN}}',
      spl: 'index=notable source="Splunk_SA_CIM:Notable_Events" status=0 earliest=-15m | sort -_time | head 50 | table _time title severity owner status alert_value dest src',
      earliestTime: '-15m',
      latestTime: 'now',
      maxResults: 50,
      timeout: 60000,
    },
    position: { x: 250, y: 0 },
  },
  {
    id: 'llm-summarize-1',
    type: 'llm_completion',
    data: {
      label: 'LLM — Summarize Detections',
      prompt:
        'You are a security analyst. Summarize the following Splunk notable events. For each unique detection, provide: severity (critical/high/medium/low), a one-sentence description, affected assets (dest, src), and recommended immediate action.\n\nReturn a JSON object: { "summary": "<paragraph>", "events": [{ "title": "", "severity": "", "description": "", "assets": [], "action": "" }], "highestSeverity": "critical|high|medium|low" }\n\nSplunk notable events:\n{{steps.splunk-search-1.result.events}}',
      model: 'auto',
      outputFormat: 'json',
    },
    position: { x: 500, y: 0 },
  },
  {
    id: 'condition-high-1',
    type: 'condition',
    data: {
      label: 'High/Critical Severity?',
      condition:
        '{{steps.llm-summarize-1.result.highestSeverity === "critical" || steps.llm-summarize-1.result.highestSeverity === "high"}}',
      expression:
        'steps["llm-summarize-1"].result.highestSeverity === "critical" || steps["llm-summarize-1"].result.highestSeverity === "high"',
    },
    position: { x: 750, y: 0 },
  },
  {
    id: 'pd-trigger-1',
    type: 'pagerduty_incident',
    data: {
      label: 'Page On-Call — Splunk Detection',
      action: 'trigger',
      routingKey: '{{secret:PAGERDUTY_ROUTING_KEY}}',
      severity: 'error',
      summary:
        'Splunk Detection: {{steps.llm-summarize-1.result.events[0].title}} ({{steps.llm-summarize-1.result.highestSeverity}})',
      source: 'splunk-openagentic-triage',
      dedupKey:
        'splunk-detection-{{trigger.runAt}}',
      customDetails: {
        summary: '{{steps.llm-summarize-1.result.summary}}',
        eventCount: '{{steps.splunk-search-1.result.eventCount}}',
      },
      client: 'OpenAgentic Splunk Triage',
    },
    position: { x: 1000, y: -100 },
  },
  {
    id: 'kb-ingest-1',
    type: 'knowledge_ingest',
    data: {
      label: 'Store in Knowledge Base',
      collection: 'omhs-incident-history',
      source: 'splunk-detection-triage',
      content:
        '{{steps.llm-summarize-1.result.summary}}\n\nRaw events: {{steps.splunk-search-1.result.events}}',
    },
    position: { x: 1000, y: 100 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'trigger-1', target: 'splunk-search-1' },
  { id: 'e2', source: 'splunk-search-1', target: 'llm-summarize-1' },
  { id: 'e3', source: 'llm-summarize-1', target: 'condition-high-1' },
  { id: 'e4', source: 'condition-high-1', target: 'pd-trigger-1', label: 'true' },
  { id: 'e5', source: 'condition-high-1', target: 'kb-ingest-1', label: 'false' },
  { id: 'e6', source: 'pd-trigger-1', target: 'kb-ingest-1' },
];
