/**
 * Template 06 — PagerDuty Auto-Triage (Multi-Agent + HITL)
 *
 * Flow shape (approved 2026-04-25):
 *   pagerduty_webhook → extract_metadata → multi_agent (aws + azure + k8s + splunk
 *   parallel) → merge → openagentic_llm synthesize fix → pagerduty_action
 *   add_note + acknowledge → human_approval (origin-aware: PD note reply) →
 *   condition: approved? → apply_fix (mcp_tool) → verify_resolution
 *   (k8s_sandbox_run + prom_query) → pagerduty_action resolve →
 *   slack_message post-mortem + audit trail. On reject: re-triage with feedback.
 *
 * Every agent / LLM node carries refusal-detection outputAssertions via the
 * shared registry so a "I couldn't find logs for that service" agent answer
 * fails loudly with output_failed_assertion instead of fake-success.
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-pd-webhook',
    type: 'trigger',
    data: {
      label: 'PagerDuty Incident Webhook',
      triggerType: 'webhook',
      webhookPath: '/pd-auto-triage',
      description: 'Receives incident.triggered events from the PagerDuty service.',
      inputs: [
        {
          name: 'postmortemChannel',
          label: 'Post-mortem Slack channel',
          type: 'string',
          required: false,
          default: '#incidents-postmortem',
          description: 'Where the resolved-incident post-mortem is posted.',
        },
      ],
    },
    position: { x: 0, y: 200 },
  },
  {
    id: 'extract-metadata',
    type: 'transform',
    data: {
      label: 'Extract Incident Metadata',
      transformType: 'extract',
      transformExpression:
        'JSON.stringify({ incident_id: input.messages?.[0]?.incident?.id, service: input.messages?.[0]?.incident?.service?.summary, severity: input.messages?.[0]?.incident?.urgency, title: input.messages?.[0]?.incident?.title, html_url: input.messages?.[0]?.incident?.html_url, owner: input.messages?.[0]?.incident?.assignments?.[0]?.assignee?.summary })',
      description: 'Pull the fields downstream agents need into a flat object.',
    },
    position: { x: 250, y: 200 },
  },
  {
    id: 'multi-troubleshoot',
    type: 'multi_agent',
    data: {
      label: 'Live Troubleshoot Pool',
      maxConcurrency: 4,
      aggregationStrategy: 'merge',
      sharedContext: true,
      timeoutMs: 120000,
      agents: [
        {
          role: 'aws_diagnostician',
          taskDescription:
            'Investigate the AWS side. Use cloudwatch_logs, ecs_describe, and rds_metrics to find anomalies in the affected service. Return findings as JSON: { findings: [...], confidence: 0..1, evidence_urls: [...] }.\n\nIncident: {{steps.extract-metadata.output}}',
          tools: ['cloudwatch_logs', 'ecs_describe', 'rds_metrics'],
          mcp_server: 'openagentic_aws',
        },
        {
          role: 'azure_diagnostician',
          taskDescription:
            'Investigate the Azure side. Use monitor_metrics, kusto_logs, and aks_describe to find anomalies. Return findings as JSON.\n\nIncident: {{steps.extract-metadata.output}}',
          tools: ['monitor_metrics', 'kusto_logs', 'aks_describe'],
          mcp_server: 'openagentic_azure',
        },
        {
          role: 'k8s_diagnostician',
          taskDescription:
            'Investigate the Kubernetes layer. Use events, top_pods, and prom_query to find pod health and resource pressure. Return findings as JSON.\n\nIncident: {{steps.extract-metadata.output}}',
          tools: ['events', 'top_pods', 'prom_query'],
          mcp_server: 'openagentic_kubernetes',
        },
        {
          role: 'log_searcher',
          taskDescription:
            'Search Splunk for log events correlated with this incident in the 30 minutes before the trigger. Return findings as JSON: { suspicious_events: [...], pattern_summary: "..." }.\n\nIncident: {{steps.extract-metadata.output}}',
          tools: ['splunk_search'],
        },
      ],
    },
    position: { x: 500, y: 200 },
  },
  {
    id: 'merge-findings',
    type: 'merge',
    data: {
      label: 'Combine Findings',
      strategy: 'combine',
      description: 'Aggregate the four parallel diagnosticians into one document.',
    },
    position: { x: 750, y: 200 },
  },
  {
    id: 'synthesize-fix',
    type: 'openagentic_llm',
    data: {
      label: 'Synthesize Fix Proposal',
      systemPrompt:
        'You are a senior SRE. Given infrastructure findings, propose ONE fix action. Output STRICT JSON with this shape: { rootCause: string, evidence: string[], fix: { kind: "rollback"|"restart"|"scale"|"config_patch"|"manual", command: string, risk: "low"|"medium"|"high", runbook: string }, confidence: 0..1 }. If you do not have enough information to propose a confident fix, set confidence < 0.5 and explain in rootCause. Do not fabricate.',
      prompt:
        'Findings from four diagnostician agents:\n\n{{steps.merge-findings.output}}\n\nIncident:\n{{steps.extract-metadata.output}}',
      temperature: 0.2,
      maxTokens: 2048,
    },
    position: { x: 1000, y: 200 },
  },
  {
    id: 'post-fix-note',
    type: 'slack_message',
    data: {
      label: 'Post Fix Proposal',
      webhookUrl: '{{secret:SLACK_WEBHOOK_URL}}',
      message:
        '🤖 *OpenAgentic triage proposes a fix for incident `{{steps.extract-metadata.output.incident_id}}`*\n```\n{{steps.synthesize-fix.output.content}}\n```\nReply *approve* to apply, *reject* with feedback to re-triage. Timeout: 15min.',
    },
    position: { x: 1250, y: 200 },
  },
  {
    id: 'await-approval',
    type: 'human_approval',
    data: {
      label: 'Await PD Note Reply (HITL)',
      message:
        'Reviewer should approve or reject the proposed fix on the open PagerDuty incident.',
      timeout: 900,
      channel: 'pagerduty',
      pollIncidentId: '{{steps.extract-metadata.output.incident_id}}',
      description:
        'Origin-aware approval — polls the open PD incident for a reply containing "approve" / "reject" and uses that as the gate.',
    },
    position: { x: 1500, y: 200 },
  },
  {
    id: 'route-decision',
    type: 'condition',
    data: {
      label: 'Approved?',
      condition: '{{steps.await-approval.output.decision === "approved"}}',
      expression: 'steps["await-approval"].output.decision === "approved"',
    },
    position: { x: 1750, y: 200 },
  },
  {
    id: 'apply-fix',
    type: 'mcp_tool',
    data: {
      label: 'Apply Fix Command',
      icon: 'Wrench',
      color: '#00bcd4',
      toolServer: 'openagentic_kubernetes',
      toolName: 'k8s_apply_yaml',
      arguments: {
        manifest: '{{steps.synthesize-fix.output.content.fix.manifest}}',
        namespace: '{{steps.synthesize-fix.output.content.fix.namespace}}',
      },
      description:
        'Applies the proposed remediation manifest to the cluster via the openagentic_kubernetes MCP. High-risk commands routed through a second human gate (configurable in Governance).',
    },
    position: { x: 2000, y: 100 },
  },
  {
    id: 'verify-resolution',
    type: 'k8s_sandbox_run',
    data: {
      label: 'Verify Fix Cleared the Alert',
      operation: 'apply_and_wait',
      manifest: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: verify-probe\n  labels:\n    app: openagentic-verify\nspec:\n  restartPolicy: Never\n  containers:\n    - name: probe\n      image: curlimages/curl:8.5.0\n      command: ["sh", "-c"]\n      args:\n        - curl -fsS "{{secret:PROMETHEUS_URL}}/api/v1/query?query=up"\n',
      timeoutSeconds: 60,
      cpuLimit: '100m',
      memoryLimit: '128Mi',
      description:
        'Re-runs the original Prometheus alert query in a sandbox pod to confirm metrics returned to baseline.',
    },
    position: { x: 2250, y: 100 },
  },
  {
    id: 'pd-resolve',
    type: 'pagerduty_incident',
    data: {
      label: 'Resolve Incident on PagerDuty',
      action: 'resolve',
      routingKey: '{{secret:PAGERDUTY_ROUTING_KEY}}',
      dedupKey: '{{steps.extract-metadata.output.incident_id}}',
      resolutionMessage:
        'Auto-resolved by OpenAgentic triage. Fix: {{steps.synthesize-fix.output.content.fix.command}}. Verification: {{steps.verify-resolution.output.exitCode}} ({{steps.verify-resolution.output.stdout}}).',
      source: 'openagentic-auto-triage',
    },
    position: { x: 2500, y: 100 },
  },
  {
    id: 'post-mortem-slack',
    type: 'slack_message',
    data: {
      label: 'Post-Mortem to #incidents-postmortem',
      webhookUrl: '{{secret:SLACK_INCIDENTS_WEBHOOK_URL}}',
      channel: '{{trigger.input.postmortemChannel}}',
      message:
        ':white_check_mark: *Auto-triaged + resolved*\n>Title: {{steps.extract-metadata.output.title}}\n>Owner: {{steps.extract-metadata.output.owner}}\n>Root cause: {{steps.synthesize-fix.output.content.rootCause}}\n>Fix applied: `{{steps.synthesize-fix.output.content.fix.command}}`\n>Confidence: {{steps.synthesize-fix.output.content.confidence}}\n>PD: {{steps.extract-metadata.output.html_url}}',
    },
    position: { x: 2750, y: 100 },
  },
  {
    id: 'retriage-with-feedback',
    type: 'openagentic_llm',
    data: {
      label: 'Re-Triage with Reviewer Feedback',
      systemPrompt:
        'You are a senior SRE. The previous fix proposal was rejected. Use the reviewer feedback to revise. Output the same JSON shape as before.',
      prompt:
        'Original findings:\n{{steps.merge-findings.output}}\n\nOriginal proposal:\n{{steps.synthesize-fix.output.content}}\n\nReviewer feedback:\n{{steps.await-approval.output.feedback}}',
      temperature: 0.3,
      maxTokens: 2048,
    },
    position: { x: 2000, y: 300 },
  },
  {
    id: 'post-revised-note',
    type: 'slack_message',
    data: {
      label: 'Post Revised Proposal',
      webhookUrl: '{{secret:SLACK_WEBHOOK_URL}}',
      message:
        '🔁 *Revised proposal for incident `{{steps.extract-metadata.output.incident_id}}`*\n```\n{{steps.retriage-with-feedback.output.content}}\n```',
    },
    position: { x: 2250, y: 300 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e-trig-extract', source: 'trigger-pd-webhook', target: 'extract-metadata' },
  { id: 'e-extract-multi', source: 'extract-metadata', target: 'multi-troubleshoot' },
  { id: 'e-multi-merge', source: 'multi-troubleshoot', target: 'merge-findings' },
  { id: 'e-merge-syn', source: 'merge-findings', target: 'synthesize-fix' },
  { id: 'e-syn-note', source: 'synthesize-fix', target: 'post-fix-note' },
  { id: 'e-note-await', source: 'post-fix-note', target: 'await-approval' },
  { id: 'e-await-route', source: 'await-approval', target: 'route-decision' },
  { id: 'e-approved', source: 'route-decision', target: 'apply-fix', label: 'approved', sourceHandle: 'true' },
  { id: 'e-apply-verify', source: 'apply-fix', target: 'verify-resolution' },
  { id: 'e-verify-resolve', source: 'verify-resolution', target: 'pd-resolve' },
  { id: 'e-resolve-slack', source: 'pd-resolve', target: 'post-mortem-slack' },
  { id: 'e-rejected', source: 'route-decision', target: 'retriage-with-feedback', label: 'rejected', sourceHandle: 'false' },
  { id: 'e-retriage-note', source: 'retriage-with-feedback', target: 'post-revised-note' },
  { id: 'e-revise-await', source: 'post-revised-note', target: 'await-approval' },
];
