/**
 * computeRequiredRunInputs
 *
 * Walks a workflow's trigger node(s) and derives the list of user inputs the
 * flow needs BEFORE it can run, plus any pre-filled default values. Powers the
 * pre-run RunInputsModal — the inputs sibling of the MissingSecretsWizard.
 *
 * The #1 rule: "if a node needs information from a user it HAS TO ASK THEM FOR
 * IT." Templates declare what they need from the user on the `trigger` node;
 * downstream nodes bind those values via `{{trigger.<field>}}`. If we run with
 * an empty input the downstream node fails (e.g. knowledge_search/rag_query
 * "requires a non-empty query"). So we compute the required fields here and pop
 * the dialog when any required field is still empty.
 *
 * THREE declaration forms are supported (templates in the wild use all three):
 *
 *  1. FLAT MAP — `trigger.data.input_schema` (snake_case, what the seed
 *     templates use) or `trigger.data.inputSchema` (camelCase). Shape:
 *     `{ question: "string", collection: "string" }`. Each key is a required
 *     user input; the value is a primitive type hint.
 *
 *  2. JSON-SCHEMA — `trigger.data.inputSchema` with `{ properties, required }`.
 *     Required-ness comes from the `required[]` array; labels/descriptions/
 *     defaults from each property.
 *
 *  3. EXPLICIT FIELD LIST — `trigger.data.inputs` as an array of
 *     `{ name, label, type, required, placeholder, description, default }`.
 *     This is the richest form and wins when present.
 *
 * Default values are sourced (highest precedence first) from:
 *   - the trigger node's `data.inputValues` map (per-field stored values)
 *   - the trigger node's `data.defaultInputs` map (template defaults copied
 *     onto the node at instantiation, if present)
 *   - the per-field `default` on an explicit `inputs[]` entry / json-schema prop
 *
 * Returns the field defs (RunInputDef[], ready for RunInputsModal) and the
 * resolved default-values map. The caller decides whether any *required* field
 * is still empty and pops the dialog.
 */

import type { RunInputDef } from '../components/RunInputsModal';

export interface RequiredRunInputs {
  /** Field definitions, in declaration order, deduped by name. */
  inputs: RunInputDef[];
  /** Pre-filled values keyed by field name (from stored/default sources). */
  defaults: Record<string, any>;
  /**
   * When set, the flow consumes the run input as a bare `{{input}}` value (the
   * WHOLE run payload) rather than named `{{trigger.<field>}}` fields. The
   * caller must thread the collected value for this field RAW — i.e. pass
   * `collected[primaryInput]` as the executeWorkflow input, NOT `{ input: ... }`
   * — so the engine resolves `{{input}}` to the value the user typed instead of
   * a JSON object. Only set for the bare-`{{input}}` backstop case.
   */
  primaryInput?: string;
}

/** snake_case / kebab / camelCase → "Title Case" for a human-readable label. */
function humanizeFieldName(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

interface NodeLike {
  id: string;
  type?: string;
  data?: any;
}

function normalizeType(t: unknown): RunInputDef['type'] {
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'string';
}

function isTriggerNode(n: NodeLike): boolean {
  if (!n) return false;
  return n.type === 'trigger' || n?.data?.type === 'trigger';
}

/**
 * Compute the required user inputs for a flow from its trigger node(s).
 * Pure — no IO, safe to call on every Run click.
 */
export function computeRequiredRunInputs(nodes: NodeLike[]): RequiredRunInputs {
  const inputs: RunInputDef[] = [];
  const seen = new Set<string>();
  const defaults: Record<string, any> = {};

  const push = (def: RunInputDef) => {
    if (!def?.name || seen.has(def.name)) return;
    seen.add(def.name);
    inputs.push(def);
  };

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!isTriggerNode(node)) continue;
    const data = node?.data ?? {};

    // Sources of pre-filled values for this trigger's fields.
    const stored: Record<string, any> =
      (data.inputValues && typeof data.inputValues === 'object' ? data.inputValues : null) ||
      (data.defaultInputs && typeof data.defaultInputs === 'object' ? data.defaultInputs : null) ||
      {};

    // Form 3 (richest) — explicit inputs[] array wins.
    if (Array.isArray(data.inputs) && data.inputs.length > 0) {
      for (const i of data.inputs) {
        if (!i?.name) continue;
        push({
          name: i.name,
          label: i.label || i.name,
          type: normalizeType(i.type),
          required: i.required === undefined ? true : !!i.required,
          placeholder: i.placeholder,
          description: i.description,
          default: i.default,
        });
        if (stored[i.name] !== undefined) defaults[i.name] = stored[i.name];
        else if (i.default !== undefined) defaults[i.name] = i.default;
      }
      continue;
    }

    // Forms 1 & 2 both live under input_schema / inputSchema.
    const schema = data.input_schema ?? data.inputSchema;
    if (schema && typeof schema === 'object') {
      // Form 2 — JSON-schema with properties + required[].
      if (schema.properties && typeof schema.properties === 'object') {
        const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];
        for (const [name, propRaw] of Object.entries(schema.properties)) {
          const prop = (propRaw || {}) as any;
          push({
            name,
            label: prop.title || name,
            type: normalizeType(prop.type),
            required: requiredList.includes(name),
            placeholder: prop.placeholder,
            description: prop.description,
            default: prop.default,
          });
          if (stored[name] !== undefined) defaults[name] = stored[name];
          else if (prop.default !== undefined) defaults[name] = prop.default;
        }
        continue;
      }

      // Form 1 — flat map { field: "type" }. Every declared field is a
      // required user input (downstream nodes bind {{trigger.<field>}}).
      for (const [name, typeHint] of Object.entries(schema)) {
        push({
          name,
          label: name,
          type: normalizeType(typeHint),
          required: true,
        });
        if (stored[name] !== undefined) defaults[name] = stored[name];
      }
    }
  }

  // ---- BACKSTOP: airtight "ask before you run" for UNDECLARED inputs. ----
  // A template's trigger may declare nothing (or miss a field) yet its nodes
  // still reference the run input via `{{input}}` (the whole payload),
  // `{{input.<field>}}`, or `{{trigger.<field>}}`. The declaration-only pass
  // above computes zero inputs for those flows, so they run BLIND and fail on
  // the first node that needs the value (the live RAG Knowledge Pipeline:
  // bare `{{input}}` → empty → "rag_query requires a non-empty query"). Here we
  // scan every node for those references and synthesize a required input for any
  // that isn't already declared, so the run gate ALWAYS asks. `push` dedupes
  // against the declared fields, so this is purely additive.
  const declaredCount = seen.size;
  const blob = JSON.stringify(Array.isArray(nodes) ? nodes : []);

  // Named field references: {{input.<field>}} and {{trigger.<field>}} (first segment).
  const namedRefs = new Set<string>();
  const refRe = /\{\{\s*(?:input|trigger)\.([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(blob)) !== null) namedRefs.add(m[1]);
  for (const field of namedRefs) {
    push({ name: field, label: humanizeFieldName(field), type: 'string', required: true });
  }

  // Bare `{{input}}` (the entire run payload). Only treat it as the single raw
  // primary input when there are NO named/declared fields — otherwise the named
  // fields drive an object payload and a bare {{input}} would clash.
  let primaryInput: string | undefined;
  const bareInput = /\{\{\s*input\s*\}\}/.test(blob);
  if (bareInput && namedRefs.size === 0 && declaredCount === 0 && !seen.has('input')) {
    const triggerLabel = (Array.isArray(nodes) ? nodes : [])
      .find((n) => n && isTriggerNode(n))?.data?.label;
    push({
      name: 'input',
      label: typeof triggerLabel === 'string' && triggerLabel.trim() ? triggerLabel : 'Input',
      type: 'string',
      required: true,
      description: 'The value passed to the flow as {{input}}.',
    });
    if (seen.has('input')) primaryInput = 'input';
  }

  return { inputs, defaults, primaryInput };
}

/**
 * Convenience predicate: does the flow have at least one required input that is
 * still empty (after applying defaults)? Mirrors the missing-secrets gate's
 * "is there anything to ask about" check.
 */
export function hasUnprovidedRequiredInputs(req: RequiredRunInputs): boolean {
  const isEmpty = (v: any) =>
    v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  return req.inputs.some((i) => i.required && isEmpty(req.defaults[i.name]));
}
