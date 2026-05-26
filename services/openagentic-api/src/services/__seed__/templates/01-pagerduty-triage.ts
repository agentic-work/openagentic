/**
 * Template 01 — PagerDuty Triage
 *
 * Flow: webhook trigger → pagerduty_incident (acknowledge) →
 *       llm_completion (classify severity) → condition (route) →
 *       slack_message (critical) / send_email (warning)
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    data: {
      label: 'PagerDuty Webhook',
      triggerType: 'webhook',
      webhookPath: '/pd-triage',
      description: 'Receives PagerDuty incident payloads from the API webhook.',
    },
    position: { x: 0, y: 0 },
  },
  {
    id: 'pd-ack-1',
    type: 'pagerduty_incident',
    data: {
      label: 'Acknowledge Incident',
      action: 'acknowledge',
      routingKey: '{{secret:PAGERDUTY_ROUTING_KEY}}',
      dedupKey: '{{trigger.messages[0].incident.id}}',
      summary: 'Auto-acknowledged by OpenAgentic triage workflow',
      source: 'openagentic-omhs-triage',
    },
    position: { x: 250, y: 0 },
  },
  {
    id: 'llm-classify-1',
    type: 'llm_completion',
    data: {
      label: 'Classify Severity',
      prompt:
        'You are an on-call incident classifier. Given the PagerDuty incident payload below, classify severity as one of: critical, high, warning, info. Respond with a JSON object { "severity": "<level>", "reason": "<one sentence>" }.\n\nIncident payload:\n{{trigger.messages[0].incident}}',
      model: 'auto',
      outputFormat: 'json',
    },
    position: { x: 500, y: 0 },
  },
  {
    id: 'condition-route-1',
    type: 'condition',
    data: {
      label: 'Route by Severity',
      condition: '{{steps.llm-classify-1.result.severity === "critical" || steps.llm-classify-1.result.severity === "high"}}',
      expression: 'steps["llm-classify-1"].result.severity === "critical" || steps["llm-classify-1"].result.severity === "high"',
    },
    position: { x: 750, y: 0 },
  },
  {
    id: 'slack-critical-1',
    type: 'slack_message',
    data: {
      label: 'Slack — Critical Alert',
      webhookUrl: '{{secret:SLACK_ONCALL_WEBHOOK_URL}}',
      channel: '#on-call-critical',
      message:
        ':red_circle: *CRITICAL INCIDENT* — {{trigger.messages[0].incident.title}}\n>Severity: {{steps.llm-classify-1.result.severity}}\n>Reason: {{steps.llm-classify-1.result.reason}}\n>PD Link: {{trigger.messages[0].incident.html_url}}',
    },
    position: { x: 1000, y: -100 },
  },
  {
    id: 'email-warning-1',
    type: 'send_email',
    data: {
      label: 'Email — Warning Alert',
      to: '{{secret:ONCALL_EMAIL_LIST}}',
      subject: '[WARNING] PagerDuty Incident: {{trigger.messages[0].incident.title}}',
      body: 'A warning-level PagerDuty incident was received.\n\nSeverity: {{steps.llm-classify-1.result.severity}}\nReason: {{steps.llm-classify-1.result.reason}}\nLink: {{trigger.messages[0].incident.html_url}}',
      smtpHost: '{{secret:SMTP_HOST}}',
      smtpPort: 587,
      smtpUser: '{{secret:SMTP_USER}}',
      smtpPasswordRef: '{{secret:SMTP_PASSWORD}}',
    },
    position: { x: 1000, y: 100 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'trigger-1', target: 'pd-ack-1' },
  { id: 'e2', source: 'pd-ack-1', target: 'llm-classify-1' },
  { id: 'e3', source: 'llm-classify-1', target: 'condition-route-1' },
  { id: 'e4', source: 'condition-route-1', target: 'slack-critical-1', label: 'true' },
  { id: 'e5', source: 'condition-route-1', target: 'email-warning-1', label: 'false' },
];
