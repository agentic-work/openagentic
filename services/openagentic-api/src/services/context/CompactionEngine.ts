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
 * CompactionEngine
 *
 * Two-tier conversation compaction:
 *   1. Heuristic — fast, no LLM call. Extracts tool names, cloud providers, user topics, entities, errors.
 *   2. LLM — calls platform economy-tier model, falls back to heuristic on failure.
 */

import { logger } from '../../utils/logger.js';
import { TokenCounter } from './TokenCounter.js';
import type { StructuredSummary } from './types.js';
import type { ProviderManager } from '../llm-providers/ProviderManager.js';

const log = logger.child({ component: 'CompactionEngine' });

// ─── Cloud provider detection ────────────────────────────────────────────────

const CLOUD_PROVIDER_PREFIXES: Record<string, string> = {
  azure_: 'Azure',
  aws_: 'AWS',
  call_aws: 'AWS',
  gcp_: 'GCP',
  k8s_: 'Kubernetes',
  github_: 'GitHub',
};

function detectCloudProviders(toolNames: string[]): string[] {
  const found = new Set<string>();
  for (const name of toolNames) {
    const lower = name.toLowerCase();
    for (const [prefix, label] of Object.entries(CLOUD_PROVIDER_PREFIXES)) {
      if (lower.startsWith(prefix)) {
        found.add(label);
        break;
      }
    }
  }
  return Array.from(found);
}

// ─── Topic extraction ─────────────────────────────────────────────────────────

// Simple keyword patterns that signal the topic of a user question
const TOPIC_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /deploy|helm|kubectl|rollout|upgrade/i, label: 'deployment' },
  { re: /cost|billing|spend|budget|invoice/i, label: 'cost-management' },
  { re: /security|audit|compliance|vulnerability|cve/i, label: 'security' },
  { re: /incident|alert|outage|pagerduty|opsgenie/i, label: 'incident-response' },
  { re: /monitor|metric|prometheus|grafana|dashboard/i, label: 'monitoring' },
  { re: /log|loki|splunk|cloudwatch|logg/i, label: 'logging' },
  { re: /database|postgres|mysql|redis|mongo/i, label: 'database' },
  { re: /code|review|pr|pull request|diff|lint/i, label: 'code-review' },
  { re: /research|analys|report|summar/i, label: 'research' },
  { re: /onboard|workflow|automat/i, label: 'automation' },
];

function extractTopics(userMessages: string[]): string[] {
  const found = new Set<string>();
  for (const text of userMessages) {
    for (const { re, label } of TOPIC_PATTERNS) {
      if (re.test(text)) {
        found.add(label);
      }
    }
  }
  return Array.from(found);
}

// ─── Entity extraction ─────────────────────────────────────────────────────────

/**
 * Very lightweight named-entity extraction:
 * - Proper nouns (words starting with capital letter in middle of sentence)
 * - Words in quotes
 * - Potential service/resource names
 */
function extractEntities(allText: string): string[] {
  const entities = new Set<string>();

  // Words in single or double quotes
  const quotedRe = /["']([A-Za-z0-9_\-./]{2,40})["']/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(allText)) !== null) {
    entities.add(m[1]);
  }

  // Uppercase acronyms (2-8 caps) — likely service names
  const acronymRe = /\b([A-Z]{2,8})\b/g;
  while ((m = acronymRe.exec(allText)) !== null) {
    entities.add(m[1]);
  }

  return Array.from(entities).slice(0, 20); // keep top 20
}

// ─── Error extraction ─────────────────────────────────────────────────────────

const ERROR_PATTERNS = [
  /error[:\s]+([^\n.]{5,80})/gi,
  /exception[:\s]+([^\n.]{5,80})/gi,
  /failed[:\s]+([^\n.]{5,80})/gi,
  /timeout[:\s]+([^\n.]{5,80})/gi,
];

function extractErrors(allText: string): string[] {
  const errors = new Set<string>();
  for (const re of ERROR_PATTERNS) {
    let m: RegExpExecArray | null;
    const localRe = new RegExp(re.source, re.flags);
    while ((m = localRe.exec(allText)) !== null) {
      errors.add(m[1].trim().slice(0, 120));
    }
  }
  return Array.from(errors).slice(0, 10);
}

// ─── Main class ───────────────────────────────────────────────────────────────

export class CompactionEngine {
  private tokenCounter: TokenCounter;

  constructor() {
    this.tokenCounter = new TokenCounter();
  }

  /**
   * Fast heuristic summary — no LLM call.
   * Extracts tools, cloud providers, user questions/topics, key entities, errors.
   */
  generateHeuristicSummary(messages: any[]): StructuredSummary {
    if (!messages || messages.length === 0) {
      return this.emptySummary();
    }

    const toolsUsed: string[] = [];
    const userTexts: string[] = [];
    const allParts: string[] = [];

    for (const msg of messages) {
      const role = msg.role || '';
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
          ? msg.content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join(' ')
          : '';

      allParts.push(content);

      if (role === 'user') {
        userTexts.push(content);
      }

      // Extract tool calls
      const calls = msg.toolCalls || msg.tool_calls || [];
      for (const call of calls) {
        const name =
          call?.function?.name || call?.name || call?.tool_name || '';
        if (name && !toolsUsed.includes(name)) {
          toolsUsed.push(name);
        }
      }
      // Also check tool role messages for tool_name
      if (role === 'tool' && msg.name && !toolsUsed.includes(msg.name)) {
        toolsUsed.push(msg.name);
      }
    }

    const allText = allParts.join('\n');
    const cloudProviders = detectCloudProviders(toolsUsed);
    const topics = extractTopics(userTexts);
    const keyEntities = extractEntities(allText);
    const errorsSeen = extractErrors(allText);

    // Build a concise summary text
    const lines: string[] = [];
    if (userTexts.length > 0) {
      lines.push(`Session covered ${userTexts.length} user interactions.`);
    }
    if (topics.length > 0) {
      lines.push(`Topics: ${topics.join(', ')}.`);
    }
    if (toolsUsed.length > 0) {
      lines.push(`Tools used: ${toolsUsed.slice(0, 15).join(', ')}.`);
    }
    if (cloudProviders.length > 0) {
      lines.push(`Cloud providers: ${cloudProviders.join(', ')}.`);
    }
    if (errorsSeen.length > 0) {
      lines.push(`Errors encountered: ${errorsSeen.slice(0, 3).join('; ')}.`);
    }

    const text = lines.join(' ');
    const tokenCount = this.tokenCounter.estimateTokens(text);

    return {
      text,
      topics,
      toolsUsed,
      keyDecisions: [],
      cloudProviders,
      artifacts: [],
      errorsSeen,
      tokenCount,
    };
  }

  /**
   * LLM-based summary using the economy-tier model.
   * Falls back to heuristic on any failure.
   */
  async generateLLMSummary(
    messages: any[],
    providerManager: ProviderManager
  ): Promise<StructuredSummary> {
    if (!messages || messages.length === 0) {
      return this.emptySummary();
    }

    try {
      // Build a condensed transcript for the LLM
      const transcript = this.buildTranscript(messages);

      const systemPrompt =
        'You are a conversation summarizer. Given a conversation transcript, produce a concise structured summary. ' +
        'Return JSON with exactly these fields: text (string), topics (string[]), toolsUsed (string[]), ' +
        'keyDecisions (string[]), cloudProviders (string[]), artifacts (string[]), errorsSeen (string[]).';

      const userPrompt = `Summarize this conversation transcript in under 500 words:\n\n${transcript}`;

      const response = await (providerManager as any).createCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        // Use economy tier via slider if supported
        sliderValue: 20,
      });

      // Extract text content
      const rawContent =
        response?.choices?.[0]?.message?.content || '';

      // Parse JSON if possible
      try {
        const parsed = JSON.parse(rawContent);
        const summary: StructuredSummary = {
          text: String(parsed.text || ''),
          topics: Array.isArray(parsed.topics) ? parsed.topics : [],
          toolsUsed: Array.isArray(parsed.toolsUsed) ? parsed.toolsUsed : [],
          keyDecisions: Array.isArray(parsed.keyDecisions) ? parsed.keyDecisions : [],
          cloudProviders: Array.isArray(parsed.cloudProviders) ? parsed.cloudProviders : [],
          artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
          errorsSeen: Array.isArray(parsed.errorsSeen) ? parsed.errorsSeen : [],
          tokenCount: this.tokenCounter.estimateTokens(parsed.text || ''),
        };
        log.debug({ tokens: summary.tokenCount }, 'LLM summary generated');
        return summary;
      } catch {
        // LLM returned prose, not JSON — wrap it
        return {
          text: rawContent.slice(0, 2000),
          topics: [],
          toolsUsed: [],
          keyDecisions: [],
          cloudProviders: [],
          artifacts: [],
          errorsSeen: [],
          tokenCount: this.tokenCounter.estimateTokens(rawContent),
        };
      }
    } catch (err) {
      log.warn({ err }, 'LLM summary failed, falling back to heuristic');
      return this.generateHeuristicSummary(messages);
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private emptySummary(): StructuredSummary {
    return {
      text: '',
      topics: [],
      toolsUsed: [],
      keyDecisions: [],
      cloudProviders: [],
      artifacts: [],
      errorsSeen: [],
      tokenCount: 0,
    };
  }

  private buildTranscript(messages: any[]): string {
    return messages
      .map((msg) => {
        const role = msg.role || 'unknown';
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
            ? msg.content.map((c: any) => (typeof c === 'string' ? c : c?.text || '')).join(' ')
            : '';
        return `${role.toUpperCase()}: ${content.slice(0, 500)}`;
      })
      .join('\n')
      .slice(0, 8000); // cap at 8K chars to avoid huge prompts
  }
}
