/**
 * Mock 01 §857-893 contract — tool-card header surfaces an INLINE RESULT
 * SUMMARY beside the OK status, BEFORE the user expands the body.
 *
 * Mock:
 *   <span class="t-status ok">· 2 results</span>
 *   <span class="t-status ok">· 14 VMs</span>
 *   <span class="t-status ok">· 17 records</span>
 *
 * User direction 2026-05-11: "the tool calls/runs do not show any result
 * inline — there must be a summary of the result inline with a drillable
 * (input/result) as in mocks/UX/."
 *
 * Heuristic:
 *   - result is an array            → "N items"
 *   - result is an object with a    → "N {key-singularized-to-plural}"
 *     single top-level array        e.g. {subscriptions:[]} → "0 subscriptions"
 *   - result is an object with      → first key as label, "N {key}"
 *     `count`/`total` numeric       e.g. {total:42, items:[…]} → "42 items"
 *   - result is a string            → no inline summary (just OK)
 *   - status !== 'ok'               → no inline summary
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ToolCard } from '../ToolCard';

beforeEach(() => {
  try { sessionStorage.clear(); } catch { /* noop */ }
});

describe('ToolCard inline result summary in header (mock 01 §863)', () => {
  it('object with single top-level array → "N {key}" (azure_list_subscriptions case)', () => {
    const { container } = render(
      <ToolCard
        name="azure_list_subscriptions"
        status="ok"
        result={{ subscriptions: [{ id: 'a' }, { id: 'b' }] }}
      />,
    );
    const status = container.querySelector('.cm-t-status');
    expect(status?.textContent).toMatch(/2 subscriptions/);
  });

  it('plain array → "N items"', () => {
    const { container } = render(
      <ToolCard
        name="x"
        status="ok"
        result={[1, 2, 3, 4, 5]}
      />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/5 items/);
  });

  it('object with rows array → "N rows" (resource_graph_query case)', () => {
    const { container } = render(
      <ToolCard
        name="azure_resource_graph_query"
        status="ok"
        result={{ rows: new Array(14).fill({ name: 'vm' }) }}
      />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/14 rows/);
  });

  it('object with count field → "N items"', () => {
    const { container } = render(
      <ToolCard
        name="k8s_list_pods"
        status="ok"
        result={{ count: 42, items: [] }}
      />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/42 items/);
  });

  it('zero-length array → "0 items"', () => {
    const { container } = render(
      <ToolCard name="x" status="ok" result={[]} />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/0 items/);
  });

  it('zero-length object array → "0 {key}"', () => {
    const { container } = render(
      <ToolCard name="x" status="ok" result={{ accounts: [] }} />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/0 accounts/);
  });

  it('plain string → no inline summary (just OK)', () => {
    const { container } = render(
      <ToolCard name="x" status="ok" result="some text result" />,
    );
    const status = container.querySelector('.cm-t-status')?.textContent ?? '';
    expect(status).toContain('OK');
    expect(status).not.toMatch(/·/);
  });

  it('status=running → no inline summary even if result is present', () => {
    const { container } = render(
      <ToolCard name="x" status="running" result={{ items: [1, 2] }} />,
    );
    const status = container.querySelector('.cm-t-status')?.textContent ?? '';
    expect(status).not.toMatch(/items/);
  });

  it('status=err → no inline summary', () => {
    const { container } = render(
      <ToolCard name="x" status="err" errorMessage="boom" />,
    );
    const status = container.querySelector('.cm-t-status')?.textContent ?? '';
    expect(status).toContain('Failed');
    expect(status).not.toMatch(/·/);
  });

  it('summary appears with separator dot · (mock format)', () => {
    const { container } = render(
      <ToolCard name="x" status="ok" result={[1, 2]} />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toContain('·');
  });

  it('non-empty array overrides stale-or-wrong count field (2026-05-12 live capture)', () => {
    // Live capture from the dev environment — azure_list_subscriptions returned a
    // payload with `count: 0` (envelope/wire quirk) while `subscriptions`
    // had 2 entries. The summary then said "0 subscriptions" while the
    // model's body text correctly described 2 subs. Trust the array (the
    // data) over count (a derived/possibly-stale field) when both are
    // present AND the array is non-empty.
    const { container } = render(
      <ToolCard
        name="azure_list_subscriptions"
        status="ok"
        result={{ count: 0, subscriptions: [{ id: 'a' }, { id: 'b' }] }}
      />,
    );
    const status = container.querySelector('.cm-t-status')?.textContent ?? '';
    expect(status).toMatch(/2 subscriptions/);
    expect(status).not.toMatch(/0 subscriptions/);
  });

  it('zero-length array with non-zero count → keep count (existing contract preserved)', () => {
    // The previous "{count: 42, items: []}" test already pins this; this
    // case isolates the empty-array sentinel where count IS the SoT.
    const { container } = render(
      <ToolCard name="x" status="ok" result={{ count: 10, items: [] }} />,
    );
    expect(container.querySelector('.cm-t-status')?.textContent).toMatch(/10 items/);
  });
});
