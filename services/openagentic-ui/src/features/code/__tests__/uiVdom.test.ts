/**
 * TDD for the codemode UI VDOM wire-protocol contract.
 *
 * The protocol is symmetric: both the daemon (openagentic/src/cli/uiVdom/types.ts)
 * and the browser (services/openagentic-ui/src/features/code/types/_sdk-bindings.ts
 * re-exporting from @agentic-work/openagentic-sdk/vdom) define the same shapes.
 * These tests pin the canonical envelope so any
 * subsequent shape drift between the two sides is caught at the type-level
 * here AND at runtime by the round-trip parsers.
 *
 * Plan ref: ~/.claude/plans/sprightly-percolating-brook.md — Phase 0.5
 *
 * Why test the contract: drift between server-emitted and client-consumed
 * frame shapes was the dominant source of bugs in the prior dispatcher
 * (case '/model' worked, /files emitted but didn't render, /cost replied
 * "Unsupported control_request"). A pinned schema with round-trip parsers
 * eliminates that whole class.
 */

import { describe, it, expect } from 'vitest';
import {
  // Types are exported as `type`, but the runtime parser/guard is value
  // and tests assert on it. Keep both imports.
  isUiOpenFrame,
  isUiPatchFrame,
  isUiCloseFrame,
  isUiEventFrame,
  parseUiFrame,
  serializeUiFrame,
  type UiOpenFrame,
  type UiPatchFrame,
  type UiCloseFrame,
  type UiEventFrame,
  type VdomNode,
  type DiffOp,
} from '../types/_sdk-bindings';

const sampleVdom: VdomNode = {
  id: 'root',
  type: 'Box',
  props: { flexDirection: 'column', padding: 1 },
  children: [
    {
      id: 'title',
      type: 'Text',
      props: { bold: true },
      children: [{ id: 'title.txt', type: '#text', props: { value: 'Switch model' }, children: [] }],
    },
  ],
};

describe('VdomNode shape', () => {
  it('is a recursive tree with id+type+props+children', () => {
    expect(sampleVdom.id).toBe('root');
    expect(sampleVdom.type).toBe('Box');
    expect(sampleVdom.children[0]?.type).toBe('Text');
    expect(sampleVdom.children[0]?.children[0]?.props.value).toBe('Switch model');
  });
});

describe('UiOpenFrame', () => {
  const frame: UiOpenFrame = {
    type: 'ui_open',
    viewId: 'v1',
    command: '/model',
    vdom: sampleVdom,
  };

  it('isUiOpenFrame discriminates positively', () => {
    expect(isUiOpenFrame(frame)).toBe(true);
    expect(isUiOpenFrame({ type: 'ui_patch', viewId: 'v1', ops: [] })).toBe(false);
    expect(isUiOpenFrame({ type: 'assistant' })).toBe(false);
    expect(isUiOpenFrame(null)).toBe(false);
    expect(isUiOpenFrame(undefined)).toBe(false);
    expect(isUiOpenFrame('string')).toBe(false);
  });

  it('round-trips through serialize → parse without loss', () => {
    const wire = serializeUiFrame(frame);
    expect(typeof wire).toBe('string');
    const parsed = parseUiFrame(wire);
    expect(parsed).toEqual(frame);
  });
});

describe('UiPatchFrame', () => {
  const frame: UiPatchFrame = {
    type: 'ui_patch',
    viewId: 'v1',
    ops: [
      { kind: 'set_prop', path: ['root', 'title'], propKey: 'bold', value: false },
      {
        kind: 'replace_node',
        path: ['root', 'title', 'title.txt'],
        node: { id: 'title.txt', type: '#text', props: { value: 'Pick a model' }, children: [] },
      },
      { kind: 'append_child', path: ['root'], node: { id: 'hint', type: 'Text', props: { dimColor: true }, children: [] } },
      { kind: 'remove_child', path: ['root', 'hint'] },
    ],
  };

  it('isUiPatchFrame discriminates', () => {
    expect(isUiPatchFrame(frame)).toBe(true);
    expect(isUiPatchFrame({ type: 'ui_open', viewId: 'v1', command: '/x', vdom: sampleVdom })).toBe(false);
  });

  it('supports the four canonical diff op kinds', () => {
    const kinds = frame.ops.map((o) => o.kind).sort();
    expect(kinds).toEqual(['append_child', 'remove_child', 'replace_node', 'set_prop']);
  });

  it('round-trips through wire encoding', () => {
    const wire = serializeUiFrame(frame);
    expect(parseUiFrame(wire)).toEqual(frame);
  });

  it('rejects an op with an unknown kind at the type level (parse returns null on garbage)', () => {
    const bad = JSON.stringify({ type: 'ui_patch', viewId: 'v1', ops: [{ kind: 'mutate_globally', path: [] }] });
    expect(parseUiFrame(bad)).toBeNull();
  });
});

describe('UiCloseFrame', () => {
  it('reason is optional and constrained to the canonical set', () => {
    const minimal: UiCloseFrame = { type: 'ui_close', viewId: 'v1' };
    expect(isUiCloseFrame(minimal)).toBe(true);
    const withReason: UiCloseFrame = { type: 'ui_close', viewId: 'v1', reason: 'unmount' };
    expect(isUiCloseFrame(withReason)).toBe(true);
    expect(isUiCloseFrame({ type: 'ui_close', viewId: 'v1', reason: 'cancelled' })).toBe(true);
    expect(isUiCloseFrame({ type: 'ui_close', viewId: 'v1', reason: 'complete' })).toBe(true);
    // unknown reason — discriminator should reject so we don't silently
    // accept future reasons that the UI hasn't been taught to handle.
    expect(isUiCloseFrame({ type: 'ui_close', viewId: 'v1', reason: 'shrug' })).toBe(false);
  });
});

describe('UiEventFrame (browser → daemon direction)', () => {
  it('carries viewId + nodeId + kind + payload', () => {
    const keyEvent: UiEventFrame = {
      type: 'ui_event',
      viewId: 'v1',
      nodeId: 'list-row-2',
      kind: 'key',
      payload: { key: 'down', shift: false, ctrl: false, meta: false },
    };
    expect(isUiEventFrame(keyEvent)).toBe(true);
    const click: UiEventFrame = {
      type: 'ui_event',
      viewId: 'v1',
      nodeId: 'install-btn',
      kind: 'click',
      payload: { button: 'left' },
    };
    expect(isUiEventFrame(click)).toBe(true);
    const focus: UiEventFrame = {
      type: 'ui_event',
      viewId: 'v1',
      nodeId: 'list-row-3',
      kind: 'focus',
      payload: {},
    };
    expect(isUiEventFrame(focus)).toBe(true);
    expect(
      isUiEventFrame({ type: 'ui_event', viewId: 'v1', nodeId: 'x', kind: 'shrug', payload: {} }),
    ).toBe(false);
  });

  it('round-trips', () => {
    const f: UiEventFrame = {
      type: 'ui_event',
      viewId: 'v1',
      nodeId: 'list-row-2',
      kind: 'key',
      payload: { key: 'enter', shift: false, ctrl: false, meta: false },
    };
    expect(parseUiFrame(serializeUiFrame(f))).toEqual(f);
  });
});

describe('parseUiFrame defensiveness', () => {
  it('returns null on malformed JSON', () => {
    expect(parseUiFrame('not json')).toBeNull();
    expect(parseUiFrame('{')).toBeNull();
  });

  it('returns null on JSON with no `type` field', () => {
    expect(parseUiFrame(JSON.stringify({ viewId: 'v1' }))).toBeNull();
  });

  it('returns null on JSON with an unrecognized `type`', () => {
    expect(parseUiFrame(JSON.stringify({ type: 'unknown_frame', viewId: 'v1' }))).toBeNull();
  });

  it('returns null when a recognized type has missing required fields', () => {
    expect(parseUiFrame(JSON.stringify({ type: 'ui_open', viewId: 'v1' }))).toBeNull(); // missing vdom + command
    expect(parseUiFrame(JSON.stringify({ type: 'ui_patch', viewId: 'v1' }))).toBeNull(); // missing ops
    expect(parseUiFrame(JSON.stringify({ type: 'ui_close' }))).toBeNull(); // missing viewId
  });
});
