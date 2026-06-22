/**
 * LangFlow → OpenAgentic-flows importer.
 *
 * Takes a raw LangFlow export (the JSON produced by LangFlow's "Export flow"
 * button — `{ data: { nodes, edges } }`) and transpiles it into an OpenAgentic
 * flow template:
 *
 *   { nodes: [{ id, type, position, data }], edges: [{ id, source, target }] }
 *
 * Design rules (match the in-repo template contract):
 *
 *  1. NEVER DROP A NODE. Every LangFlow node becomes exactly one OpenAgentic
 *     node. Known component types map to the nearest OpenAgentic node type;
 *     anything unrecognised becomes a `text` passthrough node that carries the
 *     original component config under `data._langflow` plus a human-readable
 *     `data._importNote` so the author can hand-finish it. Topology is never
 *     lost.
 *
 *  2. PRESERVE TOPOLOGY. Every LangFlow edge becomes an OpenAgentic edge with a
 *     stable `{ id, source, target }`. LangFlow encodes edges either as
 *     `{ source, target }` directly or nested under `{ data: { sourceHandle,
 *     targetHandle } }` / `{ source, target }` — both forms are handled, and the
 *     source/target node ids are remapped through the node-id map so renamed
 *     ids stay connected.
 *
 *  3. ASK THE USER FOR INPUTS. LangFlow "TextInput" / "ChatInput" components and
 *     any template `{variable}` referenced by a PromptTemplate become entries in
 *     `trigger.data.input_schema` (the flat `{ field: "string" }` form the
 *     run-inputs modal reads — see
 *     services/openagentic-ui/.../computeRequiredRunInputs.ts Form 1). A single
 *     `trigger` node is always prepended so the flow has a real entry point and
 *     the pre-run modal pops for the declared fields.
 *
 * Pure module — no engine / Prisma / network imports. Safe to call from api,
 * UI, or a CLI.
 */

// ---------------------------------------------------------------------------
// LangFlow export shapes (loose — exports vary across LangFlow versions, so we
// accept anything object-like and read defensively).
// ---------------------------------------------------------------------------

export interface LangflowExport {
  data?: {
    nodes?: unknown;
    edges?: unknown;
  };
  // Some exports wrap the graph one level deeper or omit `data`; we also accept
  // a bare `{ nodes, edges }` at the top level.
  nodes?: unknown;
  edges?: unknown;
  [k: string]: unknown;
}

interface LangflowNode {
  id?: string;
  type?: string;
  position?: { x?: number; y?: number };
  data?: {
    type?: string;
    node?: {
      template?: Record<string, unknown>;
      display_name?: string;
      base_classes?: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

interface LangflowEdge {
  id?: string;
  source?: string;
  target?: string;
  data?: {
    sourceHandle?: unknown;
    targetHandle?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// OpenAgentic flow-template shapes (mirror the in-repo template JSON).
// ---------------------------------------------------------------------------

export interface AwNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

export interface AwEdge {
  id: string;
  source: string;
  target: string;
}

export interface AwFlowTemplate {
  nodes: AwNode[];
  edges: AwEdge[];
}

// ---------------------------------------------------------------------------
// Component-type → OpenAgentic-node-type mapping.
//
// LangFlow component "type" is found at `node.data.type` (canonical) and
// sometimes `node.type`. Keys here are lower-cased for case-insensitive lookup;
// the table is intentionally broad (covers the common LangChain-derived
// component names across LangFlow versions).
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, string> = {
  // Prompt building
  prompttemplate: 'prompt_template',
  prompt: 'prompt_template',
  chatprompttemplate: 'prompt_template',

  // LLM / chains → llm_completion
  llmchain: 'llm_completion',
  chatopenai: 'llm_completion',
  openai: 'llm_completion',
  llm: 'llm_completion',
  azurechatopenai: 'llm_completion',
  azureopenai: 'llm_completion',
  chatanthropic: 'llm_completion',
  anthropic: 'llm_completion',
  chatollama: 'llm_completion',
  ollama: 'llm_completion',
  chatvertexai: 'llm_completion',
  chatbedrock: 'llm_completion',
  bedrock: 'llm_completion',
  conversationchain: 'llm_completion',

  // Retrieval / RAG
  vectorstoreretriever: 'rag_query',
  retriever: 'rag_query',
  vectorstoreinforetriever: 'rag_query',
  retrievalqa: 'rag_query',
  conversationalretrievalchain: 'rag_query',

  // Vector stores (data sink/source)
  vectorstore: 'vector_store',
  chroma: 'vector_store',
  pinecone: 'vector_store',
  faiss: 'vector_store',
  qdrant: 'vector_store',
  milvus: 'vector_store',
  weaviate: 'vector_store',

  // Embeddings
  openaiembeddings: 'embedding',
  embeddings: 'embedding',
  huggingfaceembeddings: 'embedding',

  // Document handling
  textsplitter: 'text_splitter',
  recursivecharactertextsplitter: 'text_splitter',
  charactertextsplitter: 'text_splitter',
  documentloader: 'document_loader',
  textloader: 'document_loader',
  pdfloader: 'document_loader',
  webbaseloader: 'document_loader',

  // Routing / control
  conditionalrouter: 'condition',
  router: 'condition',

  // Tools
  toolnode: 'mcp_tool',
  tool: 'mcp_tool',
  pythonfunctiontool: 'mcp_tool',

  // Inputs (consumed by the trigger — see deriveInputs)
  textinput: 'text',
  chatinput: 'text',

  // Outputs
  output: 'text',
  textoutput: 'text',
  chatoutput: 'text',

  // JSON / structured
  jsonoutputparser: 'parse_json',
  structuredoutputparser: 'structured_output',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asArray(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function normType(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Resolve the LangFlow component type from a node (data.type wins). */
function langflowTypeOf(node: LangflowNode): string {
  return String(node?.data?.type ?? node?.type ?? '');
}

/**
 * Pull a flat config map out of a LangFlow node's `data.node.template`.
 * LangFlow templates are `{ fieldName: { value, type, display_name, ... } }`;
 * we collapse them to `{ fieldName: value }`, skipping internal `_type` keys.
 */
function extractTemplateConfig(node: LangflowNode): Record<string, unknown> {
  const tpl = node?.data?.node?.template;
  const out: Record<string, unknown> = {};
  if (tpl && typeof tpl === 'object') {
    for (const [key, fieldRaw] of Object.entries(tpl)) {
      if (key === '_type') continue;
      const field = fieldRaw as Record<string, unknown> | null;
      if (field && typeof field === 'object' && 'value' in field) {
        out[key] = (field as { value?: unknown }).value;
      } else {
        out[key] = fieldRaw;
      }
    }
  }
  return out;
}

/** Collect `{variable}` placeholders out of a LangFlow prompt template string. */
function collectTemplateVars(config: Record<string, unknown>): string[] {
  const vars = new Set<string>();
  const re = /\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  for (const v of Object.values(config)) {
    if (typeof v !== 'string') continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(v)) !== null) vars.add(m[1]);
  }
  return [...vars];
}

/** Sanitize an arbitrary string into a safe template field key. */
function fieldKey(raw: string): string {
  const s = String(raw ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_$]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'input';
}

// ---------------------------------------------------------------------------
// Per-type config translation. Maps the collapsed LangFlow template config to
// the OpenAgentic node's expected `data` keys, and ALWAYS retains the original
// under `_langflow` so nothing is lost. For non-LLM-providing nodes we leave
// `model` untouched (the llm_completion node defaults model to 'auto' — we
// never hardcode a model literal here, per the no-hardcoded-models rule).
// ---------------------------------------------------------------------------

function translateData(
  awType: string,
  lfType: string,
  config: Record<string, unknown>,
  displayName: string | undefined,
): Record<string, any> {
  const base: Record<string, any> = {
    label: displayName || lfType || awType,
    _langflow: { type: lfType, config },
  };

  switch (awType) {
    case 'prompt_template': {
      const template =
        (config.template as string) ??
        (config.prompt as string) ??
        (config.system_message as string) ??
        '';
      return { ...base, template: String(template ?? ''), outputAs: 'prompt' };
    }

    case 'llm_completion': {
      // model intentionally left as the node default ('auto') — we do NOT copy
      // the LangFlow model literal into a first-class field (no-hardcoded-models
      // rule). The original model name is preserved under _langflow.config.
      const out: Record<string, any> = { ...base, model: 'auto' };
      if (config.system_message != null)
        out.systemPrompt = String(config.system_message);
      if (config.temperature != null && !Number.isNaN(Number(config.temperature)))
        out.temperature = Number(config.temperature);
      if (config.max_tokens != null && !Number.isNaN(Number(config.max_tokens)))
        out.maxTokens = Number(config.max_tokens);
      return out;
    }

    case 'rag_query': {
      const collection =
        (config.collection_name as string) ??
        (config.index_name as string) ??
        (config.collection as string) ??
        'imported-langflow';
      const out: Record<string, any> = {
        ...base,
        collection: String(collection),
        query: '{{input}}',
      };
      const k = config.k ?? config.top_k ?? config.search_kwargs_k;
      if (k != null && !Number.isNaN(Number(k))) out.topK = Number(k);
      return out;
    }

    case 'condition': {
      const condition =
        (config.condition as string) ??
        (config.match_text as string) ??
        (config.expression as string) ??
        '';
      return { ...base, condition: String(condition ?? '') };
    }

    case 'mcp_tool': {
      return {
        ...base,
        toolName: String(config.name ?? config.tool_name ?? displayName ?? lfType),
        arguments: {},
      };
    }

    case 'vector_store': {
      const collection =
        (config.collection_name as string) ??
        (config.index_name as string) ??
        'imported-langflow';
      return { ...base, collection: String(collection) };
    }

    case 'text': {
      // Output / passthrough nodes: carry any literal text value.
      const text =
        (config.input_value as string) ??
        (config.value as string) ??
        (config.text as string) ??
        '';
      return { ...base, text: String(text ?? '') };
    }

    default:
      // Mapped type with no special translation — pass the collapsed config
      // through under both the typed data and _langflow so the executor sees
      // whatever fields it understands and nothing is dropped.
      return { ...base, ...config };
  }
}

// ---------------------------------------------------------------------------
// Input-schema derivation. Builds the flat `{ field: "string" }` map that
// trigger.data.input_schema needs (Form 1 in computeRequiredRunInputs).
// Sources:
//   - every TextInput / ChatInput component (its name → a field)
//   - every `{variable}` referenced inside a PromptTemplate body
// ---------------------------------------------------------------------------

function deriveInputs(nodes: LangflowNode[]): Record<string, string> {
  const schema: Record<string, string> = {};

  for (const node of nodes) {
    const lfType = normType(langflowTypeOf(node));
    const config = extractTemplateConfig(node);

    if (lfType === 'textinput' || lfType === 'chatinput') {
      const name = fieldKey(
        (config.input_value_name as string) ||
          (node?.data?.node?.display_name as string) ||
          (node?.id as string) ||
          'input',
      );
      schema[name] = 'string';
    }

    if (
      lfType === 'prompttemplate' ||
      lfType === 'prompt' ||
      lfType === 'chatprompttemplate'
    ) {
      for (const v of collectTemplateVars(config)) {
        schema[fieldKey(v)] = 'string';
      }
    }
  }

  return schema;
}

// ---------------------------------------------------------------------------
// importLangflow — the public entry point.
// ---------------------------------------------------------------------------

export function importLangflow(exportJson: LangflowExport): AwFlowTemplate {
  if (!exportJson || typeof exportJson !== 'object') {
    throw new Error('importLangflow: export must be a JSON object');
  }

  // Accept `{ data: { nodes, edges } }` (canonical) OR a bare `{ nodes, edges }`.
  const graph = (exportJson.data && typeof exportJson.data === 'object'
    ? exportJson.data
    : exportJson) as { nodes?: unknown; edges?: unknown };

  const lfNodes = asArray(graph.nodes) as LangflowNode[];
  const lfEdges = asArray(graph.edges) as LangflowEdge[];

  // ---- 1. Build the input schema + the single trigger entry point. ----
  const inputSchema = deriveInputs(lfNodes);

  const TRIGGER_ID = 'trigger';
  const triggerNode: AwNode = {
    id: TRIGGER_ID,
    type: 'trigger',
    position: { x: 0, y: 0 },
    data: {
      label: 'Imported LangFlow Input',
      triggerType: 'manual',
      input_schema: inputSchema,
    },
  };

  // ---- 2. Map every LangFlow node to exactly one OpenAgentic node. ----
  // Ensure unique ids and never collide with the trigger id we just minted.
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>([TRIGGER_ID]);
  const awNodes: AwNode[] = [triggerNode];

  lfNodes.forEach((node, i) => {
    const rawId = String(node?.id ?? `node_${i}`);
    let newId = rawId === TRIGGER_ID ? `${rawId}_imported` : rawId;
    while (usedIds.has(newId)) newId = `${newId}_${i}`;
    usedIds.add(newId);
    idMap.set(rawId, newId);

    const lfType = langflowTypeOf(node);
    const mapped = TYPE_MAP[normType(lfType)];
    const config = extractTemplateConfig(node);
    const displayName = node?.data?.node?.display_name as string | undefined;

    if (mapped) {
      awNodes.push({
        id: newId,
        type: mapped,
        position: {
          x: Number(node?.position?.x ?? (i + 1) * 240),
          y: Number(node?.position?.y ?? 120),
        },
        data: translateData(mapped, lfType, config, displayName),
      });
    } else {
      // UNMAPPABLE → text passthrough that carries the original config + a note.
      // Never drop the node; topology + intent survive for hand-finishing.
      awNodes.push({
        id: newId,
        type: 'text',
        position: {
          x: Number(node?.position?.x ?? (i + 1) * 240),
          y: Number(node?.position?.y ?? 120),
        },
        data: {
          label: displayName || lfType || 'Imported Component',
          text: '',
          _importNote: `Unmapped LangFlow component "${lfType || 'unknown'}" — review and replace with a native OpenAgentic node. Original config preserved under _langflow.`,
          _langflow: { type: lfType, config },
        },
      });
    }
  });

  // ---- 3. Preserve topology. Remap every edge through the id map. ----
  const awEdges: AwEdge[] = [];
  const edgeIds = new Set<string>();

  // Connect the trigger to whichever node(s) have no incoming LangFlow edge
  // (the graph roots), so the run input actually flows into the imported graph.
  const hasIncoming = new Set<string>();
  for (const e of lfEdges) {
    const tgt = e?.target ?? (e?.data as { target?: string } | undefined)?.target;
    if (tgt != null) hasIncoming.add(String(tgt));
  }

  lfEdges.forEach((e, i) => {
    const rawSource =
      e?.source ?? (e?.data as { source?: string } | undefined)?.source;
    const rawTarget =
      e?.target ?? (e?.data as { target?: string } | undefined)?.target;
    if (rawSource == null || rawTarget == null) return;
    const source = idMap.get(String(rawSource));
    const target = idMap.get(String(rawTarget));
    if (!source || !target) return;
    let id = String(e?.id ?? `e_${i}`);
    while (edgeIds.has(id)) id = `${id}_${i}`;
    edgeIds.add(id);
    awEdges.push({ id, source, target });
  });

  // Trigger → every root node (a node with no incoming edge). If a node is a
  // pure input source (TextInput/ChatInput), it's already a root, so the
  // trigger feeds the graph through it.
  let rootCounter = 0;
  for (const node of lfNodes) {
    const rawId = String(node?.id ?? '');
    if (rawId && !hasIncoming.has(rawId)) {
      const mappedId = idMap.get(rawId);
      if (mappedId) {
        let id = `e_trigger_${rootCounter++}`;
        while (edgeIds.has(id)) id = `${id}_x`;
        edgeIds.add(id);
        awEdges.push({ id, source: TRIGGER_ID, target: mappedId });
      }
    }
  }

  return { nodes: awNodes, edges: awEdges };
}

export default importLangflow;
