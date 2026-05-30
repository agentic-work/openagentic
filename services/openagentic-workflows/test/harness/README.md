# Flows test harness (Phase A)

CI-runnable vitest framework that exercises every node primitive
deterministically against the **real** `WorkflowExecutionEngine` — no
Fastify, no DB, no live network. Replaces ad-hoc Playwright sweeps that
miss bugs because they only hit the happy path.

## Run

```bash
cd services/openagentic-workflows
npm run test:harness            # vitest with the harness config
# or: npx vitest run --config vitest.harness.config.ts
```

## Layout

```
test/harness/
├── runFlow.ts             # executes a flow def through the engine
├── setup.ts               # vitest setupFile — prisma+logger mocks, MSW hooks
├── mocks/
│   ├── msw-setup.ts       # MSW node server — listen/reset/close
│   └── handlers/
│       └── default.ts     # baseline httpbin-style handlers
├── fixtures/              # real-data NDJSON captures (future)
└── primitives/            # one test file per node type
    └── http_request.test.ts
```

## Writing a new node test

Each node primitive gets its own file under `primitives/`. Minimum template:

```ts
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { runFlow } from '../runFlow';
import { harnessServer } from '../mocks/msw-setup';

describe('my_node — primitive contract', () => {
  it('does what its schema says', async () => {
    // 1. Set up any per-test HTTP mocks.
    harnessServer.use(
      http.post('https://example.com/api', () => HttpResponse.json({ ok: true })),
    );

    // 2. Build the minimum flow that exercises the executor.
    const result = await runFlow({
      flow: {
        nodes: [
          { id: 'trig', type: 'trigger', data: {} },
          { id: 'me',   type: 'my_node', data: { /* settings */ } },
        ],
        edges: [{ id: 'e1', source: 'trig', target: 'me' }],
      },
      input: { /* trigger payload */ },
    });

    // 3. Assert against runFlow's output snapshot.
    expect(result.status).toBe('completed');
    expect(result.outputs.me).toMatchObject({ /* expected shape */ });
  });
});
```

## What `runFlow` gives you

```ts
{
  status: 'completed' | 'failed' | 'cancelled',
  frames: WorkflowExecutionFrame[],   // every event the engine emitted
  outputs: Record<string, unknown>,   // last value per nodeId
  durationMs: number,
  error?: { message: string, nodeId?: string },
  raw: { success, output, error },    // engine return value verbatim
}
```

- `frames` is ordered (arrival order). Filter with
  `frames.filter(f => f.type === 'node_complete')` to inspect each
  emit pair.
- `outputs[nodeId]` is the **last** value the engine stored for that
  node. For nodes that emit multiple times (`loop`, `parallel`), look at
  `frames` for the full sequence.
- `raw` is the literal `{success, output, error}` from
  `executeWorkflow()` — use this if you need to diff against legacy
  test patterns.

## MSW handler scope

- Baseline handlers in `mocks/handlers/default.ts` apply to every test.
- Per-test overrides via `harnessServer.use(http.get(...))` are reset by
  the `afterEach` hook in `mocks/msw-setup.ts`.
- Unhandled requests log a warning, so a forgotten mock fails loudly
  rather than hitting the real internet.

## Why no DB?

Phase A keeps the harness pure-in-memory: the prisma client is mocked in
`setup.ts` and every workflow-table call returns undefined / [] / null.
Persistence is a separate Phase F concern — out of scope for primitive
contracts.

## Phase plan

| Phase | Owner | Scope |
|-------|-------|-------|
| **A** | (this PR) | Scaffold + `http_request` proof-of-life |
| B | Next implementer | RED tests for `condition`, `loop`, `transform`, `error_handler`, `merge` (the broken-core-5) |
| C | per-fix implementer | The remaining 39 nodes + 8 built-in agents |
| D | LLM-class | mock-aware LLM nodes via `testMocks` (Phase B #17 in engine) |
| E | infra | CI wire-up + coverage thresholds |
