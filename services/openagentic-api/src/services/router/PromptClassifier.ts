/**
 * Prompt-pattern task classifier — STRUCTURAL scoring (Q1-fix-12, 2026-05-13).
 *
 * RIPPED 2026-05-13 (this revision):
 *   - looksLikeArchitectureDesign  (noun list: consolidat / migrat / refactor / monorepo / datacenter / re-architect / roadmap / microservice / platform)
 *   - looksLikeCrossSystemFanOut   (noun list: cluster / account / subscription / project / region / tenant)
 *   - looksLikeCostAnalysis        (noun list: cost / spend / billing / invoice + spike / breakdown)
 *   - looksLikeSecurityAudit       (noun list: public / exposed / drift / compliance / cve / over-privileged)
 *   - looksLikeFileRead            (kept structurally — path-shape detection)
 *   - looksLikeSingleSystemRead    (kept structurally — read-verb + cloudCount=1)
 *
 * REPLACEMENT: classifyTaskType now computes a complexity score over
 * STRUCTURAL signals — none of which enumerate domain nouns:
 *
 *   1. Length tier             — prompts longer than ~200 chars score higher
 *   2. Numbered-list count     — count of `(1)..(N)` and `^1. ^2. ...` items
 *   3. Parallel-intent phrases — `parallel-call`, `fan-out`, `enumerate`,
 *                                `across all`, `each <admin-boundary>`,
 *                                `every <admin-boundary>`. Admin-boundary
 *                                is account/subscription/project/cluster/
 *                                region/tenant — STRUCTURAL admin-scope
 *                                terms (NOT tech-stack names).
 *   4. Synthesis verbs         — audit / analyze / diagnose / investigate /
 *                                review / inventory / rollup / consolidat /
 *                                migrat / refactor / design / plan / deliver /
 *                                produce / build / implement / orchestrate /
 *                                optimize / right-size / remediate. These
 *                                are STRUCTURAL "work-verbs" — describing the
 *                                shape of the task, not the noun being acted
 *                                upon.
 *   5. Compose-frame asks      — compose_app / compose_visual / kpi /
 *                                runbook / remediation / topology / sankey /
 *                                heatmap / diagram / architecture. These are
 *                                FRAME terminology — independent of the
 *                                user's tech stack. A k8s prompt asking for
 *                                a "sankey" trips this; a postgres prompt
 *                                asking for a "sankey" trips this. Identical
 *                                routing regardless of domain.
 *   6. Cloud-presence count    — countDistinctClouds is a structural signal
 *                                (number of distinct admin boundaries). The
 *                                AWS/AZURE/GCP service-synonym tables stay
 *                                here ONLY as inputs to countDistinctClouds.
 *                                They are NOT used as routing triggers.
 *
 * Score → TaskType mapping:
 *   ≥ 7   architecture-design-agentic   (FCA 0.90 — frontier reasoning)
 *   ≥ 5   multi-cloud-agentic / multi-system-agentic
 *   ≥ 3   cost-analysis-agentic / security-audit-agentic / multi-system-agentic
 *   else  single-system-read / file-read / pure-chat
 *
 * What survives a Q-loop probe: a 600-char prompt asking for 5 numbered
 * compose_app frames over kubernetes/terraform/postgres/redis/any-tech
 * routes to architecture-design-agentic. A 30-char "hi" routes to pure-chat.
 *
 * What this classifier IS:
 *   - Structural-shape detection — length + numbered-list + frame-asks.
 *   - A pre-pass that maps task type → CAPABILITY profile (FCA floor,
 *     context-length floor, reasoning preference).
 *
 * What this classifier IS NOT:
 *   - It does NOT reproduce any of the banned regex detectors guarded by
 *     `__tests__/architecture/no-regex-intent-routing.source-regression.test.ts`.
 *   - It does NOT pick a model by name. It picks a CAPABILITY profile.
 *   - It does NOT filter tools.
 */

/**
 * Stable enum of task types. Adding a new type is a contract change —
 * every consumer (capability profile lookup, metrics labels, audit log)
 * must be updated.
 */
export type TaskType =
  | 'multi-cloud-agentic'
  | 'multi-system-agentic'
  | 'cost-analysis-agentic'
  | 'cost-audit'
  | 'security-audit-agentic'
  | 'architecture-design-agentic'
  | 'single-system-read'
  | 'file-read'
  | 'pure-chat';

export interface CapabilityProfile {
  taskType: TaskType;
  /** Soft preference for reasoning-grade models in scoring. */
  requiresReasoning: 'none' | 'medium' | 'high';
  /** Human-readable rationale, surfaced in router decision logs. */
  rationale: string;
  // `requiresToolUseReliability` (FCA floor) and `requiresContextTokens`
  // (context-window floor) were ripped 2026-05-22 (#1049). Both moved
  // to the admin-editable RouterTuning DB row
  // (`capabilityProfileFloors` + `capabilityContextFloors`). SmartModelRouter
  // reads them from there at routing time, keyed by `taskType`.
}

/**
 * Cloud-service synonym buckets — STRUCTURAL INPUT ONLY (Q1-fix-10).
 *
 * These regex tables back `countDistinctClouds` so that a prompt mentioning
 * "bedrock" maps to AWS without saying the literal word "aws". Cloud
 * PRESENCE COUNT is a structural signal (how many admin-boundary scopes
 * are involved in this turn). The synonym tables themselves are NOT used
 * for routing — they are inputs to a structural counter.
 *
 * Critically: routing does NOT branch on "is this AWS / Azure / GCP". It
 * branches on "how many distinct cloud scopes are present". A prompt
 * mentioning S3 alone counts as cloudCount=1; "aks + bedrock" counts as 2.
 */
const AWS_SERVICE_SYNONYMS: readonly RegExp[] = [
  /\bbedrock\b/,
  /\bec2\b/,
  /\bs3\b/,
  /\blambda\b/,
  /\beks\b/,
  /\becs\b/,
  /\bfargate\b/,
  /\brds\b/,
  /\bdynamo(?:db)?\b/,
  /\bcloudwatch\b/,
  /\bcloudtrail\b/,
  /\bcost\s*explorer\b/,
  /\bsagemaker\b/,
  /\bkinesis\b/,
  /\bsqs\b/,
  /\bsns\b/,
  /\broute\s*53\b/,
  /\bvpc\b/,
  /\bredshift\b/,
  /\bathena\b/,
  /\bglue\b/,
];

const AZURE_SERVICE_SYNONYMS: readonly RegExp[] = [
  /\baks\b/,
  /\bfoundry\b/,
  /\bcosmos(?:db)?\b/,
  /\bcosmos\s*db\b/,
  /\bvnet\b/,
  /\bvmss\b/,
  /\bapp\s*service\b/,
  /\bcost\s*management\b/,
  /\blog\s*analytics\b/,
  /\bkey\s*vault\b/,
  /\bservice\s*bus\b/,
  /\bevent\s*hub\b/,
  /\bblob\s*storage\b/,
  /\bsql\s*mi\b/,
  /\bpostgres\s*flexible\b/,
];

const GCP_SERVICE_SYNONYMS: readonly RegExp[] = [
  /\bgke\b/,
  /\bvertex\b/,
  /\bbig\s*query\b/,
  /\bbq\b/,
  /\bcloud\s*run\b/,
  /\bcloud\s*functions\b/,
  /\bcloud\s*sql\b/,
  /\bspanner\b/,
  /\bpub\s*sub\b/,
  /\bdataflow\b/,
  /\bdataproc\b/,
];

function anyMatches(lower: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    if (re.test(lower)) return true;
  }
  return false;
}

/**
 * Cloud-provider presence-count detection. STRUCTURAL signal — counts how
 * many distinct cloud admin-boundaries the prompt touches. Caller uses the
 * count, not the identities.
 */
function countDistinctClouds(lower: string): number {
  let count = 0;
  const hasAzure = /\bazure\b/.test(lower) || anyMatches(lower, AZURE_SERVICE_SYNONYMS);
  const hasAws =
    /\baws\b/.test(lower) ||
    lower.includes('amazon web services') ||
    anyMatches(lower, AWS_SERVICE_SYNONYMS);
  const hasGcp =
    /\bgcp\b/.test(lower) ||
    lower.includes('google cloud') ||
    anyMatches(lower, GCP_SERVICE_SYNONYMS);
  if (hasAzure) count++;
  if (hasAws) count++;
  if (hasGcp) count++;
  return count;
}

/**
 * Structural path-shape detection — replaces looksLikeFileRead. Detects a
 * literal file path with a source-file extension. NOT a noun list — a
 * STRUCTURAL token shape (slash + extension).
 */
function hasFilePathShape(lower: string): boolean {
  return /\b[\w-]+\/[\w./-]+\.(ts|tsx|js|jsx|py|yaml|yml|json|md|toml|sh|go|rs)\b/.test(lower);
}

/**
 * Conversation-context heuristics (Q1-fix-10). Unchanged from prior revision
 * — short follow-up turns inherit the prior agentic floor.
 */
function looksLikeFreshTopic(lower: string): boolean {
  const trimmed = lower.trim();
  if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|got it|cheers)[\s.!?]*$/.test(trimmed)) {
    return true;
  }
  if (/\b(switch to|change topic|new question|help me with my|now help me|different (topic|question))\b/.test(trimmed)) {
    return true;
  }
  return false;
}

function looksLikeContinuation(lower: string): boolean {
  const trimmed = lower.trim();
  if (/^(why|how|when|where|who|what)[?\s]/.test(trimmed) || /^(why|how)\??$/.test(trimmed)) {
    return true;
  }
  if (
    /\b(break (it|that|them) down|breakdown|drill (in|into|down)|expand on|tell me more|elaborate|what about (that|those|these|it)|same.*but)\b/.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/\b(per day|by day|per hour|by hour|per service|by service|by resource|for the (last|past))\b/.test(trimmed)) {
    return true;
  }
  if (/^(show me )?(it|that|those|these|them)\b/.test(trimmed)) {
    return true;
  }
  return false;
}

export interface ClassifyContext {
  priorClassification?: TaskType;
}

/**
 * Internal scoring helper. Returns the raw structural signals; callers
 * map score + cloudCount → TaskType.
 */
interface StructuralSignals {
  length: number;
  numberedItemCount: number;
  parallelIntent: boolean;
  synthesisVerb: boolean;
  composeFrameAsks: number;
  cloudCount: number;
  /** Q1-fix-13 (#874): ≥2 DISTINCT plural admin-boundary nouns co-occur. */
  parentChildPluralPair: boolean;
  score: number;
}

function scoreStructural(lower: string): StructuralSignals {
  let score = 0;

  // 1. Length tier — short → 0; medium → +1; long → +2; very-long → +3.
  const length = lower.length;
  let lengthTier = 0;
  if (length >= 600) lengthTier = 3;
  else if (length >= 300) lengthTier = 2;
  else if (length >= 150) lengthTier = 1;
  score += lengthTier;

  // 2. Numbered-list count. Match `(N)`, `^N.`, AND "N-phase" / "N-year"
  //    structural enumeration + plural "phases" / "milestones" /
  //    "quarters" enumeration phrases (structural multi-step shape).
  //    Cap at +3.
  const parenItems = lower.match(/\((\d+)\)/g) ?? [];
  const lineNumberItems = lower.match(/(?:^|\n)\s*\d+\.\s/g) ?? [];
  const enumeratedPhases = lower.match(/\b\d+[-\s]?(phase|year|step|milestone|cohort|wave|sprint|quarter|month|dimension|anti-?pattern|package|workload)/g) ?? [];
  const pluralEnumeration = lower.match(/\b(the\s+)?(phases|milestones|quarters|cohorts|waves|steps|sprints|stages|dimensions)\b/g) ?? [];
  const numberedItemCount = parenItems.length + lineNumberItems.length + enumeratedPhases.length + pluralEnumeration.length;
  score += Math.min(3, numberedItemCount);

  // 3. Parallel-intent. STRUCTURAL admin-scope quantifiers ("all my X",
  //    "across each X", "for every X") paired with admin-boundary nouns.
  //    Admin-boundary set is STRUCTURAL — every cloud / platform has
  //    accounts/projects/clusters/etc. as scope concepts.
  //
  //    Q1-fix-13 (2026-05-15, #874): three structural expansions to catch
  //    cross-tenant inventory shapes that previously fell to single-system-read:
  //      (a) ADMIN-BOUNDARY noun set now includes "resource group(s)" + "rg(s)" —
  //          structurally identical to subscription/account/project.
  //      (b) PARALLEL-INTENT regex allows up to 3 intervening tokens between
  //          "each/every/across" and the admin-boundary noun — so "each AWS
  //          account" / "every GCP project" / "across all my Azure
  //          subscriptions" trip the signal (previously only "each account"
  //          / "every project" with NO intervening adjective worked).
  //      (c) ELLIPTICAL FAN-OUT — "in/across/for + each/every + one/of them"
  //          (no noun, pronoun reference back to an earlier admin-boundary)
  //          is a structural fan-out signal when ANY plural admin-boundary
  //          noun appears in the prompt.
  const ADMIN_BOUNDARY_PLURAL =
    /\b(clusters?|accounts?|subscriptions?|projects?|regions?|tenants?|namespaces?|stacks?|workspaces?|environments?|services?|packages?|repos?|repositories|resource\s+groups?|rgs?|buckets?|databases?|deployments?|pipelines?|workloads?)\b/g;
  const adminBoundaryMatches = lower.match(ADMIN_BOUNDARY_PLURAL) ?? [];
  // Distinct admin-boundary noun count — pair-of-distinct nouns is a
  // structural "parent-child enumeration" tell-tale (e.g. "subscriptions"
  // + "resource groups", "accounts" + "buckets").
  const distinctAdminBoundaryNouns = new Set(adminBoundaryMatches.map((m) => m.replace(/\s+/g, ' '))).size;
  const hasAnyAdminBoundaryNoun = adminBoundaryMatches.length > 0;

  const ellipticalFanOut =
    hasAnyAdminBoundaryNoun &&
    /\b(in|across|for|of|by|per)\s+(each|every)\s+(one|of\s+(them|those|these))\b/.test(lower);

  const ADMIN_BOUNDARY_INLINE =
    '(?:clusters?|accounts?|subscriptions?|projects?|regions?|tenants?|namespaces?|stacks?|workspaces?|environments?|services?|packages?|repos?|repositories|resource\\s+groups?|rgs?|buckets?|databases?|deployments?|pipelines?|workloads?)';
  const parallelIntent =
    /\bparallel-?call|\bfan-?out|\bsimultaneous(?:ly)?|\bin parallel\b|\benumerate\b|\backross all\b/.test(
      lower,
    ) ||
    // (b) "each / every / across / for each" + up to 3 tokens + admin-boundary noun
    new RegExp(
      `\\b(?:each|every|across|for\\s+each)(?:\\s+\\w+){0,3}\\s+${ADMIN_BOUNDARY_INLINE}\\b`,
    ).test(lower) ||
    // (b') "all (my/the)? <admin-boundary>" — including "all accounts",
    //      "all my subscriptions", "all the AWS accounts"
    new RegExp(
      `\\ball\\s+(?:my\\s+|the\\s+)?(?:\\w+\\s+){0,2}${ADMIN_BOUNDARY_INLINE}\\b`,
    ).test(lower) ||
    // (c) elliptical fan-out — pronoun referring back to an earlier
    //     admin-boundary noun
    ellipticalFanOut;
  if (parallelIntent) score += 2;

  // 3b. Parent-child plural admin-boundary pair — when 2+ DISTINCT plural
  //     admin-boundary nouns co-occur (e.g. "subscriptions" + "resource
  //     groups", "accounts" + "buckets"), the prompt is structurally a
  //     parent-child enumeration. +1 (additive to parallelIntent, not
  //     redundant — parallelIntent fires on QUANTIFIER+NOUN, this fires
  //     on NOUN+NOUN co-occurrence).
  const parentChildPluralPair = distinctAdminBoundaryNouns >= 2;
  if (parentChildPluralPair) score += 1;

  // 4. Synthesis-shape verbs. These describe the SHAPE of work the user
  //    wants done — audit, plan, design, migrate, etc. — not the noun
  //    being acted upon. STRUCTURAL "work-verb" set.
  const synthesisVerb =
    /\b(audit|analyze|analyse|diagnose|investigate|review|inventory|rollup|roll up|consolidat|migrat|refactor|re-?architect|design|plan|deliver|produce|implement|orchestrate|optimize|right-?size|remediate|survey|roadmap)\b/.test(
      lower,
    );
  if (synthesisVerb) score += 1;

  // 5. Compose-frame asks. FRAME terminology — independent of tech stack.
  //    Includes:
  //      - Tool names    (compose_app / compose_visual / synth)
  //      - Visual frames (sankey / heatmap / topology / diagram / chart / graph)
  //      - Output frames (kpi / runbook / remediation / executive summary /
  //                       risk register / risk matrix / rollback plan /
  //                       dependency graph / roi / capex / opex /
  //                       savings_grid / business case)
  //    These are ALL frame-of-output terms — they describe HOW the response
  //    should be shaped, not what tech is being discussed. The same word
  //    list applies whether the user is talking about k8s, terraform,
  //    postgres, or anything else.
  const composeFrameMatches =
    lower.match(
      /\bcompose_app\b|\bcompose_visual\b|\bkpi(?:\s+grid)?\b|\brunbook\b|\bremediation\b|\btopology\b|\bsankey\b|\bheatmap\b|\bdiagram\b|\barchitect(?:ure)?\b|\bsavings_grid\b|\bexecutive\s+summary\b|\brisk\s+(register|matrix)\b|\bsynth\s+call\b|\brollback\s+plan\b|\bdependency\s+graph\b|\b(roi|capex|opex)\b|\bbusiness\s+case\b|\bbar\s+chart\b|\bstacked\s+bar\b|\bphased\s+timeline\b|\broadmap\b/g,
    ) ?? [];
  const composeFrameAsks = composeFrameMatches.length;
  if (composeFrameAsks >= 2) score += 2;
  else if (composeFrameAsks >= 1) score += 1;

  // 6. Cloud-presence count — structural admin-boundary count.
  const cloudCount = countDistinctClouds(lower);
  if (cloudCount >= 2) score += 2;
  else if (cloudCount === 1) score += 1;

  // 7. Numbered-deliverable bonus — when the prompt explicitly enumerates
  //    ≥3 numbered items AND demands compose-frame outputs, that's the
  //    "give me a structured multi-frame response" signal. Bonus +2.
  if (numberedItemCount >= 3 && composeFrameAsks >= 2) score += 2;

  // 8. Plan/design intent + multi-output ask. When the user explicitly
  //    asks to "plan" + provide multiple structured frames, that's the
  //    architecture-design shape. STRUCTURAL pair: synthesis-verb +
  //    compose-frames ≥ 2 → +1 (escalates score 4 → 5, 5 → 6).
  if (synthesisVerb && composeFrameAsks >= 2) score += 1;

  return {
    length,
    numberedItemCount,
    parallelIntent,
    synthesisVerb,
    composeFrameAsks,
    cloudCount,
    parentChildPluralPair,
    score,
  };
}

/**
 * Minimal heuristics for the cost-analysis / security-audit domain
 * flavors. These are kept tiny on purpose — the bulk of agentic-vs-not
 * routing decisions ride the structural score. These two markers only
 * pick a domain FLAVOR for the same agentic FCA-0.90 capability profile,
 * surfacing useful labels for downstream metrics + log readers.
 */
const COST_DOMAIN_RE = /\b(cost|spend|billing|invoice)\b/;
const AUDIT_DOMAIN_RE = /\b(audit|scan|review)\b/;

/**
 * Single-system structural-read detection. cloudCount === 1 AND a plain
 * read-verb opening. STRUCTURAL — no domain enumeration.
 */
function isSingleSystemRead(lower: string, signals: StructuralSignals): boolean {
  if (signals.cloudCount !== 1) return false;
  if (signals.score >= 5) return false; // long structured prompts escalate
  const trimmed = lower.trim();
  return (
    /^(list|show me|show|what (are|is) my|what \w+|how many|which|do i have)\b/.test(trimmed) ||
    /\bdo i have\b/.test(trimmed)
  );
}

/**
 * Cost/audit domain markers anchored on analysis SHAPE (top-N, breakdown,
 * spike, by-X). Tiny structural shape — not a noun explosion. The cost
 * NOUN is checked first as a domain marker (cost/spend/billing/invoice),
 * then anchored on an analysis-SHAPE token before promoting.
 *
 * "What is the cost of an m5.large?" → cost noun present but no analysis
 * shape → does NOT promote.
 * "Break down cost by service" → cost noun + breakdown shape → promotes.
 */
function isCostAnalysisShape(lower: string): boolean {
  if (!COST_DOMAIN_RE.test(lower)) return false;
  return /\bspike|\bincrease|\bbreakdown|\btop \d|\bby (service|resource|account|subscription|project)/.test(
    lower,
  );
}

/**
 * Cost-audit SHAPE — refinement of cost-analysis for MULTI-CLOUD spend
 * audits (2026-05-17). Forces T3 (FCA >= 0.93) on the prompt scope that
 * empirically needs frontier-grade tool-use + reasoning: tri-cloud spend
 * reconciliation, finops audits, billing breakdowns across 2+ admin
 * boundaries.
 *
 * Why split from cost-analysis-agentic:
 *   - Multi-cloud cost audits dispatch a sub-agent + 3+ parallel cost
 *     tools + compose multi-artifact narratives (sankey + savings_grid).
 *     T2 (FCA 0.90) models empirically degrade on this load — they emit
 *     compose_visual on prose-only turns, fabricate dollar amounts, or
 *     coalesce the parallel batch.
 *   - Single-cloud cost analysis (still cost-analysis-agentic at FCA
 *     0.90) keeps the lower floor; only the multi-cloud finops scope
 *     escalates to T3.
 *
 * Trigger requires BOTH:
 *   (a) cost noun (cost/spend/billing/invoice/finops) AND
 *   (b) cloudCount >= 2 OR explicit cross-cloud phrase ("cross-cloud",
 *       "tri-cloud", "multi-cloud")
 *
 * Optional anchor on analysis-SHAPE (top-N / breakdown / spike / by-X /
 * audit / reconcile / increase / MoM) to gate out info questions ("what
 * is Azure costing me?") even when cloudCount >= 2.
 */
const FINOPS_DOMAIN_RE = /\b(cost|spend|billing|invoice|finops)\b/;
const COST_ANALYSIS_SHAPE_RE = /\bspike|\bincrease|\bbreakdown|\btop \d|\bby (service|resource|account|subscription|project)|\baudit|\breconcile|\bmom|\bcut\b|\bsavings?\b/;
const CROSS_CLOUD_PHRASE_RE = /\b(tri-?cloud|cross-?cloud|multi-?cloud)\b/;

function isCostAuditShape(lower: string, signals: StructuralSignals): boolean {
  if (!FINOPS_DOMAIN_RE.test(lower)) return false;
  const isMultiCloud = signals.cloudCount >= 2 || CROSS_CLOUD_PHRASE_RE.test(lower);
  if (!isMultiCloud) return false;
  // Anchor on analysis-SHAPE so an info question with 2 cloud names doesn't
  // promote (e.g. "what is cost in Azure vs AWS for an m5.large?" — info,
  // not audit). The shape regex covers the bulk of audit verbs.
  return COST_ANALYSIS_SHAPE_RE.test(lower);
}

/**
 * Audit-shape — verb + finding-shape token. Structural finding-shape is
 * "exposed / public / open / drift / compliance / over-privileged / cve /
 * vulnerab" — a small bounded set of finding TERMS, not a domain noun
 * list. Required because security findings are intrinsically lexical
 * (auditors describe what they found in domain-specific finding terms).
 * Kept minimal — single regex — so the structural score remains the
 * dominant signal for the agentic/not-agentic boundary.
 */
function isSecurityAuditShape(lower: string): boolean {
  if (!AUDIT_DOMAIN_RE.test(lower)) return false;
  return /\b(public|exposed|open|drift|compliance|finding|misconfig|vulnerab|cve|over.?privileged)\b/.test(
    lower,
  );
}

/**
 * Classify a user prompt into a task type via structural scoring + a few
 * structural shape gates for short single-sentence agentic prompts that
 * would otherwise not accumulate score.
 *
 * Decision order:
 *   1. File-path shape                       → file-read
 *   2. Structural score ≥ 7                  → architecture-design-agentic
 *   3. cloudCount ≥ 2                        → multi-cloud-agentic
 *   4. Cost-analysis SHAPE                   → cost-analysis-agentic
 *   5. Security-audit SHAPE                  → security-audit-agentic
 *   6. Parallel-intent across admin boundary → multi-system-agentic
 *   7. Structural score ≥ 5                  → multi-system-agentic
 *   8. Single-system structural read         → single-system-read
 *   9. Conversation continuation of agentic  → single-system-read
 *  10. Else                                   → pure-chat
 *
 * Short single-sentence prompts ("compare Azure VM count with AWS EC2"
 * — 2 clouds, structural shape) don't accumulate enough score on length
 * + numbered alone, so cloudCount ≥ 2 + parallel-intent + analysis-shape
 * are early structural gates. NOTE: these gates are STRUCTURAL — they
 * check SHAPE (count of clouds, count of admin-boundary terms, presence
 * of analysis-shape tokens), not domain nouns.
 */
export function classifyTaskType(userPrompt: string, ctx?: ClassifyContext): TaskType {
  if (!userPrompt || typeof userPrompt !== 'string') return 'pure-chat';
  const lower = userPrompt.toLowerCase();

  // 1. File-read first — a literal source-path shape is unambiguous.
  if (hasFilePathShape(lower)) return 'file-read';

  const signals = scoreStructural(lower);

  // 2. High-score architecture-design — long, numbered, multi-frame asks.
  //    This is the highest tier and trumps cloud-count: a 600-char k8s
  //    audit with 5 numbered frame asks routes here regardless of
  //    cloudCount (k8s prompts may have cloudCount=0).
  if (signals.score >= 7) return 'architecture-design-agentic';

  // 2b. Architecture-design shape: synthesis-verb + 3+ compose-frame asks.
  //     STRUCTURAL phrase pattern — "I want a plan/audit/design plus
  //     multiple structured outputs (chart + runbook + executive summary
  //     + risk register, etc.)". This catches the medium-length
  //     ("re-architect our platform … plan the phases … executive
  //     summary … risk register") shape that lands at score 5 but is
  //     unambiguously architecture-design.
  if (signals.synthesisVerb && signals.composeFrameAsks >= 3) {
    return 'architecture-design-agentic';
  }

  // 2c. Cost-audit (2026-05-17) — multi-cloud finops audit shape. Must
  //     gate BEFORE the generic multi-cloud-agentic + cost-analysis-agentic
  //     gates so tri-cloud spend prompts escalate to T3 (FCA 0.93) instead
  //     of the T2 floor (0.90) those broader categories apply.
  if (isCostAuditShape(lower, signals)) return 'cost-audit';

  // 3. Multi-cloud structural gate — cloudCount ≥ 2 is unambiguous
  //    admin-boundary fan-out, regardless of score.
  if (signals.cloudCount >= 2) return 'multi-cloud-agentic';

  // 4. Cost-analysis SHAPE — cost noun + breakdown/spike/top-N/by-X.
  if (isCostAnalysisShape(lower)) return 'cost-analysis-agentic';

  // 5. Security-audit SHAPE — audit/scan/review verb + finding-shape term.
  if (isSecurityAuditShape(lower)) return 'security-audit-agentic';

  // 6. Parallel-intent across admin boundaries — "across each cluster",
  //    "all my subscriptions", "for every account". Structural shape.
  if (signals.parallelIntent) return 'multi-system-agentic';

  // 7. Mid-score → multi-system-agentic. Long, structured prompts that
  //    don't hit any specific flavor land here.
  if (signals.score >= 5) return 'multi-system-agentic';

  // 8. Single-system structural read — cloudCount=1 + plain read-verb.
  if (isSingleSystemRead(lower, signals)) return 'single-system-read';

  // 9. Conversation-context inheritance.
  const priorIsAgentic =
    ctx?.priorClassification === 'multi-cloud-agentic' ||
    ctx?.priorClassification === 'multi-system-agentic' ||
    ctx?.priorClassification === 'cost-analysis-agentic' ||
    ctx?.priorClassification === 'security-audit-agentic' ||
    ctx?.priorClassification === 'architecture-design-agentic';
  if (priorIsAgentic && !looksLikeFreshTopic(lower) && looksLikeContinuation(lower)) {
    return 'single-system-read';
  }

  return 'pure-chat';
}

/**
 * Capability-profile table per task type. Adjust here — these are NOT
 * model IDs, they are capability requirements the router uses to filter
 * DB-discovered models.
 */
const CAPABILITY_PROFILES: Record<TaskType, CapabilityProfile> = {
  'multi-cloud-agentic': {
    taskType: 'multi-cloud-agentic',
    requiresReasoning: 'high',
    rationale:
      'Multi-cloud agentic — needs frontier-grade tool-use + sub-agent fan-out plan. FCA / context floors live on RouterTuning.capabilityProfileFloors[multi-cloud-agentic] (default 0.90) and capabilityContextFloors[multi-cloud-agentic] (default 30000); both are admin-editable.',
  },
  'multi-system-agentic': {
    taskType: 'multi-system-agentic',
    requiresReasoning: 'high',
    rationale:
      'Cross-system fan-out — needs frontier-grade tool-use + reasoning. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors.',
  },
  'cost-analysis-agentic': {
    taskType: 'cost-analysis-agentic',
    requiresReasoning: 'high',
    rationale:
      'Cost-analysis agentic — multi-step query + synthesis over large bill JSON. Frontier-grade tool-use required. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors (defaults 0.90 / 100000).',
  },
  'cost-audit': {
    taskType: 'cost-audit',
    requiresReasoning: 'high',
    rationale:
      'Cost-audit (multi-cloud finops) — sub-agent dispatch + parallel cost tools + multi-turn composition. Default T3 floors (FCA ≥ 0.93, context ≥ 100000) live on RouterTuning.capabilityProfileFloors / capabilityContextFloors.',
  },
  'security-audit-agentic': {
    taskType: 'security-audit-agentic',
    requiresReasoning: 'high',
    rationale:
      'Security-audit agentic — scan + finding synthesis. Frontier-grade tool-use required. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors.',
  },
  'architecture-design-agentic': {
    taskType: 'architecture-design-agentic',
    requiresReasoning: 'high',
    rationale:
      'Architecture-design agentic — multi-phase plan + charts + synth + executive summary. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors (defaults 0.90 / 30000).',
  },
  'single-system-read': {
    taskType: 'single-system-read',
    requiresReasoning: 'none',
    rationale:
      'Single-cloud read — cheap local models acceptable. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors (defaults 0.85 / 8000).',
  },
  'file-read': {
    taskType: 'file-read',
    requiresReasoning: 'none',
    rationale:
      'File-read — cheap local models acceptable. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors (defaults 0.85 / 16000).',
  },
  'pure-chat': {
    taskType: 'pure-chat',
    requiresReasoning: 'none',
    rationale:
      'Pure chat — chat-pool floor only. Cheapest model wins on cost. Floors on RouterTuning.capabilityProfileFloors / capabilityContextFloors (defaults 0.82 / 4000).',
  },
};

export function getCapabilityProfile(taskType: TaskType): CapabilityProfile {
  return CAPABILITY_PROFILES[taskType];
}

export function classifyAndProfile(
  userPrompt: string,
  ctx?: ClassifyContext,
): {
  taskType: TaskType;
  profile: CapabilityProfile;
} {
  const taskType = classifyTaskType(userPrompt, ctx);
  const profile = getCapabilityProfile(taskType);
  return { taskType, profile };
}
