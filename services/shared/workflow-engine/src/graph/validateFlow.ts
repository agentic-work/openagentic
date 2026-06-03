/**
 * validateFlow — the SINGLE contract-aware flow validator (P0-3).
 *
 * This is the SoT `validate()` that the builder UI, the api flow-SAVE handler,
 * the api flow-EXECUTE pre-flight, and the flows authoring agent ALL call.
 * Before this module there were three drifting validators:
 *   - UI: features/workflows/utils/workflowValidator.ts — a HARDCODED
 *     `NODE_REQUIRED_FIELDS` map that fell out of sync with every schema.json
 *     change (slack `text` vs schema `message`, filter_data `filterField` vs
 *     schema `field`, …). That drift IS the bug class this module kills.
 *   - UI: features/workflows/services/computeRequiredRunInputs.ts — trigger
 *     input derivation, ported here so the server computes the same required
 *     inputs the run dialog asks for.
 *   - engine: graph/index.ts validateGraph — the edge + topology gate, which
 *     this module now folds in (and which delegates UP to validateFlow).
 *
 * Everything below DERIVES from the node registry (schema.settings,
 * schema.primary, schema.outputs[0].shape) — there is NO hardcoded node list.
 * The registry is injected via `ctx` so the graph package stays pure (no
 * executor imports): the api / UI wire `ctx.nodeSchemaOf` + `ctx.nodePrimaryOf`
 * from `@openagentic/workflow-engine/nodes/registry`.
 *
 * THE FOUR CHECKS ("will this flow PERFECTLY run?"):
 *   1. NODE CONFIG    — every schema setting with `required:true` must be
 *                       set+non-empty in node.data (or have a non-empty
 *                       schema default). Missing → MISSING_<field> ERROR with
 *                       requiredValue = the EXACT {label,type,example} the
 *                       author must supply.
 *   2. EDGES+TOPOLOGY — delegate to validateGraph (4-invariant edge gate +
 *                       entry/terminal contract). Folded into edge/topology
 *                       issue arrays.
 *   3. {{ref}} RESOLVE — scan every string in every node.data for {{...}}
 *                       using the SAME branches as interpolateTemplate, and
 *                       prove each one resolves against the typed-IO contract:
 *                         {{steps.X.output}} / {{X.output}} → X must be an
 *                           upstream (reachable) producer that resolves (has a
 *                           declared primary OR a heuristic-canonical output).
 *                         {{steps.X.<field>}} → <field> must be in X's
 *                           outputs[0].shape OR be X.primary.
 *                         {{input.Y}} / {{trigger.Y}} → Y must be a declared
 *                           trigger input (else surfaced in requiredInputs).
 *                         {{secret:Z}} → surfaced in requiredSecrets.
 *                         {{env.X}} → warn unless on the engine env allowlist.
 *                       An unresolved producer/field ref is an ERROR — the
 *                       downstream node WILL get empty/garbage (the all-green-
 *                       useless root cause).
 *   4. REQUIRED INPUTS — derive from the trigger node's input_schema /
 *                       inputSchema / inputs[] (computeRequiredRunInputs logic,
 *                       ported server-side).
 */

import {
  validateGraph,
  type GraphValidationError,
} from './index.js';
import type { ConnNode, ConnEdge } from './connectionValidation.js';

// ---------------------------------------------------------------------------
// Minimal schema shapes — we read ONLY the contract fields. Intentionally
// structural (not importing NodeSchema from nodes/types) so this module has
// zero dependency on the executor-heavy registry package; the api/UI pass the
// registry accessors in via `ctx`.
// ---------------------------------------------------------------------------

export interface FlowSettingShape {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  supportsTemplating?: boolean;
  values?: ReadonlyArray<string>;
}

export interface FlowOutputPortShape {
  name: string;
  type?: string;
  /** The declared output-field contract — keys downstream {{steps.X.<key>}} may bind. */
  shape?: Record<string, string>;
}

export interface FlowNodeSchemaShape {
  type: string;
  label?: string;
  category?: string;
  /** schema.primary — the runtime field {{steps.X.output}} resolves to. */
  primary?: string;
  ports?: {
    inputs?: ReadonlyArray<FlowOutputPortShape>;
    outputs?: ReadonlyArray<FlowOutputPortShape>;
  };
  settings?: ReadonlyArray<FlowSettingShape>;
}

// ---------------------------------------------------------------------------
// Flow graph shapes — what callers persist. A superset of ConnNode/ConnEdge
// (we additionally read node.data for config + {{ref}} scanning).
// ---------------------------------------------------------------------------

export interface FlowNode {
  id: string;
  type?: string;
  data?: Record<string, any>;
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  loop?: boolean;
  data?: { loop?: boolean; isLoopBack?: boolean; [k: string]: unknown };
}

export interface FlowGraph {
  nodes: ReadonlyArray<FlowNode>;
  edges: ReadonlyArray<FlowEdge>;
}

// ---------------------------------------------------------------------------
// Validation context — the registry access + run-supply knowledge. Pure: the
// caller wires `nodeSchemaOf` / `nodePrimaryOf` from the registry, and may
// supply what the RUN will provide (configured secrets + trigger inputs) so
// the validator can downgrade a credential/input ref from "error" to "needs".
// ---------------------------------------------------------------------------

export interface ValidateFlowContext {
  /** Resolve a node TYPE → its schema (settings/primary/outputs). */
  nodeSchemaOf: (type: string) => FlowNodeSchemaShape | undefined;
  /** Resolve a node TYPE → its declared schema.primary field (or undefined). */
  nodePrimaryOf: (type: string) => string | undefined;
  /**
   * Secrets the RUN will supply (e.g. resolved from the secrets vault by
   * scope). A {{secret:Z}} ref with Z NOT in this list surfaces as
   * `configured:false` in requiredSecrets — but is NEVER a hard error (the
   * run dialog / missing-secrets wizard asks for it). Absent → all secrets
   * are treated as not-yet-configured (still not an error).
   */
  configuredSecrets?: ReadonlyArray<string>;
  /**
   * Trigger inputs the RUN will supply (the keys the user typed into the run
   * dialog). A {{input.Y}} / {{trigger.Y}} ref with Y NOT here AND NOT declared
   * on the trigger surfaces in requiredInputs (the run gate asks). Absent →
   * fall back to the trigger's declared inputs only.
   */
  triggerInputs?: ReadonlyArray<string>;
  /**
   * Engine env allowlist for {{env.X}} — only these resolve at run time (the
   * P0b pod-env-exfil fix means {{env.X}} is blocked unless the engine seeded
   * `env.X`). An {{env.X}} ref off this list is a WARNING (it resolves empty).
   * Absent → every {{env.X}} ref warns.
   */
  envAllowlist?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Result shape — the structured verdict every caller consumes.
// ---------------------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning';

export interface RequiredValueHint {
  /** Human label for the field the author must supply. */
  label: string;
  /** Setting type (string/number/enum/json/…) so the UI renders the right input. */
  type: string;
  /** A concrete example/placeholder value the author can copy. */
  example?: string;
}

export interface NodeIssue {
  /** Stable machine code, e.g. MISSING_PROMPT / UNRESOLVED_REF / INVALID_URL. */
  code: string;
  severity: IssueSeverity;
  /** The specific setting/field this issue is about (when applicable). */
  field?: string;
  /** Precise, actionable, user-facing message. */
  message: string;
  /** For MISSING_* — the EXACT value the user must add. */
  requiredValue?: RequiredValueHint;
}

export interface NodeIssueGroup {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  issues: NodeIssue[];
}

export interface UnresolvedRef {
  nodeId: string;
  /** The literal {{...}} reference body (without braces), e.g. `steps.x.foo`. */
  ref: string;
  /** Why it can't resolve — names the producer/field/contract that's missing. */
  reason: string;
}

export interface RequiredInput {
  name: string;
  type: string;
  /** A node id that references this input (the first one found). */
  usedByNodeId: string;
  /** Whether the trigger DECLARED this input (vs only referenced downstream). */
  declared?: boolean;
}

export interface RequiredSecret {
  name: string;
  usedByNodeId: string;
  /** True iff ctx.configuredSecrets includes this secret name. */
  configured: boolean;
}

export interface EdgeIssue {
  code: string;
  message: string;
  edgeId?: string;
}

export interface TopologyIssue {
  code: string;
  message: string;
  nodeId?: string;
}

export interface ValidateFlowSummary {
  totalNodes: number;
  validNodes: number;
  invalidNodes: number;
  errorCount: number;
  warningCount: number;
  unresolvedRefCount: number;
  requiredInputCount: number;
  requiredSecretCount: number;
  unconfiguredSecretCount: number;
}

export interface ValidateFlowResult {
  valid: boolean;
  nodeIssues: NodeIssueGroup[];
  unresolvedRefs: UnresolvedRef[];
  requiredInputs: RequiredInput[];
  requiredSecrets: RequiredSecret[];
  edgeIssues: EdgeIssue[];
  topologyIssues: TopologyIssue[];
  summary: ValidateFlowSummary;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a node's `type` whether it sits on the node or under `data`. */
function nodeTypeOf(n: FlowNode): string {
  if (typeof n.type === 'string' && n.type) return n.type;
  const dt = (n.data as { type?: unknown } | undefined)?.type;
  return typeof dt === 'string' && dt ? dt : '';
}

/** Resolve a node's label for messages. */
function nodeLabelOf(n: FlowNode): string {
  const l = n.data?.label;
  return typeof l === 'string' && l.trim() ? l : n.id;
}

/**
 * Is a config value PRESENT (set + non-empty)? Mirrors the engine's notion of
 * "the executor got a usable value": undefined/null/''/whitespace and empty
 * arrays are absent; everything else (incl. `false`, `0`, non-empty arrays,
 * objects) is present.
 */
function isPresent(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true; // number (incl. 0), boolean (incl. false)
}

/**
 * Does a schema setting's DEFAULT satisfy the requirement? A non-empty default
 * means the executor runs with it when the field is absent (e.g. pagerduty
 * `action` default 'trigger', guardrails `checks` default ['pii',…]). An empty
 * array/string/null default does NOT satisfy (e.g. agent `agents` default []).
 */
function defaultSatisfies(setting: FlowSettingShape): boolean {
  return isPresent(setting.default);
}

/** A concrete example value for a setting (placeholder → first enum → typed stub). */
function exampleFor(setting: FlowSettingShape): string | undefined {
  if (typeof setting.placeholder === 'string' && setting.placeholder.trim()) {
    return setting.placeholder;
  }
  if (setting.values && setting.values.length > 0) return setting.values[0];
  switch (setting.type) {
    case 'number':
      return '0';
    case 'boolean':
      return 'true';
    case 'json':
    case 'object':
      return '{}';
    default:
      return undefined;
  }
}

/** Recursively collect every {{...}} reference body found in any string value. */
function collectRefs(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    const re = /\{\{([^}]+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) out.add(m[1].trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectRefs(v, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectRefs(v, out);
    }
  }
}

/**
 * Strip a trailing default-literal (`ref || "x"` / `ref ?? 'y'`) from a ref
 * body, returning just the reference part. Mirrors interpolateTemplate's
 * FALLBACK_RE: a ref followed by `||`/`??` + a quoted literal is a defaulted
 * reference, so the literal makes it ALWAYS resolve (never an error).
 */
const FALLBACK_RE = /^([\s\S]+?)\s*(\|\||\?\?)\s*(["'])([\s\S]*?)\3\s*$/;
function splitDefaultLiteral(refBody: string): { ref: string; hasDefault: boolean } {
  const fb = refBody.match(FALLBACK_RE);
  if (fb) return { ref: (fb[1] || '').trim(), hasDefault: true };
  return { ref: refBody, hasDefault: false };
}

/** Built-in temporal / generated refs interpolateTemplate resolves with no producer. */
const BUILTIN_REFS: ReadonlySet<string> = new Set([
  'now',
  'today',
  'today_minus_1',
  'fifteen_minutes_ago',
  'generated_temp_password',
  // loop/map_reduce iteration-scope variables — bound by the engine per item.
  'item',
  'index',
  'iteration',
]);

/**
 * Does node X's result RESOLVE for `{{steps.X.output}}` / `{{X.output}}`? True
 * when X declares a primary (typed contract) OR when X's type is one the
 * canonicalNodeOutput heuristic would produce a value for. We can't run the
 * executor at validate-time, so "resolves" = X has a schema (known type) — the
 * heuristic always yields SOMETHING for a known node. The only true non-resolve
 * is an unknown producer type.
 */
function producerResolves(
  srcSchema: FlowNodeSchemaShape | undefined,
): boolean {
  return !!srcSchema;
}

/**
 * The set of field names a `{{steps.X.<field>}}` ref may bind: X.primary plus
 * every key declared on X.outputs[0].shape. Returns null when the producer is
 * unknown (can't validate the field — handled as an unresolved producer).
 */
function declaredOutputFields(
  srcSchema: FlowNodeSchemaShape | undefined,
): Set<string> | null {
  if (!srcSchema) return null;
  const fields = new Set<string>();
  if (srcSchema.primary) fields.add(srcSchema.primary);
  const out = srcSchema.ports?.outputs?.[0];
  if (out?.shape) {
    for (const k of Object.keys(out.shape)) fields.add(k);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// REQUIRED INPUTS — ported from computeRequiredRunInputs (UI) to run server-side.
// Walks trigger nodes' input_schema / inputSchema / inputs[] declarations.
// ---------------------------------------------------------------------------

function isTriggerNode(n: FlowNode): boolean {
  return nodeTypeOf(n) === 'trigger';
}

function normalizeInputType(t: unknown): string {
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

/**
 * Derive the inputs DECLARED on the flow's trigger node(s). Returns a map of
 * input-name → type so the {{ref}} pass can tell "declared" from "undeclared".
 */
function deriveDeclaredTriggerInputs(
  nodes: ReadonlyArray<FlowNode>,
): Map<string, string> {
  const declared = new Map<string, string>();
  for (const node of nodes) {
    if (!isTriggerNode(node)) continue;
    const data = node.data ?? {};

    // Form 3 (richest) — explicit inputs[] array.
    if (Array.isArray(data.inputs) && data.inputs.length > 0) {
      for (const i of data.inputs) {
        if (!i?.name || declared.has(i.name)) continue;
        declared.set(i.name, normalizeInputType(i.type));
      }
      continue;
    }

    // Forms 1 & 2 — input_schema / inputSchema.
    const schema = data.input_schema ?? data.inputSchema;
    if (schema && typeof schema === 'object') {
      // Form 2 — JSON-schema with properties.
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [name, propRaw] of Object.entries(schema.properties)) {
          if (declared.has(name)) continue;
          const prop = (propRaw || {}) as any;
          declared.set(name, normalizeInputType(prop.type));
        }
        continue;
      }
      // Form 1 — flat map { field: "type" }.
      for (const [name, typeHint] of Object.entries(schema)) {
        if (declared.has(name)) continue;
        declared.set(name, normalizeInputType(typeHint));
      }
    }
  }
  return declared;
}

// ---------------------------------------------------------------------------
// THE VALIDATOR — validateFlow(graph, ctx)
// ---------------------------------------------------------------------------

export function validateFlow(
  graph: FlowGraph,
  ctx: ValidateFlowContext,
): ValidateFlowResult {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const nodeById = new Map<string, FlowNode>();
  for (const n of nodes) if (n && typeof n.id === 'string') nodeById.set(n.id, n);

  const configuredSecrets = new Set(ctx.configuredSecrets ?? []);
  const envAllowlist = new Set(ctx.envAllowlist ?? []);
  const declaredInputs = deriveDeclaredTriggerInputs(nodes);
  const suppliedInputs = new Set(ctx.triggerInputs ?? []);

  const nodeIssues: NodeIssueGroup[] = [];
  const unresolvedRefs: UnresolvedRef[] = [];
  const requiredInputs: RequiredInput[] = [];
  const requiredSecrets: RequiredSecret[] = [];
  const reqInputSeen = new Set<string>();
  const reqSecretSeen = new Set<string>();

  // ---- Build a per-node label/id → resolved node-id map for {{X.output}} (by
  // label) so the ref pass mirrors interpolateTemplate's label fallback. ----
  const idByNormalizedLabel = new Map<string, string>();
  const normalize = (s: string) => s.toLowerCase().replace(/[-_\s]+/g, '-');
  for (const n of nodes) {
    const label = n.data?.label;
    if (typeof label === 'string' && label.trim()) {
      idByNormalizedLabel.set(normalize(label), n.id);
    }
  }

  // ---- Reachability: which nodes are UPSTREAM of a given target (so a
  // {{steps.X...}} ref proves X actually feeds this node, not a sibling). ----
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') continue;
    const list = incoming.get(e.target);
    if (list) list.push(e.source);
    else incoming.set(e.target, [e.source]);
  }
  /** All node ids upstream of `target` (transitive predecessors). */
  function upstreamOf(target: string): Set<string> {
    const seen = new Set<string>();
    const stack = [...(incoming.get(target) ?? [])];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of incoming.get(cur) ?? []) if (!seen.has(p)) stack.push(p);
    }
    return seen;
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 1 — NODE CONFIG (schema-derived required settings) +
  // CHECK 3 — {{ref}} RESOLUTION (contract-aware) — per node.
  // ════════════════════════════════════════════════════════════════════════
  for (const node of nodes) {
    const nodeType = nodeTypeOf(node);
    // Annotation sticky-notes carry no config + no refs.
    if (nodeType === 'text') continue;

    const schema = ctx.nodeSchemaOf(nodeType);
    const data = node.data ?? {};
    const issues: NodeIssue[] = [];

    // ---- CHECK 1: required settings ----
    if (schema?.settings) {
      for (const setting of schema.settings) {
        if (!setting.required) continue;
        const present = isPresent(data[setting.name]);
        if (present || defaultSatisfies(setting)) continue;
        const label = setting.label || setting.name;
        issues.push({
          code: `MISSING_${setting.name.toUpperCase()}`,
          severity: 'error',
          field: setting.name,
          message: `"${nodeLabelOf(node)}" requires ${label}`,
          requiredValue: {
            label,
            type: setting.type || 'string',
            example: exampleFor(setting),
          },
        });
      }
    }

    // ---- CHECK 3: {{ref}} resolution for every string in node.data ----
    const refs = new Set<string>();
    collectRefs(data, refs);
    const ups = upstreamOf(node.id);
    for (const rawRef of refs) {
      const { ref, hasDefault } = splitDefaultLiteral(rawRef);
      // A defaulted ref (`ref || "x"`) always resolves — but still surface its
      // secret/input dependency below using the inner ref.
      classifyRef(ref, {
        node,
        nodeType,
        hasDefault,
        ups,
      });
    }

    if (issues.length) {
      nodeIssues.push({
        nodeId: node.id,
        nodeLabel: nodeLabelOf(node),
        nodeType,
        issues,
      });
    }

    // Inner closure: classify a single reference body. Pushes into the outer
    // unresolvedRefs / requiredInputs / requiredSecrets / issues arrays.
    function classifyRef(
      refBody: string,
      info: {
        node: FlowNode;
        nodeType: string;
        hasDefault: boolean;
        ups: Set<string>;
      },
    ): void {
      const body = refBody.trim();
      if (!body) return;

      // {{secret:Z}}
      if (body.startsWith('secret:')) {
        const name = body.slice('secret:'.length).trim();
        if (!name) return;
        if (!reqSecretSeen.has(name)) {
          reqSecretSeen.add(name);
          requiredSecrets.push({
            name,
            usedByNodeId: info.node.id,
            configured: configuredSecrets.has(name),
          });
        }
        return;
      }

      // {{env.X}}
      if (body.startsWith('env.')) {
        const name = body.slice('env.'.length).trim();
        if (!envAllowlist.has(name)) {
          issues.push({
            code: 'ENV_NOT_ALLOWLISTED',
            severity: 'warning',
            message:
              `"${nodeLabelOf(info.node)}" references {{env.${name}}}, which is ` +
              `blocked at run time unless the engine seeds it (pod-env exfil is ` +
              `disabled). Use {{secret:${name}}} for credentials.`,
          });
        }
        return;
      }

      // Built-in temporal / iteration refs — always resolve, no producer.
      if (BUILTIN_REFS.has(body)) return;

      // {{input}} / {{input.Y}}
      if (body === 'input' || body.startsWith('input.')) {
        const field = body === 'input' ? 'input' : body.slice('input.'.length).split('.')[0];
        recordRequiredInput(field, info.node.id);
        return;
      }

      // {{trigger.Y}} / {{trigger.body.Y}}
      if (body.startsWith('trigger.')) {
        let rest = body.slice('trigger.'.length);
        // {{trigger.body.X}} — `body` is the canonical envelope wrapper; the
        // user-facing field is the next segment.
        if (rest.startsWith('body.')) rest = rest.slice('body.'.length);
        const field = rest.split('.')[0];
        if (field) recordRequiredInput(field, info.node.id);
        return;
      }

      // {{steps.X.<path>}} or {{X.<path>}} (direct id/label) — producer ref.
      let producerRef: string | undefined;
      let path: string[];
      if (body.startsWith('steps.')) {
        const parts = body.slice('steps.'.length).split('.');
        producerRef = parts[0];
        path = parts.slice(1);
      } else {
        const parts = body.split('.');
        // Only treat as a producer ref if the first segment resolves to a node
        // id/label AND there's a trailing path (e.g. `nodeId.output`). A bare
        // single token that's not a node is a context var — skip (resolves at
        // run time or harmlessly empties).
        const cand = parts[0];
        const resolved =
          nodeById.has(cand) ? cand : idByNormalizedLabel.get(normalize(cand));
        if (!resolved || parts.length < 2) return;
        producerRef = cand;
        path = parts.slice(1);
      }

      // Resolve producerRef → a concrete node id (direct id or label).
      const producerId = nodeById.has(producerRef)
        ? producerRef
        : idByNormalizedLabel.get(normalize(producerRef));

      if (!producerId) {
        unresolvedRefs.push({
          nodeId: info.node.id,
          ref: body,
          reason: `producer "${producerRef}" is not a node in this flow`,
        });
        return;
      }

      // The producer must be UPSTREAM (reachable) of this node — else the data
      // hasn't been produced when this node runs.
      if (producerId !== info.node.id && !info.ups.has(producerId)) {
        unresolvedRefs.push({
          nodeId: info.node.id,
          ref: body,
          reason:
            `producer "${producerId}" is not upstream of this node — its output ` +
            `will be undefined when "${nodeLabelOf(info.node)}" runs`,
        });
        return;
      }

      const srcType = nodeTypeOf(nodeById.get(producerId)!);
      const srcSchema = ctx.nodeSchemaOf(srcType);

      // {{steps.X.output}} / {{X.output}} → the primary/canonical output.
      const head = path[0];
      if (head === undefined || head === 'output') {
        if (!producerResolves(srcSchema)) {
          unresolvedRefs.push({
            nodeId: info.node.id,
            ref: body,
            reason:
              `producer "${producerId}" has unknown type "${srcType}" — its ` +
              `.output cannot be resolved`,
          });
        }
        return;
      }

      // {{steps.X.<field>...}} → <field> must be in X's output contract.
      const fields = declaredOutputFields(srcSchema);
      if (fields === null) {
        unresolvedRefs.push({
          nodeId: info.node.id,
          ref: body,
          reason:
            `producer "${producerId}" has unknown type "${srcType}" — field ` +
            `"${head}" cannot be verified against an output contract`,
        });
        return;
      }
      // A producer that declares NO shape + NO primary has an opaque output —
      // any field access is permitted (we can't prove it wrong). Only enforce
      // when the producer DECLARES an output contract (primary or shape).
      if (fields.size === 0) return;
      if (!fields.has(head)) {
        unresolvedRefs.push({
          nodeId: info.node.id,
          ref: body,
          reason:
            `field "${head}" is not in "${producerId}" (${srcType}) output ` +
            `contract — declared fields: ${[...fields].join(', ') || '(none)'}`,
        });
      }
    }

    function recordRequiredInput(name: string, usedBy: string): void {
      if (!name || reqInputSeen.has(name)) return;
      reqInputSeen.add(name);
      const declType = declaredInputs.get(name);
      requiredInputs.push({
        name,
        type: declType ?? 'string',
        usedByNodeId: usedBy,
        declared: declaredInputs.has(name) || suppliedInputs.has(name),
      });
    }
  }

  // Also surface trigger-DECLARED inputs that no node references yet (the run
  // dialog still needs to ask for them). Additive — dedup via reqInputSeen.
  for (const [name, type] of declaredInputs) {
    if (reqInputSeen.has(name)) continue;
    reqInputSeen.add(name);
    const triggerNode = nodes.find(isTriggerNode);
    requiredInputs.push({
      name,
      type,
      usedByNodeId: triggerNode?.id ?? '',
      declared: true,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CHECK 2 — EDGES + TOPOLOGY (delegate to the existing graph gate).
  // ════════════════════════════════════════════════════════════════════════
  const connNodes: ConnNode[] = nodes.map((n) => ({
    id: n.id,
    type: nodeTypeOf(n) || undefined,
    data: n.data,
  }));
  const connEdges: ConnEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    loop: e.loop,
    data: e.data,
  }));
  const graphResult = validateGraph(connNodes, connEdges);
  const edgeIssues: EdgeIssue[] = [];
  const topologyIssues: TopologyIssue[] = [];
  for (const ge of graphResult.errors as GraphValidationError[]) {
    if (ge.kind === 'edge') {
      edgeIssues.push({ code: ge.code, message: ge.message, edgeId: ge.edgeId });
    } else {
      topologyIssues.push({ code: ge.code, message: ge.message, nodeId: ge.nodeId });
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY + verdict.
  // ════════════════════════════════════════════════════════════════════════
  let errorCount = 0;
  let warningCount = 0;
  const invalidNodeIds = new Set<string>();
  for (const grp of nodeIssues) {
    for (const i of grp.issues) {
      if (i.severity === 'error') {
        errorCount++;
        invalidNodeIds.add(grp.nodeId);
      } else {
        warningCount++;
      }
    }
  }
  // Unresolved refs are ERRORS (the downstream node gets empty/garbage).
  errorCount += unresolvedRefs.length;
  for (const r of unresolvedRefs) invalidNodeIds.add(r.nodeId);
  // Edge + topology errors count toward the verdict too.
  errorCount += edgeIssues.length + topologyIssues.length;

  const unconfiguredSecretCount = requiredSecrets.filter((s) => !s.configured).length;

  const realNodeCount = nodes.filter((n) => nodeTypeOf(n) !== 'text').length;

  const valid = errorCount === 0;

  return {
    valid,
    nodeIssues,
    unresolvedRefs,
    requiredInputs,
    requiredSecrets,
    edgeIssues,
    topologyIssues,
    summary: {
      totalNodes: realNodeCount,
      validNodes: realNodeCount - invalidNodeIds.size,
      invalidNodes: invalidNodeIds.size,
      errorCount,
      warningCount,
      unresolvedRefCount: unresolvedRefs.length,
      requiredInputCount: requiredInputs.length,
      requiredSecretCount: requiredSecrets.length,
      unconfiguredSecretCount,
    },
  };
}
