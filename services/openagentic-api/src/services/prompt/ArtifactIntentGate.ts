import type { UserIntent } from './types.js';

/**
 * ArtifactIntentGate
 *
 * Evaluates whether a user message expresses an explicit intent for visual
 * artifacts (charts, diagrams, dashboards, etc.). The result is used by
 * PromptComposer to gate inclusion of artifact-related modules.
 *
 * Background — openagentic-your-deployment#327:
 * Earlier behaviour relied on broad keyword heuristics (e.g. `'costs'`,
 * `'show me'`, `'breakdown'`, or "two cloud-related keywords") to decide
 * whether to inject a thousand+ tokens of artifact-creation guidance.
 * That fired for almost every cloud / cost question, biasing the model
 * toward generating Sankey diagrams and React dashboards even when the
 * user simply asked a factual question. This gate replaces those
 * heuristics with a narrow, intent-driven check.
 *
 * Design notes:
 * - The gate ONLY returns 'visualization' on explicit signals. If the
 *   user just mentions "cost" or asks "what services do I have", the
 *   gate returns null (no artifact bias).
 * - The gate is intentionally conservative — false negatives (no artifact
 *   when one might be nice) are cheaper than false positives (artifact
 *   when the user wanted text). Users can always ask for a chart explicitly.
 * - The reason field exists for observability — it is logged so future
 *   regressions can be debugged from k8s logs without a code change.
 */

const VISUAL_NOUNS = [
  'chart', 'charts',
  'graph', 'graphs',
  'diagram', 'diagrams',
  'dashboard', 'dashboards',
  'visualization', 'visualisations', 'visualizations', 'visualisation',
  'sankey',
  'flowchart',
  'timeline',
  'gantt',
  'heatmap',
  'treemap',
  'mindmap',
  'mind map',
  'pie chart',
  'bar chart',
  'line chart',
  'scatter plot',
  'reactflow diagram',
  'd2 diagram',
  'er diagram',
  'uml diagram',
  'class diagram',
  'state diagram',
  'sequence diagram',
  'architecture diagram',
  'network diagram',
  'org chart',
  'infographic',
];

/**
 * Verbs that, when paired with a visual noun OR with the word "it" / "this"
 * in a clearly visual context, signal explicit intent.
 */
const VISUAL_VERBS = [
  'chart',
  'graph',
  'diagram',
  'visualize', 'visualise',
  'render',
  'plot',
  'draw',
  'illustrate',
];

/**
 * Phrases that almost always signal explicit intent regardless of nouns.
 */
const EXPLICIT_PHRASES = [
  'create a chart',
  'create chart',
  'create a graph',
  'create graph',
  'create a diagram',
  'create diagram',
  'create a dashboard',
  'create dashboard',
  'create a visualization',
  'create a visualisation',
  'create a sankey',
  'create a flowchart',
  'create a timeline',
  'create a gantt',
  'create an infographic',
  'make a chart',
  'make a graph',
  'make a diagram',
  'make a dashboard',
  'make a visualization',
  'make a visualisation',
  'make a sankey',
  'make a flowchart',
  'make an infographic',
  'build a dashboard',
  'build a chart',
  'build a diagram',
  'render a chart',
  'render a diagram',
  'render an artifact',
  'as a chart',
  'as a graph',
  'as a diagram',
  'as a dashboard',
  'as a sankey',
  'as a visualization',
  'as a visualisation',
  'as an artifact',
  'in chart form',
  'in graph form',
  'in diagram form',
  'visualize this',
  'visualise this',
  'visualize it',
  'visualise it',
  'visualize the',
  'visualise the',
  'plot this',
  'plot it',
  'plot the',
  'graph this',
  'graph it',
  'chart this',
  'chart it',
];

export interface IntentDecision {
  intent: UserIntent | null;
  reason: string;
  matched?: string;
}

function lower(s: string | undefined | null): string {
  return (s || '').toLowerCase();
}

/**
 * Check whether `haystack` contains `needle` as a whole-word match (rather
 * than a substring). Avoids "service" matching "services" by accident, etc.
 *
 * Treats hyphens, periods, and apostrophes as word characters so phrases
 * like "in chart form" still match cleanly.
 */
function containsWord(haystack: string, needle: string): boolean {
  if (needle.includes(' ')) {
    // Multi-word phrases — use substring match with word boundaries on the ends
    const re = new RegExp(`(^|[^\\w])${escapeRegex(needle)}([^\\w]|$)`, 'i');
    return re.test(haystack);
  }
  const re = new RegExp(`(^|[^\\w])${escapeRegex(needle)}([^\\w]|$)`, 'i');
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Evaluate user intent for visual artifacts.
 *
 * Returns `{ intent: 'visualization', reason }` when the message contains an
 * explicit visualization request. Returns `{ intent: null, reason }` otherwise.
 */
export function evaluateUserIntent(message: string | undefined | null): IntentDecision {
  const text = lower(message);

  if (!text.trim()) {
    return { intent: null, reason: 'empty-message' };
  }

  // 1. Explicit phrases — strongest signal
  for (const phrase of EXPLICIT_PHRASES) {
    if (containsWord(text, phrase)) {
      return { intent: 'visualization', reason: 'explicit-phrase', matched: phrase };
    }
  }

  // 2. Visual nouns — if a recognised noun appears anywhere, treat as visual
  //    intent. These nouns are unambiguous ("sankey", "dashboard", "chart"
  //    etc.) — no false positives expected.
  for (const noun of VISUAL_NOUNS) {
    if (containsWord(text, noun)) {
      return { intent: 'visualization', reason: 'visual-noun', matched: noun };
    }
  }

  // 3. Visual verbs combined with an object marker — guards against "graph"
  //    appearing as a generic word in technical text.
  //    Pattern: <verb> <article|determiner> <something>  e.g. "draw a flow"
  for (const verb of VISUAL_VERBS) {
    const re = new RegExp(
      `(^|[^\\w])${escapeRegex(verb)}\\s+(a|an|the|this|that|it|me|us)(\\b|\\s)`,
      'i',
    );
    if (re.test(text)) {
      return { intent: 'visualization', reason: 'visual-verb-object', matched: verb };
    }
  }

  return { intent: null, reason: 'no-visual-signal' };
}
