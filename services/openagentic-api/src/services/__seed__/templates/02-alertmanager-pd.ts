/**
 * Template 02 — Alertmanager → PagerDuty
 *
 * Flow: webhook trigger (Alertmanager firing payload) →
 *       transform (group by severity) →
 *       condition (is critical?) →
 *       pagerduty_incident (trigger) per critical alert →
 *       slack_message notification
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    data: {
      label: 'Alertmanager Webhook',
      triggerType: 'webhook',
      webhookPath: '/alertmanager-pd',
      description:
        'Receives Alertmanager firing alert groups. Configure the Alertmanager webhook_config to POST here.',
      inputs: [
        {
          name: 'slackChannel',
          label: 'Slack channel',
          type: 'string',
          required: false,
          default: '#on-call-alerts',
          description: 'Where the firing-alert summary is posted.',
        },
      ],
    },
    position: { x: 0, y: 0 },
  },
  {
    id: 'transform-group-1',
    type: 'transform',
    data: {
      label: 'Group Alerts by Severity',
      transform:
        '{{ { critical: trigger.alerts.filter(a => a.labels.severity === "critical"), warning: trigger.alerts.filter(a => a.labels.severity === "warning"), other: trigger.alerts.filter(a => a.labels.severity !== "critical" && a.labels.severity !== "warning") } }}',
      expression:
        '{ critical: input.alerts.filter(a => a.labels.severity === "critical"), warning: input.alerts.filter(a => a.labels.severity === "warning"), other: input.alerts.filter(a => a.labels.severity !== "critical" && a.labels.severity !== "warning") }',
    },
    position: { x: 250, y: 0 },
  },
  {
    id: 'condition-critical-1',
    type: 'condition',
    data: {
      label: 'Has Critical Alerts?',
      condition: '{{steps.transform-group-1.result.critical.length > 0}}',
      expression: 'steps["transform-group-1"].result.critical.length > 0',
    },
    position: { x: 500, y: 0 },
  },
  {
    id: 'pd-trigger-1',
    type: 'pagerduty_incident',
    data: {
      label: 'Trigger PagerDuty Incident',
      action: 'trigger',
      routingKey: '{{secret:PAGERDUTY_ROUTING_KEY}}',
      severity: 'critical',
      summary:
        '{{steps.transform-group-1.result.critical.length}} critical alert(s) from Alertmanager: {{steps.transform-group-1.result.critical[0].labels.alertname}}',
      source: 'alertmanager-openagentic',
      dedupKey:
        'alertmanager-{{trigger.groupLabels.alertname}}-{{trigger.groupLabels.namespace}}',
      customDetails: {
        alerts: '{{steps.transform-group-1.result.critical}}',
        groupLabels: '{{trigger.groupLabels}}',
        commonLabels: '{{trigger.commonLabels}}',
      },
      client: 'OpenAgentic Alertmanager Bridge',
    },
    position: { x: 750, y: -100 },
  },
  {
    id: 'slack-notify-1',
    type: 'slack_message',
    data: {
      label: 'Slack — Firing Alert Summary',
      webhookUrl: '{{secret:SLACK_ONCALL_WEBHOOK_URL}}',
      channel: '{{trigger.input.slackChannel}}',
      message:
        ':fire: *Alertmanager Firing* — {{trigger.alerts.length}} alert(s) received.\nCritical: {{steps.transform-group-1.result.critical.length}} | Warning: {{steps.transform-group-1.result.warning.length}} | Other: {{steps.transform-group-1.result.other.length}}\nSee PagerDuty for critical incidents.',
    },
    position: { x: 750, y: 100 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'trigger-1', target: 'transform-group-1' },
  { id: 'e2', source: 'transform-group-1', target: 'condition-critical-1' },
  { id: 'e3', source: 'condition-critical-1', target: 'pd-trigger-1', label: 'true' },
  { id: 'e4', source: 'condition-critical-1', target: 'slack-notify-1', label: 'false' },
  { id: 'e5', source: 'pd-trigger-1', target: 'slack-notify-1' },
];
