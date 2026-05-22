/**
 * Template 04 — K8s Cluster Health (read-only)
 *
 * Flow: trigger → k8s_cluster_health → k8s_list_nodes → k8s_list_pods (target ns)
 *       → llm_completion (synthesize report) → slack_message (post summary)
 *
 * Why no kubectl pod: the previous version applied a privileged Pod with
 * the `bitnami/kubectl` image into a sandbox namespace just to run
 * `kubectl get …` and read its logs. That requires
 *   (a) cluster permissions to spawn pods,
 *   (b) RBAC inside the spawned pod to read state, and
 *   (c) a 5-minute roundtrip for what is fundamentally a few API calls.
 * oap-kubernetes-mcp exposes the same data as direct, read-only RPC
 * tools, so this template uses those instead. The flow is now safe to
 * run hourly with zero pod churn.
 *
 * Trigger inputs let the operator point the probe at a different
 * namespace without editing the template — defaults to agentic-dev
 * so first-run on chat-dev produces useful output immediately.
 */

import type { WorkflowNode, WorkflowEdge } from '@openagentic/workflow-engine';

export const nodes: WorkflowNode[] = [
  {
    id: 'trigger-1',
    type: 'trigger',
    data: {
      label: 'Schedule — Hourly Health Check',
      triggerType: 'schedule',
      schedule: '0 * * * *',
      description: 'Runs the K8s cluster health probe every hour.',
      inputs: [
        {
          name: 'targetNamespace',
          label: 'Target namespace',
          type: 'string',
          required: false,
          // Default is read at seed time from K8S_NAMESPACE env via process.env
          // (the seed file is import-time, runs before featureFlags is evaluated
          // in some cases). No literal fallback — feedback_no_hardcoded_namespaces.md.
          default: process.env.K8S_NAMESPACE || '',
          description: 'Namespace to inspect for pod health (probe is cluster-wide for nodes/health).',
        },
        {
          name: 'slackChannel',
          label: 'Slack channel',
          type: 'string',
          required: false,
          default: '#cluster-health',
          description: 'Where to post the report.',
        },
      ],
    },
    position: { x: 0, y: 0 },
  },
  {
    id: 'mcp-cluster-health',
    type: 'mcp_tool',
    data: {
      label: 'Cluster Health',
      icon: 'Activity',
      color: '#00bcd4',
      toolServer: 'openagentic_kubernetes',
      toolName: 'k8s_cluster_health',
      arguments: {},
      description: 'Reads node status, component health, and overall cluster condition.',
    },
    position: { x: 260, y: -120 },
  },
  {
    id: 'mcp-list-nodes',
    type: 'mcp_tool',
    data: {
      label: 'Node Resources',
      icon: 'Cpu',
      color: '#00bcd4',
      toolServer: 'openagentic_kubernetes',
      toolName: 'k8s_list_nodes',
      arguments: {},
      description: 'Lists every node with capacity, allocatable resources, and ready state.',
    },
    position: { x: 260, y: 0 },
  },
  {
    id: 'mcp-list-pods',
    type: 'mcp_tool',
    data: {
      label: 'Pods in target namespace',
      icon: 'Server',
      color: '#00bcd4',
      toolServer: 'openagentic_kubernetes',
      toolName: 'k8s_list_pods',
      arguments: {
        namespace: '{{trigger.input.targetNamespace}}',
      },
      description: 'Lists pods (and restart counts) in the operator-selected namespace.',
    },
    position: { x: 260, y: 120 },
  },
  {
    id: 'llm-analyze-1',
    type: 'llm_completion',
    data: {
      label: 'LLM — Analyze Cluster Health',
      prompt:
        'You are a Kubernetes SRE. Combine the three read-only probes below into a concise health report.\n\n' +
        'Include:\n' +
        '1. Overall cluster health: HEALTHY / DEGRADED / CRITICAL\n' +
        '2. Node status summary (counts of Ready vs NotReady, anything notable)\n' +
        '3. Pods in abnormal state in {{trigger.input.targetNamespace}} (CrashLoopBackOff, ImagePullBackOff, high restart count, Pending > 5 min)\n' +
        '4. Recommended immediate actions (if any). Always non-destructive — never recommend deletes.\n\n' +
        'Return JSON: { "healthStatus": "HEALTHY|DEGRADED|CRITICAL", "summary": "<paragraph>", "nodeCount": <n>, "readyNodes": <n>, "problemPods": [], "recommendedActions": [] }\n\n' +
        'Cluster health probe:\n{{steps.mcp-cluster-health.output}}\n\n' +
        'Nodes:\n{{steps.mcp-list-nodes.output}}\n\n' +
        'Pods in {{trigger.input.targetNamespace}}:\n{{steps.mcp-list-pods.output}}',
      model: 'auto',
      outputFormat: 'json',
    },
    position: { x: 560, y: 0 },
  },
  {
    id: 'slack-summary-1',
    type: 'slack_message',
    data: {
      label: 'Slack — Cluster Health Summary',
      webhookUrl: '{{secret:SLACK_ONCALL_WEBHOOK_URL}}',
      channel: '{{trigger.input.slackChannel}}',
      message:
        ':kubernetes: *Cluster Health Report* — {{steps.llm-analyze-1.result.healthStatus}}\n\n' +
        '{{steps.llm-analyze-1.result.summary}}\n\n' +
        'Nodes: {{steps.llm-analyze-1.result.readyNodes}}/{{steps.llm-analyze-1.result.nodeCount}} Ready  |  ' +
        'Problem pods in {{trigger.input.targetNamespace}}: {{steps.llm-analyze-1.result.problemPods.length}}',
    },
    position: { x: 860, y: 0 },
  },
];

export const edges: WorkflowEdge[] = [
  { id: 'e1', source: 'trigger-1', target: 'mcp-cluster-health' },
  { id: 'e2', source: 'trigger-1', target: 'mcp-list-nodes' },
  { id: 'e3', source: 'trigger-1', target: 'mcp-list-pods' },
  { id: 'e4', source: 'mcp-cluster-health', target: 'llm-analyze-1' },
  { id: 'e5', source: 'mcp-list-nodes', target: 'llm-analyze-1' },
  { id: 'e6', source: 'mcp-list-pods', target: 'llm-analyze-1' },
  { id: 'e7', source: 'llm-analyze-1', target: 'slack-summary-1' },
];
