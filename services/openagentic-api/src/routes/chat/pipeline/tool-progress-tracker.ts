/**
 * Tool Progress Tracker — Layer 2 of the ReAct+Reflection cognitive loop.
 *
 * Analyzes tool execution history and generates a progress summary
 * injected into the continuation prompt between rounds.
 * Pure heuristics — zero LLM calls.
 */

export interface ToolProgressSummary {
  totalRounds: number;
  totalToolCalls: number;
  successfulCalls: number;
  failedCalls: number;
  uniqueToolsUsed: string[];
  dataGathered: string[];
  remainingGaps: string[];
}

/**
 * Maps tool name prefixes → user-facing labels + user intent keywords.
 * When a user message contains a keyword and no matching tool has been called,
 * the gap is surfaced in the progress summary.
 */
const TOOL_CATEGORIES: Record<string, { keywords: string[]; label: string }> = {
  azure_cost:       { keywords: ['azure cost', 'azure spend', 'azure billing'],          label: 'Azure costs' },
  azure_arm:        { keywords: ['azure resource', 'azure vm', 'azure infra'],           label: 'Azure resources' },
  azure_graph:      { keywords: ['azure ad', 'azure user', 'entra'],                     label: 'Azure AD / Entra' },
  aws_cost:         { keywords: ['aws cost', 'aws spend', 'aws billing'],                label: 'AWS costs' },
  aws_:             { keywords: ['aws'],                                                  label: 'AWS resources' },
  gcp_:             { keywords: ['gcp', 'google cloud'],                                 label: 'GCP resources' },
  k8s_:             { keywords: ['kubernetes', 'k8s', 'pod', 'deploy', 'namespace', 'cluster'], label: 'Kubernetes status' },
  prometheus_:      { keywords: ['metric', 'prometheus', 'monitor'],                     label: 'Prometheus metrics' },
  loki_:            { keywords: ['log', 'loki'],                                          label: 'Log data' },
  alertmanager_:    { keywords: ['alert', 'alertmanager', 'firing'],                     label: 'Alert status' },
  github_:          { keywords: ['github', 'repo', 'pr', 'commit', 'pull request'],     label: 'GitHub data' },
  web_search:       { keywords: ['search', 'research', 'find'],                          label: 'Web search results' },
  knowledge_:       { keywords: ['knowledge', 'runbook', 'doc'],                         label: 'Knowledge base' },
  synth_:           { keywords: ['file', 'process', 'parse', 'analyze'],                 label: 'File processing' },
  incident_:        { keywords: ['incident', 'page', 'oncall'],                          label: 'Incident data' },
};

export class ToolProgressTracker {

  /**
   * Analyze mcpCalls and user intent to produce a progress summary.
   */
  static summarize(
    mcpCalls: any[],
    userMessage: string,
    round: number,
  ): ToolProgressSummary {
    const successful = mcpCalls.filter((c: any) => c.status !== 'failed' && !c.error);
    const failed = mcpCalls.filter((c: any) => c.status === 'failed' || c.error);
    const uniqueTools = [...new Set(mcpCalls.map((c: any) => c.name || c.toolName || ''))];

    // Determine which categories have been covered by successful calls
    const coveredCategories = new Set<string>();
    const dataGathered: string[] = [];

    for (const [prefix, meta] of Object.entries(TOOL_CATEGORIES)) {
      const matched = successful.some((c: any) => {
        const name = (c.name || c.toolName || '').toLowerCase();
        return name.startsWith(prefix) || name.includes(prefix.replace(/_$/, ''));
      });
      if (matched) {
        coveredCategories.add(prefix);
        if (!dataGathered.includes(meta.label)) {
          dataGathered.push(meta.label);
        }
      }
    }

    // Identify gaps: user intent keywords not covered by any successful tool category
    const msgLower = userMessage.toLowerCase();
    const remainingGaps: string[] = [];

    for (const [prefix, meta] of Object.entries(TOOL_CATEGORIES)) {
      if (coveredCategories.has(prefix)) continue;
      const userWants = meta.keywords.some(kw => msgLower.includes(kw));
      if (userWants) {
        remainingGaps.push(meta.label);
      }
    }

    return {
      totalRounds: round,
      totalToolCalls: mcpCalls.length,
      successfulCalls: successful.length,
      failedCalls: failed.length,
      uniqueToolsUsed: uniqueTools,
      dataGathered,
      remainingGaps,
    };
  }

  /**
   * Format the summary as a concise text block for prompt injection.
   * Capped at ~100 tokens to minimize context usage.
   */
  static formatForInjection(summary: ToolProgressSummary): string {
    const parts: string[] = [];

    parts.push(
      `[Progress: Round ${summary.totalRounds} | ${summary.totalToolCalls} calls, ` +
      `${summary.successfulCalls} succeeded` +
      (summary.failedCalls > 0 ? `, ${summary.failedCalls} failed` : '') +
      ']',
    );

    if (summary.dataGathered.length > 0) {
      parts.push(`Gathered: ${summary.dataGathered.join(', ')}`);
    }

    if (summary.remainingGaps.length > 0) {
      parts.push(`Remaining: ${summary.remainingGaps.join(', ')}`);
    }

    return parts.join('\n');
  }
}
