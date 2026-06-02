/**
 * Constructability + exhaustive-switch contract for the AgenticEvent taxonomy.
 *
 * If you add a new event type to types.ts, you MUST add a constructibility
 * fixture here. The exhaustive-switch test will fail at compile time if a
 * new type is added without a case branch — that's the point. The taxonomy
 * is the contract.
 */

import { describe, it, expect } from 'vitest';
import type {
  AgenticEvent,
  AgenticEventType,
  MessageStartEvent,
  ToolExecutingEvent,
  SubAgentStartedEvent,
  HitlRequestEvent,
  ArtifactStartEvent,
  StreamingTableEvent,
  DlpBlockEvent,
  RagCitationEvent,
  McpConnectEvent,
  UiOpenEvent,
  FlowNodeStartEvent,
  CostPulseEvent,
  ComposeAppEvent,
  PlatformErrorEvent,
} from '../types.js';

const NOW = 1730500000000;

// ---------------------------------------------------------------------------
// Fixtures — one per event type, minimum required fields populated.
// Used both for constructability assertions and as JSON-roundtrip canaries.
// ---------------------------------------------------------------------------

const fixtures: Record<AgenticEventType, AgenticEvent> = {
  // Layer 1 — Model-stream (provider-agnostic)
  message_start: {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  },
  content_block_start: {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  },
  content_block_delta: {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'hi' },
  },
  content_block_stop: { type: 'content_block_stop', index: 0 },
  message_delta: {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 10 },
  },
  message_stop: { type: 'message_stop' },
  ping: { type: 'ping' },
  error: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } },

  // Layer 2 — stream envelope
  stream_start: { type: 'stream_start', stream_id: 's1', ts: NOW },
  stream_end: { type: 'stream_end', stream_id: 's1', ts: NOW },
  delta_resume_marker: { type: 'delta_resume_marker', seq: 42, ts: NOW },

  // Layer 3 — tool execution
  tool_executing: {
    type: 'tool_executing',
    tool_use_id: 'tu_1',
    tool_name: 'azure_list_subscriptions',
    args_preview: '{}',
    surface: 'mcp',
    ts: NOW,
  },
  tool_completed: {
    type: 'tool_completed',
    tool_use_id: 'tu_1',
    tool_name: 'azure_list_subscriptions',
    duration_ms: 312,
    ok: true,
    bytes: 4096,
    ts: NOW,
  },
  tool_failed: {
    type: 'tool_failed',
    tool_use_id: 'tu_1',
    tool_name: 'azure_list_subscriptions',
    duration_ms: 50,
    error: 'forbidden',
    reason: 'auth',
    ts: NOW,
  },
  tool_input_delta: { type: 'tool_input_delta', tool_use_id: 'tu_1', partial_json: '{"a":1}', ts: NOW },
  tool_output_chunk: { type: 'tool_output_chunk', tool_use_id: 'tu_1', seq: 0, content: 'chunk', done: false, ts: NOW },
  tool_status: { type: 'tool_status', tool_use_id: 'tu_1', status: 'queued', ts: NOW },

  // Layer 4 — sub-agents
  agent_start: { type: 'agent_start', agent_id: 'a1', agent_type: 'cloud-operations', ts: NOW },
  agent_step: { type: 'agent_step', agent_id: 'a1', iteration: 1, summary: 'fetched subs', ts: NOW },
  agent_stop: { type: 'agent_stop', agent_id: 'a1', ok: true, iterations: 3, duration_ms: 1500, ts: NOW },
  parallel_fanout_header: { type: 'parallel_fanout_header', count: 3, tool_use_ids: ['tu_1', 'tu_2', 'tu_3'], ts: NOW },
  sub_agent_started: { type: 'sub_agent_started', task_id: 't1', agent_role: 'research', description: 'audit', ts: NOW },
  sub_agent_completed: {
    type: 'sub_agent_completed', task_id: 't1', ok: true, turns: 4, tokens: 5000, duration_ms: 30000, tools_used: ['azure_list_subscriptions'], ts: NOW,
  },
  agent_tree_update: {
    type: 'agent_tree_update',
    tree: [{ id: 'a1', role: 'cloud-operations', state: 'running', children: [] }],
    ts: NOW,
  },

  // Layer 5 — HITL
  hitl_request: {
    type: 'hitl_request',
    request_id: 'h1',
    tool_name: 'azure_delete_vm',
    args_preview: '{"vm":"x"}',
    risk: 'high',
    ts: NOW,
  },
  hitl_response: { type: 'hitl_response', request_id: 'h1', approved: false, wait_ms: 5000, ts: NOW },

  // Layer 6 — artifacts
  artifact_start: { type: 'artifact_start', artifact_id: 'art1', artifact_type: 'sankey', ts: NOW },
  artifact_delta: { type: 'artifact_delta', artifact_id: 'art1', content: '<svg', ts: NOW },
  artifact_complete: { type: 'artifact_complete', artifact_id: 'art1', bytes: 2048, ts: NOW },
  compose_visual: { type: 'compose_visual', template: 'sankey', data: { nodes: [], links: [] }, ts: NOW },
  compose_app: { type: 'compose_app', app_id: 'app1', imports: ['react', 'echarts'], source: 'export default () => null', ts: NOW },

  // Layer 7 — viz / chrome
  viz_head: { type: 'viz_head', title: 'Cloud Spend by Service', source: 'azure_cost_query · 6mo', ts: NOW },
  tool_shortlist_chip: { type: 'tool_shortlist_chip', trail: 'Azure / subscription', shortlisted: 5, total: 270, ts: NOW },
  streaming_table: {
    type: 'streaming_table',
    table_id: 't1',
    columns: [{ key: 'name', label: 'Name', type: 'string' }],
    rows: [{ name: 'sub-1' }],
    done: false,
    ts: NOW,
  },

  // Layer 8 — trust / observability
  dlp_block: { type: 'dlp_block', reason: 'pii_detected', field: 'email', ts: NOW },
  audit_event: { type: 'audit_event', subsystem: 'chat', action: 'tool_invoke', actor: 'user@x', outcome: 'success', ts: NOW },
  policy_violation: { type: 'policy_violation', policy_id: 'p1', policy_name: 'no-prod-writes', severity: 'error', description: 'attempted write to prod', ts: NOW },
  request_clarification: { type: 'request_clarification', clarification_id: 'cl1', question: 'which sub?', options: ['a', 'b'], ts: NOW },
  cost_pulse: { type: 'cost_pulse', total_usd: 0.42, last_turn_usd: 0.05, last_turn_tokens: 1200, ts: NOW },
  cost_record: { type: 'cost_record', model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 200, cost_usd: 0.012, ts: NOW },
  usage: { type: 'usage', input_tokens: 1000, output_tokens: 200, ts: NOW },

  // Layer 9 — data layers
  rag_citation: { type: 'rag_citation', index: 1, doc_id: 'd1', excerpt: '…cited…', score: 0.93, ts: NOW },
  doc_chunk: { type: 'doc_chunk', doc_id: 'd1', chunk_id: 'c1', position: 0, content: 'chunk', ts: NOW },
  memory_write: { type: 'memory_write', scope: 'session', key: 'pref.theme', value_preview: 'sha256:abc…', ts: NOW },
  embedding_indexed: { type: 'embedding_indexed', collection: 'docs', count: 100, model: 'text-embedding-3-large', duration_ms: 5000, ts: NOW },
  vector_probe: { type: 'vector_probe', collection: 'docs', query_preview: 'azure cost', hits: 5, duration_ms: 80, ts: NOW },

  // Layer 10 — MCP fabric
  mcp_connect: { type: 'mcp_connect', server: 'oap-azure-mcp', tool_count: 74, ts: NOW },
  mcp_disconnect: { type: 'mcp_disconnect', server: 'oap-azure-mcp', reason: 'restart', ts: NOW },
  mcp_capability_delta: { type: 'mcp_capability_delta', server: 'oap-azure-mcp', added: ['azure_new_tool'], removed: [], ts: NOW },

  // Layer 11 — codemode
  ui_open: { type: 'ui_open', ui_id: 'u1', root: { tag: 'div', children: [] }, ts: NOW },
  ui_patch: { type: 'ui_patch', ui_id: 'u1', ops: [{ op: 'add', path: '/0', value: {} }], ts: NOW },
  ui_close: { type: 'ui_close', ui_id: 'u1', ts: NOW },
  ui_event: { type: 'ui_event', ui_id: 'u1', event: { kind: 'click', target: '#submit' }, ts: NOW },
  kube_event: { type: 'kube_event', level: 'normal', source: 'kubelet', reason: 'Started', message: 'Started container', ts: NOW },
  file_panel_update: { type: 'file_panel_update', files: [{ path: 'src/x.ts', status: 'modified', size: 1024 }], ts: NOW },
  slash_command_synthetic: { type: 'slash_command_synthetic', command: '/model', result: 'gpt-5.4', ts: NOW },
  session_info: { type: 'session_info', session_id: 's1', model: 'gpt-5.4', openagentic_version: '0.6.2', ts: NOW },

  // Layer 12 — flows
  flow_node_start: { type: 'flow_node_start', flow_id: 'f1', node_id: 'n1', node_type: 'llm-call', ts: NOW },
  flow_node_end: { type: 'flow_node_end', flow_id: 'f1', node_id: 'n1', ok: true, duration_ms: 500, ts: NOW },
  node_progress: { type: 'node_progress', flow_id: 'f1', node_id: 'n1', progress: 0.5, ts: NOW },
  flow_canvas_state: { type: 'flow_canvas_state', flow_id: 'f1', nodes: [{ id: 'n1', state: 'running' }], ts: NOW },
  late_subscriber_catchup: { type: 'late_subscriber_catchup', missed: 12, ts: NOW },

  // Layer 13 — session durability
  session_resume: { type: 'session_resume', session_id: 's1', resume_from_seq: 100, ts: NOW },
  replay_pacing: { type: 'replay_pacing', events: 50, pacing_ms: 20, ts: NOW },
  agentic_cli_parity: { type: 'agentic_cli_parity', payload: { kind: 'turn_complete' }, ts: NOW },

  // Layer 14 — platform error
  platform_error: { type: 'platform_error', source: 'chat', message: 'transient', severity: 'warning', ts: NOW },
};

// ---------------------------------------------------------------------------
// Compile-time exhaustive-switch test.
// ---------------------------------------------------------------------------

/**
 * If a new event type is added to AgenticEvent without a fixture entry,
 * the type system will catch it: `fixtures` is `Record<AgenticEventType,
 * AgenticEvent>` — missing keys fail compilation.
 *
 * Additionally, this function uses `never` to enforce exhaustiveness in
 * runtime switch statements. If you add a new event type, this function
 * will fail to compile until you add a case branch — that's the point.
 */
function _exhaustivenessGuard(ev: AgenticEvent): string {
  switch (ev.type) {
    case 'message_start': return 'msg-start';
    case 'content_block_start': return 'cb-start';
    case 'content_block_delta': return 'cb-delta';
    case 'content_block_stop': return 'cb-stop';
    case 'message_delta': return 'msg-delta';
    case 'message_stop': return 'msg-stop';
    case 'ping': return 'ping';
    case 'error': return 'err';
    case 'stream_start': return 's-start';
    case 'stream_end': return 's-end';
    case 'delta_resume_marker': return 'resume';
    case 'tool_executing': return 't-exec';
    case 'tool_completed': return 't-done';
    case 'tool_failed': return 't-fail';
    case 'tool_input_delta': return 't-in';
    case 'tool_output_chunk': return 't-out';
    case 'tool_status': return 't-status';
    case 'agent_start': return 'a-start';
    case 'agent_step': return 'a-step';
    case 'agent_stop': return 'a-stop';
    case 'parallel_fanout_header': return 'fan';
    case 'sub_agent_started': return 'sa-start';
    case 'sub_agent_completed': return 'sa-done';
    case 'agent_tree_update': return 'a-tree';
    case 'hitl_request': return 'h-req';
    case 'hitl_response': return 'h-res';
    case 'artifact_start': return 'art-start';
    case 'artifact_delta': return 'art-delta';
    case 'artifact_complete': return 'art-done';
    case 'compose_visual': return 'cv';
    case 'compose_app': return 'ca';
    case 'viz_head': return 'viz-head';
    case 'tool_shortlist_chip': return 'chip';
    case 'streaming_table': return 'st';
    case 'dlp_block': return 'dlp';
    case 'audit_event': return 'audit';
    case 'policy_violation': return 'pol';
    case 'request_clarification': return 'clarify';
    case 'cost_pulse': return 'cp';
    case 'cost_record': return 'cr';
    case 'usage': return 'u';
    case 'rag_citation': return 'rag';
    case 'doc_chunk': return 'doc';
    case 'memory_write': return 'mem';
    case 'embedding_indexed': return 'emb';
    case 'vector_probe': return 'vp';
    case 'mcp_connect': return 'mcp+';
    case 'mcp_disconnect': return 'mcp-';
    case 'mcp_capability_delta': return 'mcp~';
    case 'ui_open': return 'ui+';
    case 'ui_patch': return 'ui~';
    case 'ui_close': return 'ui-';
    case 'ui_event': return 'ui!';
    case 'kube_event': return 'k8s';
    case 'file_panel_update': return 'fp';
    case 'slash_command_synthetic': return 'slash';
    case 'session_info': return 'si';
    case 'flow_node_start': return 'fn+';
    case 'flow_node_end': return 'fn-';
    case 'node_progress': return 'np';
    case 'flow_canvas_state': return 'fcs';
    case 'late_subscriber_catchup': return 'lsc';
    case 'session_resume': return 'sr';
    case 'replay_pacing': return 'rp';
    case 'agentic_cli_parity': return 'cli';
    case 'platform_error': return 'pe';
    default: {
      // If you see a TS2345 error here, you added an event type without
      // a case branch. Add the branch.
      const _exhaustive: never = ev;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgenticEvent taxonomy', () => {
  it('every event type has a constructibility fixture', () => {
    const expectedTypes: AgenticEventType[] = [
      'message_start', 'content_block_start', 'content_block_delta',
      'content_block_stop', 'message_delta', 'message_stop', 'ping', 'error',
      'stream_start', 'stream_end', 'delta_resume_marker',
      'tool_executing', 'tool_completed', 'tool_failed',
      'tool_input_delta', 'tool_output_chunk', 'tool_status',
      'agent_start', 'agent_step', 'agent_stop',
      'parallel_fanout_header', 'sub_agent_started', 'sub_agent_completed',
      'agent_tree_update',
      'hitl_request', 'hitl_response',
      'artifact_start', 'artifact_delta', 'artifact_complete',
      'compose_visual', 'compose_app',
      'viz_head', 'tool_shortlist_chip', 'streaming_table',
      'dlp_block', 'audit_event', 'policy_violation', 'request_clarification',
      'cost_pulse', 'cost_record', 'usage',
      'rag_citation', 'doc_chunk', 'memory_write', 'embedding_indexed', 'vector_probe',
      'mcp_connect', 'mcp_disconnect', 'mcp_capability_delta',
      'ui_open', 'ui_patch', 'ui_close', 'ui_event', 'kube_event',
      'file_panel_update', 'slash_command_synthetic', 'session_info',
      'flow_node_start', 'flow_node_end', 'node_progress',
      'flow_canvas_state', 'late_subscriber_catchup',
      'session_resume', 'replay_pacing', 'agentic_cli_parity',
      'platform_error',
    ];
    for (const t of expectedTypes) {
      expect(fixtures[t], `missing fixture for ${t}`).toBeDefined();
      expect(fixtures[t].type, `fixture for ${t} has wrong discriminator`).toBe(t);
    }
  });

  it('exhaustive switch covers every event type (compile-time guarantee)', () => {
    for (const fix of Object.values(fixtures)) {
      const tag = _exhaustivenessGuard(fix);
      expect(tag).toBeTypeOf('string');
    }
  });

  it('every fixture round-trips through JSON.stringify/parse', () => {
    for (const [k, fix] of Object.entries(fixtures)) {
      const json = JSON.stringify(fix);
      const parsed = JSON.parse(json);
      expect(parsed.type, `round-trip failed for ${k}`).toBe(k);
    }
  });

  it('MessageStartEvent shape matches spec', () => {
    const ev: MessageStartEvent = fixtures.message_start as MessageStartEvent;
    expect(ev.message.role).toBe('assistant');
    expect(ev.message.usage.input_tokens).toBe(0);
  });

  it('ToolExecutingEvent carries args_preview ≤ 200 chars in practice', () => {
    const ev: ToolExecutingEvent = fixtures.tool_executing as ToolExecutingEvent;
    expect(ev.args_preview.length).toBeLessThanOrEqual(200);
  });

  it('SubAgentStartedEvent has task_id correlation field', () => {
    const ev: SubAgentStartedEvent = fixtures.sub_agent_started as SubAgentStartedEvent;
    expect(ev.task_id).toBeDefined();
    expect(ev.agent_role).toBeDefined();
  });

  it('HitlRequestEvent risk is one of 4 levels', () => {
    const ev: HitlRequestEvent = fixtures.hitl_request as HitlRequestEvent;
    expect(['low', 'medium', 'high', 'critical']).toContain(ev.risk);
  });

  it('ArtifactStartEvent + delta + complete share artifact_id', () => {
    const start = fixtures.artifact_start as ArtifactStartEvent;
    const delta = fixtures.artifact_delta as { artifact_id: string };
    const done = fixtures.artifact_complete as { artifact_id: string };
    expect(start.artifact_id).toBe(delta.artifact_id);
    expect(start.artifact_id).toBe(done.artifact_id);
  });

  it('StreamingTableEvent rows match column keys', () => {
    const ev: StreamingTableEvent = fixtures.streaming_table as StreamingTableEvent;
    const colKeys = ev.columns.map(c => c.key);
    for (const row of ev.rows) {
      for (const k of Object.keys(row)) {
        expect(colKeys).toContain(k);
      }
    }
  });

  it('DlpBlockEvent reason is one of allowed values', () => {
    const ev: DlpBlockEvent = fixtures.dlp_block as DlpBlockEvent;
    expect(['pii_detected', 'secret_leak', 'policy_violation', 'classification_mismatch']).toContain(ev.reason);
  });

  it('RagCitationEvent.index is 1-based', () => {
    const ev: RagCitationEvent = fixtures.rag_citation as RagCitationEvent;
    expect(ev.index).toBeGreaterThan(0);
  });

  it('McpConnectEvent reports tool_count', () => {
    const ev: McpConnectEvent = fixtures.mcp_connect as McpConnectEvent;
    expect(ev.tool_count).toBeGreaterThan(0);
  });

  it('UiOpenEvent.root accepts arbitrary virtual DOM tree', () => {
    const ev: UiOpenEvent = fixtures.ui_open as UiOpenEvent;
    expect(ev.root).toBeDefined();
  });

  it('FlowNodeStartEvent + end share flow_id and node_id', () => {
    const start = fixtures.flow_node_start as FlowNodeStartEvent;
    const end = fixtures.flow_node_end as { flow_id: string; node_id: string };
    expect(start.flow_id).toBe(end.flow_id);
    expect(start.node_id).toBe(end.node_id);
  });

  it('CostPulseEvent total_usd >= last_turn_usd', () => {
    const ev: CostPulseEvent = fixtures.cost_pulse as CostPulseEvent;
    expect(ev.total_usd).toBeGreaterThanOrEqual(ev.last_turn_usd);
  });

  it('ComposeAppEvent imports allow-list documented', () => {
    const ev: ComposeAppEvent = fixtures.compose_app as ComposeAppEvent;
    expect(ev.imports.length).toBeGreaterThan(0);
  });

  it('PlatformErrorEvent.severity is one of 4 levels', () => {
    const ev: PlatformErrorEvent = fixtures.platform_error as PlatformErrorEvent;
    expect(['info', 'warning', 'error', 'fatal']).toContain(ev.severity);
  });

  it('all platform-extension events carry a `ts` epoch ms timestamp', () => {
    const platformExt: AgenticEventType[] = [
      'stream_start', 'stream_end', 'delta_resume_marker',
      'tool_executing', 'tool_completed', 'tool_failed',
      'tool_input_delta', 'tool_output_chunk', 'tool_status',
      'agent_start', 'agent_step', 'agent_stop',
      'parallel_fanout_header', 'sub_agent_started', 'sub_agent_completed',
      'agent_tree_update', 'hitl_request', 'hitl_response',
      'artifact_start', 'artifact_delta', 'artifact_complete',
      'compose_visual', 'compose_app',
      'viz_head', 'tool_shortlist_chip', 'streaming_table',
      'dlp_block', 'audit_event', 'policy_violation', 'request_clarification',
      'cost_pulse', 'cost_record', 'usage',
      'rag_citation', 'doc_chunk', 'memory_write', 'embedding_indexed', 'vector_probe',
      'mcp_connect', 'mcp_disconnect', 'mcp_capability_delta',
      'ui_open', 'ui_patch', 'ui_close', 'ui_event', 'kube_event',
      'file_panel_update', 'slash_command_synthetic', 'session_info',
      'flow_node_start', 'flow_node_end', 'node_progress',
      'flow_canvas_state', 'late_subscriber_catchup',
      'session_resume', 'replay_pacing', 'agentic_cli_parity',
      'platform_error',
    ];
    for (const t of platformExt) {
      const ev = fixtures[t] as { ts?: number };
      expect(ev.ts, `${t} missing ts`).toBeDefined();
      expect(ev.ts, `${t} ts not a number`).toBeTypeOf('number');
    }
  });
});
