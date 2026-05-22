import { describe, it, expect } from 'vitest';
import {
  buildMessageStart,
  buildContentBlockStart,
  buildContentBlockDelta,
  buildContentBlockStop,
  buildMessageDelta,
  buildMessageStop,
  buildStreamStart,
  buildStreamEnd,
  buildToolExecuting,
  buildToolCompleted,
  buildToolFailed,
  buildSubAgentStarted,
  buildSubAgentCompleted,
  buildHitlRequest,
  buildHitlResponse,
  buildArtifactStart,
  buildArtifactComplete,
  buildComposeVisual,
  buildComposeApp,
  buildTierHint,
  buildModelHandoffOffer,
  buildToolShortlistChip,
  buildStreamingTable,
  buildCostPulse,
  buildCostRecord,
  buildRagCitation,
  buildPlatformError,
} from '../index.js';

describe('event builders — Layer 1 (model-stream)', () => {
  it('buildMessageStart stamps type=message_start', () => {
    const e = buildMessageStart({
      message: {
        id: 'm1',
        type: 'message',
        role: 'assistant',
        model: 'gpt-oss:20b',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    expect(e.type).toBe('message_start');
    expect(e.message.model).toBe('gpt-oss:20b');
  });

  it('buildContentBlockStart / Delta / Stop round-trip', () => {
    const start = buildContentBlockStart({
      index: 0,
      content_block: { type: 'text', text: '' },
    });
    expect(start.type).toBe('content_block_start');
    expect(start.index).toBe(0);

    const delta = buildContentBlockDelta({
      index: 0,
      delta: { type: 'text_delta', text: 'hi' },
    });
    expect(delta.type).toBe('content_block_delta');
    expect(delta.delta.type).toBe('text_delta');

    const stop = buildContentBlockStop({ index: 0 });
    expect(stop.type).toBe('content_block_stop');
  });

  it('buildMessageDelta / buildMessageStop', () => {
    const md = buildMessageDelta({
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 42 },
    });
    expect(md.type).toBe('message_delta');
    expect(md.delta.stop_reason).toBe('tool_use');

    const ms = buildMessageStop();
    expect(ms.type).toBe('message_stop');
  });
});

describe('event builders — Layer 2+ stamp ts automatically', () => {
  it('buildStreamStart stamps ts from Date.now()', () => {
    const before = Date.now();
    const e = buildStreamStart({
      stream_id: 's1',
      message_id: 'm1',
      provider: 'ollama',
      model: 'gpt-oss:20b',
      schema_version: '1.0.0',
    });
    const after = Date.now();
    expect(e.type).toBe('stream_start');
    expect(e.ts).toBeGreaterThanOrEqual(before);
    expect(e.ts).toBeLessThanOrEqual(after);
  });

  it('buildStreamStart honors nowOverride for deterministic tests', () => {
    const e = buildStreamStart(
      {
        stream_id: 's1',
        message_id: 'm1',
        provider: 'ollama',
        model: 'gpt-oss:20b',
        schema_version: '1.0.0',
      },
      1700000000000,
    );
    expect(e.ts).toBe(1700000000000);
  });

  it('buildStreamEnd has type=stream_end and ts', () => {
    const e = buildStreamEnd({ stream_id: 's1' });
    expect(e.type).toBe('stream_end');
    expect(typeof e.ts).toBe('number');
  });
});

describe('event builders — Layer 3 (tool execution)', () => {
  it('buildToolExecuting captures tool dispatch', () => {
    const e = buildToolExecuting({
      tool_use_id: 'toolu_abc',
      tool_name: 'azure_list_subscriptions',
      args_preview: '{"tenantId":"phatoldsun"}',
      surface: 'mcp',
    });
    expect(e.type).toBe('tool_executing');
    expect(e.tool_name).toBe('azure_list_subscriptions');
    expect(e.surface).toBe('mcp');
  });

  it('buildToolCompleted carries duration + ok flag', () => {
    const e = buildToolCompleted({
      tool_use_id: 'toolu_abc',
      tool_name: 'azure_list_subscriptions',
      duration_ms: 320,
      ok: true,
    });
    expect(e.type).toBe('tool_completed');
    expect(e.ok).toBe(true);
    expect(e.duration_ms).toBe(320);
  });

  it('buildToolFailed carries error reason', () => {
    const e = buildToolFailed({
      tool_use_id: 'toolu_abc',
      tool_name: 'azure_delete_vm',
      duration_ms: 50,
      error: 'denied',
      reason: 'hitl_denied',
    });
    expect(e.type).toBe('tool_failed');
    expect(e.reason).toBe('hitl_denied');
  });
});

describe('event builders — Layer 4 (sub-agents)', () => {
  it('buildSubAgentStarted captures dispatch', () => {
    const e = buildSubAgentStarted({
      task_id: 'task_xyz',
      agent_role: 'cloud_operations',
      description: 'audit IAM drift',
    });
    expect(e.type).toBe('sub_agent_started');
    expect(e.agent_role).toBe('cloud_operations');
  });

  it('buildSubAgentCompleted captures summary', () => {
    const e = buildSubAgentCompleted({
      task_id: 'task_xyz',
      ok: true,
      output: 'no drift detected',
    });
    expect(e.type).toBe('sub_agent_completed');
    expect(e.ok).toBe(true);
  });
});

describe('event builders — Layer 5 (HITL)', () => {
  it('buildHitlRequest / buildHitlResponse round-trip', () => {
    const req = buildHitlRequest({
      request_id: 'h1',
      tool_use_id: 'toolu_destructive',
      tool_name: 'azure_delete_vm',
      risk: 'high',
      preview: 'will delete vm-prod-01',
      timeout_ms: 120000,
    });
    expect(req.type).toBe('hitl_request');
    expect(req.risk).toBe('high');

    const res = buildHitlResponse({
      request_id: 'h1',
      decision: 'approved',
    });
    expect(res.type).toBe('hitl_response');
    expect(res.decision).toBe('approved');
  });
});

describe('event builders — Layer 6/7 (artifacts + viz)', () => {
  it('buildComposeVisual carries template + data + tier', () => {
    const e = buildComposeVisual({
      artifact_id: 'art_v1',
      template: 'sankey',
      data: { nodes: [], edges: [] },
      tier: 2,
    });
    expect(e.type).toBe('compose_visual');
    expect(e.template).toBe('sankey');
    expect(e.tier).toBe(2);
  });

  it('buildComposeApp carries spec + libs + tier', () => {
    const e = buildComposeApp({
      artifact_id: 'art_app1',
      spec: { kind: 'kpi_grid', kpis: [] },
      libs: ['echarts'],
      tier: 3,
    });
    expect(e.type).toBe('compose_app');
    expect(e.libs).toEqual(['echarts']);
  });

  it('buildTierHint carries tier + fca', () => {
    const e = buildTierHint({
      message_id: 'm1',
      tier: 3,
      fca: 0.92,
      reason: 'destructive',
    });
    expect(e.type).toBe('tier_hint');
    expect(e.tier).toBe(3);
  });

  it('buildModelHandoffOffer suggests escalation', () => {
    const e = buildModelHandoffOffer({
      message_id: 'm1',
      from_model: 'gpt-oss:20b',
      to_model: 'claude-sonnet-4-6',
      reason: 'destructive_high_fca',
    });
    expect(e.type).toBe('model_handoff_offer');
    expect(e.to_model).toBe('claude-sonnet-4-6');
  });

  it('buildToolShortlistChip carries cascade trail', () => {
    const e = buildToolShortlistChip({
      message_id: 'm1',
      intent: 'cloud-list',
      server: 'azure',
      keywords: ['subscription'],
      input_count: 270,
      output_count: 5,
    });
    expect(e.type).toBe('tool_shortlist_chip');
    expect(e.input_count).toBe(270);
    expect(e.output_count).toBe(5);
  });

  it('buildStreamingTable supports row append', () => {
    const e = buildStreamingTable({
      stream_id: 'tbl1',
      header: ['a', 'b'],
      rows: [['1', '2']],
      mode: 'append',
    });
    expect(e.type).toBe('streaming_table');
    expect(e.rows).toEqual([['1', '2']]);
  });
});

describe('event builders — Layer 8 (cost / observability)', () => {
  it('buildCostPulse captures incremental cost', () => {
    const e = buildCostPulse({
      message_id: 'm1',
      delta_usd: 0.0012,
      total_usd: 0.0421,
    });
    expect(e.type).toBe('cost_pulse');
    expect(e.delta_usd).toBeCloseTo(0.0012, 4);
  });

  it('buildCostRecord captures full ledger row', () => {
    const e = buildCostRecord({
      message_id: 'm1',
      model: 'claude-sonnet-4-6',
      input_tokens: 1234,
      output_tokens: 567,
      total_usd: 0.0421,
    });
    expect(e.type).toBe('cost_record');
    expect(e.input_tokens).toBe(1234);
  });
});

describe('event builders — Layer 9 (RAG)', () => {
  it('buildRagCitation carries source + score', () => {
    const e = buildRagCitation({
      doc_id: 'doc1',
      title: 'Phase 2 spec',
      url: 'https://docs.example.com/phase2',
      snippet: 'discriminator schema...',
      score: 0.87,
    });
    expect(e.type).toBe('rag_citation');
    expect(e.score).toBeCloseTo(0.87, 2);
  });
});

describe('event builders — Layer 14 (platform error)', () => {
  it('buildPlatformError carries layer + code', () => {
    const e = buildPlatformError({
      where: 'normalizer',
      code: 'VERTEX_INVALID_FINISH_REASON',
      message: 'unknown finishReason: WILD',
    });
    expect(e.type).toBe('platform_error');
    expect(e.code).toBe('VERTEX_INVALID_FINISH_REASON');
  });
});

describe('builders return types match the canonical AgenticEvent union', () => {
  it('every builder result has a `type` discriminant', () => {
    const events = [
      buildMessageStart({
        message: {
          id: 'x',
          type: 'message',
          role: 'assistant',
          model: 'm',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      buildArtifactStart({
        artifact_id: 'a1',
        kind: 'svg',
        producer: 'compose_visual',
      }),
      buildArtifactComplete({
        artifact_id: 'a1',
        bytes: 1024,
      }),
    ];
    for (const e of events) {
      expect(typeof e.type).toBe('string');
      expect((e.type as string).length).toBeGreaterThan(0);
    }
  });
});
