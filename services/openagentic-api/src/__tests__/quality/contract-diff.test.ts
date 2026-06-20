/**
 * Contract diff — RED tests (Phase 0.3).
 *
 * the design notes
 *
 * Given a wire Timeline (from 0.1) + a `.contract.json` (mocks/UX/AI/Chatmode),
 * assert the contract's `frames[]` sequence appears as an ordered SUBSEQUENCE
 * of the timeline's frame types. Each contract frame must match a Timeline
 * entry (or DOM-trace entry once 0.2 lands) AFTER the previous match.
 *
 * This is the Q-loop pass/fail gate: if the captured turn doesn't satisfy
 * the contract's ordered-subsequence shape, the mock parity is broken.
 *
 * Mapping rules (contract type → Timeline frame types):
 *   - assistant_prose  → text-bearing frame (content_block_delta with text_delta, or stream)
 *   - thinking         → thinking | thinking_event
 *   - tool_use         → tool_executing OR tool_use (paired with later tool_result; matcher
 *                         accepts either as the "start" anchor for this contract frame)
 *   - sub_agent        → subagent_started OR Task tool_use
 *   - streaming_table  → tool_result whose payload looks like a table (heuristic; relax
 *                         to "any tool_result" for now since contract.rows is structural)
 *   - app_render       → app_render | compose_app | compose_visual
 *   - compose_visual   → compose_visual
 *   - follow_up        → follow_up (legacy, accepted but not required)
 *
 * Ordered subsequence: contract frame i must match a Timeline entry at index >= prevMatch+1.
 */

import { describe, it, expect } from 'vitest';
import { buildTimeline, parseWireCaptureLog } from './wire-timeline-viewer.js';
import { diffContractAgainstTimeline, type ContractFrame } from './contract-diff.js';

const FIXTURE_AZURE_CONTRACT: ContractFrame[] = [
  { type: 'assistant_prose', preview: 'Cascading across Azure tools…' },
  { type: 'sub_agent', agent: 'cloud_operations' },
  { type: 'tool_use', tool: 'azure_list_subscriptions' },
  { type: 'tool_use', tool: 'azure_list_resource_groups' },
  { type: 'streaming_table' },
  { type: 'app_render', template: 'sankey' },
  { type: 'assistant_prose', preview: 'Found 3 subscriptions…' },
  { type: 'follow_up' },
];

const HAPPY_PATH_LOG = [
  // prose → tool_use × 2 → tool_result × 2 → text → app_render → text → follow_up
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":1,"frameType":"content_block_delta","payload":{"_ts":1,"delta":{"type":"text_delta","text":"Cascading across"},"index":0}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":2,"frameType":"subagent_started","payload":{"_ts":2,"agent":"cloud_operations"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":3,"frameType":"tool_executing","payload":{"_ts":3,"name":"azure_list_subscriptions","tool_use_id":"a"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":4,"frameType":"tool_executing","payload":{"_ts":4,"name":"azure_list_resource_groups","tool_use_id":"b"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":5,"frameType":"tool_result","payload":{"_ts":5,"name":"azure_list_subscriptions","tool_use_id":"a","content":{}}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":6,"frameType":"tool_result","payload":{"_ts":6,"name":"azure_list_resource_groups","tool_use_id":"b","content":{}}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":7,"frameType":"app_render","payload":{"_ts":7,"template":"sankey"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":8,"frameType":"content_block_delta","payload":{"_ts":8,"delta":{"type":"text_delta","text":"Found 3 subscriptions"},"index":4}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-happy","seq":9,"frameType":"follow_up","payload":{"_ts":9}}`,
].join('\n');

const OUT_OF_ORDER_LOG = [
  // tool_use BEFORE prose — violates contract order.
  `{"tag":"WIRE-CAPTURE","turnId":"t-oo","seq":1,"frameType":"tool_executing","payload":{"_ts":1,"name":"azure_list_subscriptions","tool_use_id":"a"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-oo","seq":2,"frameType":"content_block_delta","payload":{"_ts":2,"delta":{"type":"text_delta","text":"Cascading"},"index":0}}`,
].join('\n');

const MISSING_APP_RENDER_LOG = [
  `{"tag":"WIRE-CAPTURE","turnId":"t-m","seq":1,"frameType":"content_block_delta","payload":{"_ts":1,"delta":{"type":"text_delta","text":"x"},"index":0}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-m","seq":2,"frameType":"subagent_started","payload":{"_ts":2,"agent":"cloud_operations"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-m","seq":3,"frameType":"tool_executing","payload":{"_ts":3,"name":"azure_list_subscriptions"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-m","seq":4,"frameType":"tool_executing","payload":{"_ts":4,"name":"azure_list_resource_groups"}}`,
  `{"tag":"WIRE-CAPTURE","turnId":"t-m","seq":5,"frameType":"tool_result","payload":{"_ts":5,"name":"azure_list_subscriptions","content":{}}}`,
  // NO app_render frame
  `{"tag":"WIRE-CAPTURE","turnId":"t-m","seq":6,"frameType":"content_block_delta","payload":{"_ts":6,"delta":{"type":"text_delta","text":"Found 3"},"index":3}}`,
].join('\n');

describe('diffContractAgainstTimeline', () => {
  it('passes when timeline contains every contract frame in order', () => {
    const timeline = buildTimeline(parseWireCaptureLog(HAPPY_PATH_LOG));
    const result = diffContractAgainstTimeline(FIXTURE_AZURE_CONTRACT, timeline);

    expect(result.passed).toBe(true);
    expect(result.matches).toHaveLength(FIXTURE_AZURE_CONTRACT.length);
    expect(result.unmatched).toEqual([]);
  });

  it('records the matched Timeline entry seq for each contract frame', () => {
    const timeline = buildTimeline(parseWireCaptureLog(HAPPY_PATH_LOG));
    const result = diffContractAgainstTimeline(FIXTURE_AZURE_CONTRACT, timeline);
    // contract index 0 (assistant_prose) → timeline seq=1
    expect(result.matches[0].timelineSeq).toBe(1);
    // contract index 1 (sub_agent) → seq=2
    expect(result.matches[1].timelineSeq).toBe(2);
    // contract index 2 (tool_use azure_list_subscriptions) → seq=3
    expect(result.matches[2].timelineSeq).toBe(3);
    // contract index 4 (streaming_table) → seq=5 (first tool_result)
    expect(result.matches[4].timelineSeq).toBe(5);
    // contract index 5 (app_render sankey) → seq=7
    expect(result.matches[5].timelineSeq).toBe(7);
  });

  it('fails when contract frames appear out of order in timeline', () => {
    const timeline = buildTimeline(parseWireCaptureLog(OUT_OF_ORDER_LOG));
    const result = diffContractAgainstTimeline(
      [
        { type: 'assistant_prose' },
        { type: 'tool_use', tool: 'azure_list_subscriptions' },
      ],
      timeline,
    );
    // prose can only match at seq=2 (the text_delta), tool_use only at seq=1.
    // ordered subsequence requires tool_use to appear AFTER prose — impossible.
    expect(result.passed).toBe(false);
    expect(result.unmatched.map((u) => u.frame.type)).toContain('tool_use');
  });

  it('fails when a required contract frame is missing', () => {
    const timeline = buildTimeline(parseWireCaptureLog(MISSING_APP_RENDER_LOG));
    const result = diffContractAgainstTimeline(
      FIXTURE_AZURE_CONTRACT.filter((f) => f.type !== 'follow_up'),
      timeline,
    );
    expect(result.passed).toBe(false);
    const unmatchedTypes = result.unmatched.map((u) => u.frame.type);
    expect(unmatchedTypes).toContain('app_render');
  });

  it('treats follow_up frames as optional (legacy)', () => {
    // Contract has follow_up at end. Timeline does NOT emit follow_up.
    // Still passes because follow_up is optional.
    const noFollowUpLog = HAPPY_PATH_LOG.split('\n')
      .filter((l) => !l.includes('"frameType":"follow_up"'))
      .join('\n');
    const timeline = buildTimeline(parseWireCaptureLog(noFollowUpLog));
    const result = diffContractAgainstTimeline(FIXTURE_AZURE_CONTRACT, timeline);
    expect(result.passed).toBe(true);
  });

  it('matches tool_use by tool name when contract specifies one', () => {
    const timeline = buildTimeline(
      parseWireCaptureLog(
        [
          `{"tag":"WIRE-CAPTURE","turnId":"t","seq":1,"frameType":"tool_executing","payload":{"_ts":1,"name":"aws_list_accounts"}}`,
          `{"tag":"WIRE-CAPTURE","turnId":"t","seq":2,"frameType":"tool_executing","payload":{"_ts":2,"name":"azure_list_subscriptions"}}`,
        ].join('\n'),
      ),
    );
    const result = diffContractAgainstTimeline(
      [{ type: 'tool_use', tool: 'azure_list_subscriptions' }],
      timeline,
    );
    // Should match seq=2, not seq=1.
    expect(result.passed).toBe(true);
    expect(result.matches[0].timelineSeq).toBe(2);
  });

  it('does not allow the same timeline entry to satisfy two contract frames', () => {
    const log = [
      `{"tag":"WIRE-CAPTURE","turnId":"t","seq":1,"frameType":"content_block_delta","payload":{"_ts":1,"delta":{"type":"text_delta","text":"hello"},"index":0}}`,
    ].join('\n');
    const timeline = buildTimeline(parseWireCaptureLog(log));
    const result = diffContractAgainstTimeline(
      [{ type: 'assistant_prose' }, { type: 'assistant_prose' }],
      timeline,
    );
    // Only one prose frame in timeline; second contract prose unmatched.
    expect(result.passed).toBe(false);
    expect(result.unmatched).toHaveLength(1);
  });
});
