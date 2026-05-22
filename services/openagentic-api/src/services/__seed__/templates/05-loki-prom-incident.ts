/**
 * Template 05 — Loki/Prometheus Query → Incident Decision
 *
 * Flow: trigger → mcp_tool prometheus_query_range +
 *       mcp_tool loki_search_errors → merge → llm_completion (correlate) →
 *       condition → pagerduty_incident (confirmed incidents)
 *
 * Replaces the previous data_source_query nodes with read-only MCP
 * tool calls per the "MCP only" infra directive (#78). Both
 * openagentic_prometheus + openagentic_loki MCP servers expose the exact tools we
 * need; no privileged sandbox spawning required.
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    data: {
      label: 'Schedule — Every 5 min',
      triggerType: 'schedule',
      schedule: '*/5 * * * *',
      description: 'Polls Prometheus and Loki every 5 minutes via MCP tools to detect correlated incidents.',
      inputs: [
        {
          name: 'errorRateThreshold',
          label: '5xx error-rate threshold',
          type: 'number',
          required: false,
          default: 0.05,
          description: 'Fraction of requests above which we treat a service as alerting (default 5%).',
        },
        {
          name: 'logLimit',
          label: 'Loki log line cap',
          type: 'number',
          required: false,
          default: 100,
          description: 'Max log lines to fetch per cycle (Loki query budget).',
        },
      ],
    },
    position: { x: 0, y: 0 },
  },
  {
    id: 'prom-query-1',
    type: 'mcp_tool',
    data: {
      label: 'Prometheus — Error Rate (5xx %)',
      icon: 'BarChart',
      color: '#e91e63',
      toolServer: 'openagentic_prometheus',
      toolName: 'prometheus_query_range',
      arguments: {
        query:
          'sum by (job, namespace) (rate(http_requests_total{status=~"5.."}[5m])) / sum by (job, namespace) (rate(http_requests_total[5m]))',
        start: 'now-5m',
        end: 'now',
        step: '30s',
      },
      description: 'Rolls up the per-namespace 5xx ratio over the last 5 minutes.',
    },
    position: { x: 250, y: -150 },
  },
  {
    id: 'loki-query-1',
    type: 'mcp_tool',
    data: {
      label: 'Loki — Recent Error Logs',
      icon: 'FileText',
      color: '#0ea5e9',
      toolServer: 'openagentic_loki',
      toolName: 'loki_search_errors',
      arguments: {
        namespace: '.+',
        start: 'now-5m',
        end: 'now',
        limit: '{{trigger.input.logLimit}}',
      },
      description: 'Fetches level=error log lines across every namespace in the last 5 minutes.',
    },
    position: { x: 250, y: 150 },
  },
  {
    id: 'merge-1',
    type: 'merge',
    data: {
      label: 'Merge Observability Signals',
      strategy: 'combine',
    },
    position: { x: 500, y: 0 },
  },
  {
    id: 'llm-correlate-1',
    type: 'llm_completion',
    data: {
      label: 'LLM — Correlate Signals',
      prompt:
        'You are an SRE incident analyst. Correlate the Prometheus error-rate series and the Loki error log lines below to determine if a real incident is occurring.\n\n' +
        'Threshold: a service is alerting if its 5xx ratio > {{trigger.input.errorRateThreshold}}.\n\n' +
        'Decide:\n' +
        '1. Is there a confirmed incident? (yes/no)\n' +
        '2. Incident severity: critical, high, warning, or none\n' +
        '3. Root cause hypothesis (1-2 sentences)\n' +
        '4. Affected services/namespaces\n\n' +
        'Return JSON: { "confirmed": true|false, "severity": "critical|high|warning|none", "rootCause": "<hypothesis>", "affectedServices": [], "summary": "<paragraph>" }\n\n' +
        'Prometheus error-rate series:\n{{steps.prom-query-1.output}}\n\n' +
        'Loki error log lines:\n{{steps.loki-query-1.output}}',
      model: 'auto',
      outputFormat: 'json',
    },
    position: { x: 750, y: 0 },
  },
  {
    id: 'condition-incident-1',
    type: 'condition',
    data: {
      label: 'Confirmed Incident?',
      condition:
        '{{steps.llm-correlate-1.result.confirmed === true && steps.llm-correlate-1.result.severity !== "none"}}',
      expression:
        'steps["llm-correlate-1"].result.confirmed === true && steps["llm-correlate-1"].result.severity !== "none"',
    },
    position: { x: 1000, y: 0 },
  },
  {
    id: 'pd-incident-1',
    type: 'pagerduty_incident',
    data: {
      label: 'Trigger Confirmed Incident',
      action: 'trigger',
      routingKey: '{{secret:PAGERDUTY_ROUTING_KEY}}',
      severity: '{{steps.llm-correlate-1.result.severity === "critical" ? "critical" : "error"}}',
      summary:
        'Correlated Incident: {{steps.llm-correlate-1.result.rootCause}} (Prometheus + Loki via MCP)',
      source: 'loki-prom-openagentic',
      dedupKey: 'loki-prom-{{trigger.runAt}}-{{steps.llm-correlate-1.result.severity}}',
      customDetails: {
        rootCause: '{{steps.llm-correlate-1.result.rootCause}}',
        affectedServices: '{{steps.llm-correlate-1.result.affectedServices}}',
        summary: '{{steps.llm-correlate-1.result.summary}}',
      },
      client: 'OpenAgentic Loki/Prom Correlator',
    },
    position: { x: 1250, y: -100 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'trigger-1', target: 'prom-query-1' },
  { id: 'e2', source: 'trigger-1', target: 'loki-query-1' },
  { id: 'e3', source: 'prom-query-1', target: 'merge-1' },
  { id: 'e4', source: 'loki-query-1', target: 'merge-1' },
  { id: 'e5', source: 'merge-1', target: 'llm-correlate-1' },
  { id: 'e6', source: 'llm-correlate-1', target: 'condition-incident-1' },
  { id: 'e7', source: 'condition-incident-1', target: 'pd-incident-1', label: 'true' },
];
