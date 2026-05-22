/**
 * Phase A.4 — pure artifact-verb detector.
 *
 * Scans the user message for artifact-rendering verbs AND scenario patterns.
 * When the user named a visualization verb, OR the message matches a
 * scenario pattern, AND at least one MCP tool_result came back this turn,
 * returns `shouldForce: true` + the appropriate tool name so chatLoop can
 * set `tool_choice` on the next model call.
 *
 * Decision logic (in priority order):
 *   1. User message contains an artifact verb (word-boundary, case-insensitive).
 *   2. User message matches a SCENARIO_PATTERN (regex, case-insensitive).
 *   3. Structural complexity: mcpToolResultsThisTurn >= 3 AND message contains
 *      a cost/volume keyword (without a specific scenario shape already matched).
 *   For (1)+(2): mcpToolResultsThisTurn >= 1 (model has real data to render).
 *   For (3): mcpToolResultsThisTurn >= 3 is the threshold.
 *   Caller also checks that no compose_visual / compose_app has already been
 *   dispatched this turn (anti-loop; done in chatLoop).
 *
 * Classification:
 *   compose_visual — sankey, chart, diagram, plot, graph, flowchart,
 *                    render, draw, visualize, illustrate, cost breakdown/
 *                    analysis/spike, MoM/QoQ, dependency graph/map/tree,
 *                    structural-complexity numeric trigger
 *                    (single-frame static visual)
 *   compose_app    — dashboard, mini-app, simulator, interactive,
 *                    multi-panel, what-if, migration/phased plan, permission
 *                    matrix, onboarding flow, incident triage, compliance report
 *                    (interactive / multi-frame)
 *
 * When both classes match, prefer compose_visual (lower-cost emission
 * per existing tool description bias).
 *
 * No I/O. No imports from the rest of the codebase.
 *
 * Phase A.4ext.1: added SCENARIO_PATTERNS for mock-07/08/09/10/12 prompt shapes.
 * Phase A.4ext.2: added structural-complexity fallback (≥3 MCP + cost/volume kw).
 */

export interface ArtifactVerbResult {
  shouldForce: boolean;
  toolName?: 'compose_visual' | 'compose_app';
}

export interface ArtifactVerbDetectorInput {
  /** The latest user message text. */
  userMessage: string;
  /**
   * Number of MCP tool_results returned in this turn (BEFORE the next
   * model call). Force is only applied when >= 1 (or >= 3 for structural
   * complexity trigger).
   */
  mcpToolResultsThisTurn: number;
}

// ---------------------------------------------------------------------------
// Explicit-verb lists (original Phase A.4)
// ---------------------------------------------------------------------------

// Verbs that strongly imply a single-frame visualization (compose_visual).
//
// #905 Mock-01 extension: added `streaming-table` / `streaming table` /
// `cost breakdown table` so bare-noun prompts ("give me a streaming table
// of pods") force-dispatch the compose_visual tool instead of falling back
// to inline markdown. `sankey` is already present as the primary anchor
// for Mock-01's "show me my subs ... with cost sankey" capstone prompt.
const COMPOSE_VISUAL_VERBS = [
  'sankey',
  'chart',
  'diagram',
  'plot',
  'graph',
  'flowchart',
  'render',
  'draw',
  'visualize',
  'visualise',
  'illustrate',
  // #905 Mock-01 / streaming-table verb extension (2026-05-20).
  'streaming-table',
  'streaming table',
  'cost breakdown table',
  'cost-breakdown-table',
] as const;

/**
 * #947 — explicit-user-intent helper for the anti-bias gate.
 *
 * Returns true when the user message contains an explicit visualization verb
 * (`draw`, `diagram`, `render`, etc.) — i.e. they ASKED for the artifact.
 *
 * Used by chatLoop's ANTI_BIAS_GATED_COMPOSE_TOOLS check to bypass the
 * numeric-grounding requirement: when the user explicitly asked for a
 * diagram, there's no fabrication concern (the user knows the artifact
 * isn't from live data), so the gate should let it through even with zero
 * MCP tool_results in scope.
 *
 * Word-boundary, case-insensitive. Returns false for the empty/undefined
 * cases so the gate stays enforcing on text-only "tell me about X" prompts.
 */
export function userMessageHasExplicitArtifactVerb(text: string | undefined | null): boolean {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  // Use a STRICTER word-boundary matcher than the dispatch path — the
  // anti-bias-gate bypass must not fire on substrings ("drawer" should
  // NOT bypass because of "draw"). The dispatch-side `makeMatcher` is
  // intentionally lenient on trailing characters to catch plurals; the
  // gate-bypass side uses the stricter form so accidental substrings
  // don't open up the no-MCP fallback.
  for (const v of COMPOSE_VISUAL_VERBS) {
    if (makeBoundaryMatcher(v)(lower)) return true;
  }
  for (const v of COMPOSE_APP_VERBS) {
    if (makeBoundaryMatcher(v)(lower)) return true;
  }
  // 'architecture' is implicit ask for an arch_diagram even without an
  // explicit visualization verb. Catch it here too.
  if (/\barchitecture\b/i.test(lower)) return true;
  return false;
}

/**
 * #947 — non-data-driven template slugs that the anti-bias gate must always
 * let through. These templates are conceptual / structural by design — they
 * have NO numeric data input (arch diagrams describe relationships, not
 * measurements). Forcing them to wait for "structured numeric data from a
 * tool_result" is wrong by construction.
 */
const CONCEPTUAL_TEMPLATES: ReadonlySet<string> = new Set([
  'arch_diagram',
  'reactflow_arch',
  'network',
  'mermaid',
  'flow',
  'flowchart',
  'sequence',
  'erd',
]);

/**
 * #947 — true when the tool input names a conceptual template that doesn't
 * need data. Used by chatLoop's anti-bias gate as a second bypass condition.
 */
export function isConceptualTemplate(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const tmpl = (input as { template?: unknown }).template;
  if (typeof tmpl !== 'string') return false;
  return CONCEPTUAL_TEMPLATES.has(tmpl);
}

// Verbs that imply an interactive / multi-panel app (compose_app).
const COMPOSE_APP_VERBS = [
  'dashboard',
  'mini-app',
  'miniapp',
  'simulator',
  'interactive',
  'multi-panel',
  'multipanel',
  'what-if',
] as const;

/**
 * Build a word-boundary RegExp for a single verb.
 *
 * Uses `\b` anchors so "charts" matches "chart", "rendering" matches
 * "render", etc. — but "orchestra" does NOT match "chart".
 *
 * For hyphenated / space-separated terms (`mini-app`, `what-if`,
 * `streaming-table`, `cost breakdown table`), we expand the separator into
 * a `[-\s]` class so both `streaming-table` AND `streaming table` match
 * the same matcher. The literal characters in the verb are regex-escaped
 * to keep this lookup safe.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeMatcher(verb: string): (text: string) => boolean {
  if (verb.includes('-') || verb.includes(' ')) {
    // Allow either '-' or ' ' between word fragments — handle both
    // "streaming-table" and "streaming table" with one matcher.
    const parts = verb
      .toLowerCase()
      .split(/[-\s]+/)
      .map(escapeRegex);
    const pattern = parts.join('[-\\s]+');
    const re = new RegExp(`\\b${pattern}\\b`, 'i');
    return (text: string) => re.test(text);
  }
  // Leading \b anchors the start of the verb. We INTENTIONALLY allow
  // trailing characters (no \b on the right) so plurals/inflections match:
  // "charts" matches "chart", "rendering" matches "render", etc. The
  // detector path tolerates the wider match (it's a force-dispatch trigger,
  // false-positives are bounded by the MCP-result floor + scenario gating).
  const dispatchRe = new RegExp(`\\b${verb}`, 'i');
  return (text: string) => dispatchRe.test(text);
}

/**
 * Stricter word-boundary matcher used by `userMessageHasExplicitArtifactVerb`
 * — both leading AND trailing `\b` so the anti-bias-gate bypass doesn't
 * mistakenly fire on substrings ("drawer" must NOT bypass for "draw",
 * "charterer" must NOT bypass for "chart"). The dispatch detector above
 * stays permissive (trailing-end open) so plurals still trigger force.
 */
function makeBoundaryMatcher(verb: string): (text: string) => boolean {
  if (verb.includes('-') || verb.includes(' ')) {
    const parts = verb
      .toLowerCase()
      .split(/[-\s]+/)
      .map(escapeRegex);
    const pattern = parts.join('[-\\s]+');
    const re = new RegExp(`\\b${pattern}\\b`, 'i');
    return (text: string) => re.test(text);
  }
  const re = new RegExp(`\\b${verb}\\b`, 'i');
  return (text: string) => re.test(text);
}

const VISUAL_MATCHERS = COMPOSE_VISUAL_VERBS.map(makeMatcher);
const APP_MATCHERS = COMPOSE_APP_VERBS.map(makeMatcher);

// ---------------------------------------------------------------------------
// Phase A.4ext.1 — SCENARIO_PATTERNS
//
// Each entry: { pattern: RegExp; toolName: 'compose_visual' | 'compose_app' }
//
// Patterns are case-insensitive and require the SCENARIO shape — not bare
// keywords. A prompt like "what's the history of cost accounting" mentions
// "cost" but has no spike/breakdown/analysis anchor, so it does NOT match.
// ---------------------------------------------------------------------------

interface ScenarioPattern {
  pattern: RegExp;
  toolName: 'compose_visual' | 'compose_app';
}

const SCENARIO_PATTERNS: ScenarioPattern[] = [
  // -------------------------------------------------------------------------
  // Mock-07: cost spike / top-N analysis across clouds
  // -------------------------------------------------------------------------
  // "Find the top 10 cost spikes", "biggest 5 spend drivers", "highest 3 usage"
  {
    pattern: /\b(top|highest|biggest|largest)\s+\d+\s+\S*\s*(cost|spend|spike|charge|usage|expense)/i,
    toolName: 'compose_visual',
  },
  // "cost breakdown", "cost analysis", "cost driver", "spend analysis", "spend savings",
  // "bill spike", "spend optimization" — requires compound form, not bare "cost"
  {
    pattern: /\b(cost|spend|bill)\b.*?\b(spike|analysis|breakdown|driver|optimization|savings)\b/i,
    toolName: 'compose_visual',
  },
  // MoM (month-over-month) keyword combined with cost/spend context
  // Matches: "40% MoM", "MoM growth", "MoM cost"
  {
    pattern: /\bmom\b/i,
    toolName: 'compose_visual',
  },
  // "month over month cost", "quarter over quarter spend", "year over year usage"
  {
    pattern: /\b(month|quarter|year)\s+over\s+\1\b/i,
    toolName: 'compose_visual',
  },

  // -------------------------------------------------------------------------
  // Mock-10: migration plan / phased timeline
  // -------------------------------------------------------------------------
  // "migrate ... plan", "migration timeline", "porting ... cutover plan"
  // Order-independent: "downtime for our migration" OR "migration ... downtime"
  {
    pattern:
      /\b(plan|phased|timeline|estimate|downtime|cutover|roadmap)\b.*?\b(migration|migrate|porting)\b|\b(migration|migrate|porting)\b.*?\b(plan|phased|timeline|estimate|downtime|cutover|roadmap)\b/i,
    toolName: 'compose_app',
  },
  // "dependency graph", "deps map", "dependency tree", "dependency chain"
  {
    pattern: /\b(dependency|dependencies|deps)\b.*?\b(graph|map|tree|chain)\b/i,
    toolName: 'compose_visual',
  },

  // -------------------------------------------------------------------------
  // Mock-12: user onboarding / permission matrix / access provisioning
  // -------------------------------------------------------------------------
  // "onboard user + access/permission/role/least-priv"
  {
    pattern: /\b(onboard|provision|grant)\b.*?\b(user|dev|developer|role|access|permission|least.priv)\b/i,
    toolName: 'compose_app',
  },
  // "permission matrix", "role grid", "IAM map", "permission review", "IAM audit"
  {
    pattern: /\b(permission|role|iam)\b.*?\b(matrix|grid|map|review|audit)\b/i,
    toolName: 'compose_app',
  },
  // "risk score", "blast radius matrix", "impact assessment"
  {
    pattern: /\b(risk|impact|blast.radius)\b.*?\b(score|matrix|assessment)\b/i,
    toolName: 'compose_app',
  },

  // -------------------------------------------------------------------------
  // Mock-08: incident triage / postmortem / RCA
  // -------------------------------------------------------------------------
  // Order-independent: "postmortem for last night outage" OR "incident ... triage"
  {
    pattern:
      /\b(triage|timeline|postmortem|rca|root.cause)\b.*?\b(incident|outage|sev[- ]?1|p0|p1)\b|\b(incident|outage|sev[- ]?1|p0|p1)\b.*?\b(triage|timeline|postmortem|rca|root.cause)\b/i,
    toolName: 'compose_app',
  },

  // -------------------------------------------------------------------------
  // Mock-09: compliance / audit / security findings
  // -------------------------------------------------------------------------
  {
    pattern: /\b(compliance|audit|hipaa|soc2|pci|gdpr)\b.*?\b(report|dashboard|findings|gap|remediation)\b/i,
    toolName: 'compose_app',
  },
];

// ---------------------------------------------------------------------------
// Phase A.4ext.2 — Structural complexity trigger keywords
//
// When mcpToolResultsThisTurn >= 3 AND the user message contains ANY of
// these keywords (whole-word, case-insensitive), force compose_visual.
//
// These are numeric/volume oriented terms — the assumption is that ≥3 MCP
// fetches returning data with such keywords warrants a visual, not a wall
// of markdown tables.
// ---------------------------------------------------------------------------
const STRUCTURAL_TRIGGER_KEYWORDS_RE =
  /\b(cost|spend|spent|usage|bill|traffic|flow|latency|volume|breakdown)\b/i;

const STRUCTURAL_TRIGGER_MCP_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Main detector
// ---------------------------------------------------------------------------

/**
 * Detect whether the user message contains an artifact verb or scenario
 * pattern that warrants forcing a compose_visual / compose_app tool call
 * on the next model turn.
 */
export function detectArtifactVerb(
  input: ArtifactVerbDetectorInput,
): ArtifactVerbResult {
  const { userMessage, mcpToolResultsThisTurn } = input;

  // ---- Phase 1: explicit-verb triggers — require at least 1 MCP result.
  //
  // Verbs like "render", "chart", "diagram", "dashboard" are imperatives
  // to visualize data the user knows is already available. They need at
  // least one MCP result in-scope so the compose tool has something to
  // render. Without that guard the model would get forced to compose_visual
  // on "render a sankey" but have no data → empty/fabricated chart.
  if (mcpToolResultsThisTurn >= 1) {
    // Check compose_visual verbs first (preferred / lower-cost).
    for (const match of VISUAL_MATCHERS) {
      if (match(userMessage)) {
        return { shouldForce: true, toolName: 'compose_visual' };
      }
    }

    // Check compose_app verbs.
    for (const match of APP_MATCHERS) {
      if (match(userMessage)) {
        return { shouldForce: true, toolName: 'compose_app' };
      }
    }
  }

  // ---- Phase 2: scenario-pattern triggers — fire pre-MCP (0 results OK).
  //
  // Scenario patterns match the INTENT SHAPE of the prompt (migration plan,
  // onboarding flow, incident triage, etc.) rather than a user-typed
  // visualization verb. For these, the compose tool itself fetches the data
  // it needs — no prior MCP round-trip is required. Forcing on turn 1 lets
  // compose_app / compose_visual take ownership of the entire flow from the
  // first model call, avoiding a wasted MCP-only turn before the compose
  // dispatch fires.
  //
  // compose_visual patterns checked first (same tie-break preference as verbs).
  const visualScenario = SCENARIO_PATTERNS.find(
    (sp) => sp.toolName === 'compose_visual' && sp.pattern.test(userMessage),
  );
  if (visualScenario) {
    return { shouldForce: true, toolName: 'compose_visual' };
  }

  const appScenario = SCENARIO_PATTERNS.find(
    (sp) => sp.toolName === 'compose_app' && sp.pattern.test(userMessage),
  );
  if (appScenario) {
    return { shouldForce: true, toolName: 'compose_app' };
  }

  // ---- Phase 3: structural complexity trigger (≥3 MCP + cost/volume kw) ----
  if (
    mcpToolResultsThisTurn >= STRUCTURAL_TRIGGER_MCP_THRESHOLD &&
    STRUCTURAL_TRIGGER_KEYWORDS_RE.test(userMessage)
  ) {
    return { shouldForce: true, toolName: 'compose_visual' };
  }

  return { shouldForce: false };
}

// ---------------------------------------------------------------------------
// #965 — multi-artifact sequence detection (Mocks 07 / 10 / 12).
//
// Some mocks expect MULTIPLE artifacts emitted in a specific order across
// successive tool_choice rounds:
//
//   Mock-07 (tri-cloud-cost-spikes):
//     cost spike + savings → compose_visual:sankey then compose_app:savings_grid
//
//   Mock-10 (mssql-migration-plan):
//     migration plan + dependency → compose_app:migration_plan then
//     compose_visual:dependency_graph
//
//   Mock-12 (iam-onboarding):
//     permission matrix + risk score →
//     compose_app:permission_matrix then compose_app:risk_score_card
//
// `detectArtifactSequence` returns the ordered list of (toolName, template)
// pairs the chatLoop should force-dispatch on successive turns. Callers
// queue the sequence and consume it one-per-turn — after the first
// dispatch the second forced round runs with the SECOND entry. Empty
// sequence = no multi-artifact pattern matched; the caller falls back to
// the single-tool `detectArtifactVerb` result.
//
// All patterns are case-insensitive and order-independent (the two anchors
// can appear in either order in the user's prompt).
// ---------------------------------------------------------------------------

export interface ArtifactSequenceStep {
  toolName: 'compose_visual' | 'compose_app';
  template?: string;
}

export interface ArtifactSequenceResult {
  sequence: ArtifactSequenceStep[];
}

interface SequencePattern {
  /** Both anchor regexps must match (order-independent). */
  anchors: [RegExp, RegExp];
  steps: ArtifactSequenceStep[];
}

const SEQUENCE_PATTERNS: SequencePattern[] = [
  // -------------------------------------------------------------------------
  // Mock-07 — cost spike + savings/cuts → [sankey, savings_grid]
  // -------------------------------------------------------------------------
  {
    anchors: [
      // cost / spend spike or breakdown / cost spikes
      /\b(cost|spend|bill)\b.*?\b(spike|spikes|breakdown|analysis|driver)\b|\b(spike|spikes|breakdown)\b.*?\b(cost|spend|bill)\b/i,
      // savings / what to cut / cuts
      /\b(savings|cut|cuts|optimization|reduce|trim)\b/i,
    ],
    steps: [
      { toolName: 'compose_visual', template: 'sankey' },
      { toolName: 'compose_app', template: 'savings_grid' },
    ],
  },

  // -------------------------------------------------------------------------
  // Mock-10 — migration plan + dependency → [migration_plan, dependency_graph]
  // -------------------------------------------------------------------------
  {
    anchors: [
      // migration + plan/timeline/phased/cutover/roadmap (any order)
      /\b(migration|migrate|porting)\b.*?\b(plan|phased|timeline|cutover|roadmap)\b|\b(plan|phased|timeline|cutover|roadmap)\b.*?\b(migration|migrate|porting)\b/i,
      // dependency / dependencies / deps
      /\b(dependency|dependencies|deps)\b/i,
    ],
    steps: [
      { toolName: 'compose_app', template: 'migration_plan' },
      { toolName: 'compose_visual', template: 'dependency_graph' },
    ],
  },

  // -------------------------------------------------------------------------
  // Mock-12 — permission matrix + risk score → [permission_matrix, risk_score_card]
  // -------------------------------------------------------------------------
  {
    anchors: [
      // permission matrix / role grid / IAM matrix
      /\b(permission|role|iam)\b.*?\b(matrix|grid|map)\b/i,
      // risk score / blast radius / impact assessment
      /\b(risk|impact|blast.radius)\b.*?\b(score|matrix|assessment|radius)\b|\bblast.radius\b/i,
    ],
    steps: [
      { toolName: 'compose_app', template: 'permission_matrix' },
      { toolName: 'compose_app', template: 'risk_score_card' },
    ],
  },
];

/**
 * Detect a multi-artifact sequence in the user's message.
 *
 * Pure / no I/O. Returns `{ sequence: [...] }` when both anchor regexps
 * for one of the SEQUENCE_PATTERNS hit the message; returns `{ sequence: [] }`
 * otherwise. The chatLoop is responsible for queuing the steps and applying
 * `tool_choice` one at a time across successive turns.
 *
 * mcpToolResultsThisTurn is accepted in the input shape for symmetry with
 * detectArtifactVerb, but sequence patterns fire pre-MCP (turn 1) — the
 * downstream compose tools fetch their own data once dispatched.
 */
export function detectArtifactSequence(
  input: ArtifactVerbDetectorInput,
): ArtifactSequenceResult {
  const { userMessage } = input;
  if (!userMessage || typeof userMessage !== 'string') {
    return { sequence: [] };
  }
  for (const sp of SEQUENCE_PATTERNS) {
    const [a, b] = sp.anchors;
    if (a.test(userMessage) && b.test(userMessage)) {
      return { sequence: sp.steps.slice() };
    }
  }
  return { sequence: [] };
}
