/**
 * agent_pool streaming — Tier D placeholder (BLOCKED on openagentic-proxy).
 *
 * See agent_single.streaming.test.ts for the full Tier D rationale +
 * scope description. openagentic-proxy needs an /execute-stream endpoint
 * before any of the 5 agent_* nodes can emit per-token canonical
 * frames.
 */

import { describe, it } from 'vitest';

describe.skip('agent_pool per-token streaming (Tier D — openagentic-proxy work)', () => {
  it.todo('emits text_delta events when openagentic-proxy supports /execute-stream');
});
