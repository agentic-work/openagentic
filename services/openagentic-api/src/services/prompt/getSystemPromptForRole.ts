/**
 * getSystemPromptForRole — concatenates the role-keyed RBAC base with
 * dynamic plain-function sections: <session-facts>, <memories>.
 *
 * Body source (Sprint W — always-DB):
 *   rbacService injected → always try DB first (rbac_system_prompts table)
 *   DB unavailable / throws → CRITICAL warn + fall through to disk file
 *
 * The USE_DB_PROMPT env-gate was ripped in Sprint W (2026-05-19). The DB is
 * always preferred when rbacService is wired; admins edit prompts at /admin and
 * changes propagate LIVE via redis pubsub without a container rebuild.
 *
 * Spec: docs/superpowers/specs/2026-05-10-chatmode-prompts-db-editable.md
 */
import { loadStaticPromptForRole, type UserRole } from './RoleKeyedSystemPrompt.js';
import { SessionFactsBuilder } from '../SessionFactsBuilder.js';
import type { RbacSystemPromptService } from './RbacSystemPromptService.js';
import { systemPromptSection, resolveSystemPromptSections } from './sections.js';
import {
  getArtifactDispatchMechanismRule,
  getArtifactExplicitRequestGate,
  getUnknownScopeClarificationGate,
  getCostAuditCompositionSection,
  getDiscoveryFlowSection,
  getDoingTasksSection,
  getGroundingDisciplineSection,
  getOutputSection,
  getSafetySection,
  getVisualizationGuardrailsSection,
} from './staticSections.js';
import {
  getToolCatalogSection,
  getEnvContextSection,
  getReadOnlyModeSection,
  getAvailabilitySection,
} from './dynamicSections.js';

export type { UserRole };

/**
 * Marker token that separates the static (cache-global) portion of the
 * composed system prompt from the dynamic (cache-org / per-turn) portion.
 *
 * Downstream cache-control wiring will use this boundary to attach
 * `cache_control: ephemeral` only on the dynamic side; the static side
 * is safe to cache across requests because every section above the
 * boundary is a pure function of (role, enabledTools) — no per-user,
 * per-tenant, or per-turn state.
 *
 * Today the marker is purely informational (no cache wiring yet), but
 * sandwiching it into the assembly now lets us flip cache_control on
 * later without re-plumbing every emit site.
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__';

export interface PromptComposeContext {
  userId: string;
  sessionId: string;
  tenantId?: string;
  modelInUse: string;
  /**
   * The user's first-turn message. Memory recall keys off this so we
   * pull memories relevant to what the user just asked. On subsequent
   * turns within the same chatLoop invocation, the static body +
   * <session-facts> + <memories> are re-composed each turn — see
   * spec §Layer-1 "once per chatLoop invocation."
   */
  userMessage: string;
  priorTurnCount?: number;
  /** Optional knowledge cutoff resolver (pass-through to SessionFactsBuilder). */
  knowledgeCutoff?: string;
}

export interface MemoryHit {
  key: string;
  value: string;
  category?: string;
  confidence?: number;
}

export interface PromptComposeDeps {
  /**
   * Memory recall callback. Returns top-K memories keyed by user message.
   * Failures are swallowed (best-effort) — the prompt still composes
   * with just static body + session-facts. Production code wires this
   * to `getAgentMemoryService().recall(userId, {key, limit: 5})`; tests
   * can pass a stub.
   */
  memoryRecall?: (userId: string, key: string) => Promise<MemoryHit[]>;
  /**
   * DB-backed RBAC system prompt service. When provided, the role-keyed
   * body is ALWAYS read from `rbac_system_prompts` first. Falls through
   * to disk only on DB failure (CRITICAL warn logged).
   *
   * Production wires `ctx.app.rbacSystemPromptService` (set by startup
   * step 09); tests inject a fake.
   */
  rbacService?: Pick<RbacSystemPromptService, 'getActiveTemplate'>;
  /**
   * Optional: the tool array the chatLoop is about to send to the provider.
   * When passed, the dynamic <tool-catalog> section will list these tools
   * by name + first-sentence description (so the model has an in-prompt
   * anchor for what's loaded this turn), AND the static discovery-flow
   * section will gate tool-name-anchored bullets on enabledTools.has(X).
   * Pass undefined for callers that don't know their tool list yet.
   *
   * Shape is intentionally `unknown` so the deps stay loosely coupled —
   * `dynamicSections.ts` handles both OpenAI/AIF shape (`{function: {name}}`)
   * and Anthropic shape (`{name}`) at the consumer.
   */
  tools?: ReadonlyArray<unknown>;
  /**
   * #790 (2026-05-13) — global READ-ONLY platform mode flag.
   *
   * When true, the composer appends a `<read-only-mode>` notice block
   * to the dynamic section pack so the model knows write/mutation
   * tool_calls will be rejected at the platform level. Defaults to
   * false (no block). Production callers pass
   * `getPermissionService(logger).getReadOnlyMode()`; tests pass a
   * static boolean.
   */
  readOnlyMode?: boolean;
  /**
   * #51 (2026-06-01) — per-session MCP availability for the
   * <connected-capabilities> dynamic section. `connected` is the live set
   * of MCP servers that returned tools this turn (e.g. ['openagentic_web',
   * 'aws_knowledge'] on open-dev); `needsAuth` is the known cloud/ops set
   * that is NOT connected (requires credentials / Azure OBO). When both are
   * empty/undefined the section is omitted. Lets the model answer "Azure
   * isn't connected (needs Azure login/OBO)" on turn 1 without searching.
   */
  availability?: {
    connected?: ReadonlyArray<string>;
    needsAuth?: ReadonlyArray<string>;
  };
  // WHY no composer dep here: the module-based PromptComposer appended
  // ~4–5K tokens of dynamic modules on top of the RBAC base, blowing the
  // 5,000-token cap (live evidence: promptTokensEst:8768). This function
  // is the lean assembler — role-keyed .md base + three plain dynamic
  // sections (session-facts / memories / tool-catalog), no module
  // registry, no priority sort, no intent filter.
  //
  // NOTE: the legacy DB composer is NOT deleted — ModuleSeeder
  // (server.ts seedIfEmpty) + PromptComposer + the prompt_modules table
  // still ship and run. The two systems coexist behind a flag split:
  // getSystemPromptForRole is the runChat (V2) path; the composer is the
  // legacy path. The `USE_RBAC_PROMPT` flag (featureFlags.useRbacPrompt)
  // gates the eventual cutover to a single SoT — see RbacSystemPromptService.
}

/**
 * Sprint W.1 (2026-05-19): DB is the SoT. No escape hatch.
 *
 * Always attempt DB when rbacService is present. On DB failure log a
 * CRITICAL warn and fall through to the disk file so chat keeps working.
 * If rbacService is not injected (e.g. unit tests without live Prisma),
 * fall through to disk silently.
 */
async function resolveRbacBody(
  role: UserRole,
  deps: PromptComposeDeps,
): Promise<string> {
  if (deps.rbacService) {
    try {
      return await deps.rbacService.getActiveTemplate(role);
    } catch (err) {
      // DB row missing or service down → fall through to file path so
      // chat keeps working.
      const { loggers } = await import('../../utils/logger.js');
      loggers.services.warn(
        { err, role },
        '[rbac-prompt] CRITICAL — DB read failed, falling through to disk file fallback',
      );
    }
  }
  return loadStaticPromptForRole(role);
}

const MEMORY_BLOCK_BUDGET_BYTES = 2048;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMemoriesBlock(hits: ReadonlyArray<MemoryHit>): string {
  if (hits.length === 0) return '';
  const open = '<memories>';
  const close = '</memories>';
  const lines: string[] = [];
  let bytes = Buffer.byteLength(open, 'utf8') + Buffer.byteLength(close, 'utf8') + 2;
  for (const h of hits) {
    const line = `  - ${escapeHtml(h.key)}: ${escapeHtml(h.value)}`;
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (bytes + lineBytes > MEMORY_BLOCK_BUDGET_BYTES) break;
    lines.push(line);
    bytes += lineBytes;
  }
  if (lines.length === 0) return '';
  return `${open}\n${lines.join('\n')}\n${close}`;
}

export async function getSystemPromptForRole(
  role: UserRole,
  ctx: PromptComposeContext,
  deps: PromptComposeDeps = {},
): Promise<string> {
  // Build the enabledTools set from deps.tools (if provided), accepting
  // both OpenAI/AIF shape (`{function: {name}}`) and Anthropic shape
  // (`{name}`). When tools is undefined or empty the set is empty — the
  // discovery section then emits its baseline body without tool-name
  // anchors.
  const enabledTools = new Set<string>();
  const toolList: ReadonlyArray<unknown> = deps.tools ?? [];
  for (const t of toolList) {
    if (!t || typeof t !== 'object') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tt = t as any;
    const name = tt.function?.name ?? tt.name;
    if (typeof name === 'string') enabledTools.add(name);
  }

  // Session facts: pure compute over ctx — no I/O.
  const factsBuilder = new SessionFactsBuilder();
  const facts = factsBuilder.render(
    factsBuilder.build({
      userId: ctx.userId,
      userRole: role,
      tenantId: ctx.tenantId ?? '',
      sessionId: ctx.sessionId,
      priorTurnCount: ctx.priorTurnCount ?? 0,
      modelInUse: ctx.modelInUse,
    }),
  );

  // Memories: best-effort, swallow failures so prompt still composes
  // without them. Resolved once (lazy in the registry compute fn so the
  // recall doesn't fire when deps.memoryRecall is unset).
  const recall = deps.memoryRecall;
  const memoriesPromise: Promise<string> = recall
    ? recall(ctx.userId, ctx.userMessage)
        .then(renderMemoriesBlock)
        .catch(() => '')
    : Promise.resolve('');

  // Section registry assembly. Order is load-bearing:
  //   1. identity (role-keyed RBAC body — file or DB)
  //   2. discovery_flow + doing_tasks + output + safety  (static fn pack)
  //   3. boundary marker     ← cache split point (static above, dynamic below)
  //   4. tool_catalog        (per-turn enabled tools)
  //   5. session_facts       (per-session state)
  //   6. memories            (per-user state)
  //
  // resolveSystemPromptSections runs all computes in parallel via
  // Promise.allSettled and drops any that return empty / throw.
  const sections = [
    // STATIC — cacheable across requests (cache-global).
    systemPromptSection('identity', () => resolveRbacBody(role, deps)),
    // Sev-0 #880/#807 regression (2026-05-19) — DISPATCH MECHANISM rule.
    // Live-reproduced: model inline-emitted compose_visual JSON in prose
    // code-fences instead of dispatching tool_use. User saw raw JSON; no
    // widget mounted. Placed FIRST so mechanism is read before any "when
    // to emit" rule — without the mechanism, the gate below is moot.
    // Sev-0 #1057 (2026-05-22) — Unknown-scope clarification gate. Placed
    // BEFORE artifact_dispatch_mechanism so the model checks the user's
    // scope words against its mapping BEFORE planning any tool dispatch.
    // Live trigger: "do a full security audit across all tenants of
    // openagentic-omhs" — openagentic-omhs is a repo fork, not a tenant;
    // model used to assume the test user's own dev tenant.
    systemPromptSection('unknown_scope_clarification', () => getUnknownScopeClarificationGate(role)),
    systemPromptSection('artifact_dispatch_mechanism', () => getArtifactDispatchMechanismRule(role)),
    // Sev-0 #928 (2026-05-17 PM) — explicit-request artifact gate. TOP
    // PRIORITY rule: emit compose_app / compose_visual / render_artifact
    // ONLY when user explicitly asked. Token cost is real (5-10K tokens
    // per app). All downstream composition sections defer to this gate.
    systemPromptSection('artifact_explicit_request_gate', () => getArtifactExplicitRequestGate(role)),
    systemPromptSection('discovery_flow', () => getDiscoveryFlowSection(role, enabledTools)),
    systemPromptSection('doing_tasks', () => getDoingTasksSection(role)),
    // Sev-0 META #826 — grounding discipline (NO fabrication). Covers
    // Q2 (#822) Q5 (#824) Q8 (#825) Q9 + meta (#826).
    systemPromptSection('grounding_discipline', () => getGroundingDisciplineSection(role)),
    systemPromptSection('visualization_guardrails', () => getVisualizationGuardrailsSection(role)),
    // 2026-05-17 — multi-cloud finops audit composition contract. Steers
    // the model toward the mock-07 turn-by-turn shape (streaming_table →
    // offer → sankey → offer → savings_grid). Static — self-gated by the
    // model on the user prompt (no router-side conditional needed).
    // #928 amendment: visual layers gated behind user's explicit ask.
    systemPromptSection('cost_audit_composition', () => getCostAuditCompositionSection(role)),
    systemPromptSection('output', () => getOutputSection(role)),
    systemPromptSection('safety', () => getSafetySection(role)),
    // BOUNDARY — splits static (cache-global) from dynamic (cache-org / per-turn).
    // Today this is documentation; once cache_control is wired, sections
    // below this marker get `cache_control: ephemeral`.
    systemPromptSection('__boundary', () => SYSTEM_PROMPT_DYNAMIC_BOUNDARY),
    // DYNAMIC — recomputed per turn.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    systemPromptSection('tool_catalog', () => getToolCatalogSection(toolList as any[])),
    // 2026-05-12 — runtime auth/cloud context (AWS OBO role ARN, Azure
    // tenant, GCP project) interpolated from env at compose time. Mirrors
    // Claude Code's computeEnvInfo() dynamic section. Tells the model
    // credentials are auto-resolved so it never asks the user for ARNs.
    systemPromptSection('env_context', () => getEnvContextSection()),
    // #51 (2026-06-01) — per-session connected-MCP / needs-auth ground
    // truth. Dynamic-side because connected-server state is per-session.
    // Lets the model say "Azure isn't connected (needs OBO)" on turn 1
    // instead of looping tool_search. Empty when no availability passed.
    systemPromptSection('connected_capabilities', () =>
      getAvailabilitySection(
        deps.availability?.connected,
        deps.availability?.needsAuth,
      ),
    ),
    // #790 (2026-05-13) — global READ-ONLY mode notice. Dynamic-side so
    // an admin flip propagates next turn without cache invalidation.
    systemPromptSection('read_only_mode', () =>
      getReadOnlyModeSection(deps.readOnlyMode === true),
    ),
    systemPromptSection('session_facts', () => facts),
    systemPromptSection('memories', () => memoriesPromise),
  ];

  const resolved = await resolveSystemPromptSections(sections);
  return resolved.join('\n\n');
}
