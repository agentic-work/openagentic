# @openagentic/workflow-engine

**Shared workflow-engine helpers + schema-driven node plugin registry.**

Single source of truth for the helpers + node plugins that previously lived in
both `services/openagentic-api/src/services/` and
`services/openagentic-workflows/src/services/`. Extracted in S0-11
(Task #18) to eliminate drift between the two engine copies.

## Scope (this slice)

Helpers:

- `approvalGate.ts` — auto-approval gate (S0 / B3)
- `approvalRecord.ts` — approval audit record persistence (S0 / B3)
- `secretRedaction.ts` — log-meta redaction map (S0 / B4)
- `secretAcl.ts` — per-secret ACL enforcement (S0 / B5)
- `sandbox.ts` — isolated-vm sandbox runner (S0 / B1)
- `abortableAxios.ts` — AbortController.signal threading (S0 / B7)
- `pricingLookup.ts` — DB-driven per-million-token pricing

Node plugin system:

- `nodes/registry.ts` — schema-driven plugin registry (23 migrated nodes)
- `nodes/types.ts` — `NodePlugin`, `NodeSchema`, `NodeExecutionContext`,
  `OutputAssertionError`, **and `WorkflowNode`** (moved here from the
  engine class to break the dependency direction)
- `nodes/<type>/{schema.json,executor.ts,executor.test.ts}` — 26 plugin
  folders (23 registered + 3 deferred: condition / switch / parallel)

## NOT extracted (follow-up slice)

The `WorkflowExecutionEngine.ts` class itself (5091 LOC in workflows,
3690 LOC in api) remains duplicated in both services. Reconciling the
divergent paths (plugin-registry use, `subscribeAgentProgressForWorkflowNode`,
`model_config` handling, etc.) is the next slice.

## How consumers wire up

Both consumer services declare a workspace-style file: dep:

```jsonc
// services/openagentic-workflows/package.json (npm-managed)
"dependencies": {
  "@openagentic/workflow-engine": "file:../shared/workflow-engine"
}
```

```jsonc
// services/openagentic-api/package.json (pnpm-workspace)
"dependencies": {
  "@openagentic/workflow-engine": "workspace:*"
}
```

`pnpm-workspace.yaml` lists `services/shared/workflow-engine` so the
api's `workspace:*` resolves at install time.

The legacy file paths in each service (`src/services/approvalGate.ts`,
`src/nodes/registry.ts`, etc.) are now thin **re-export shims** that
forward to `@openagentic/workflow-engine/<subpath>`. This means every
existing import inside the engine and routes (`from './approvalGate.js'`,
`from '../nodes/registry.js'`) keeps working unchanged.

## Build

The shared package's tsconfig emits to `./dist`. The package.json
`exports` map points consumers at the compiled `.js` + `.d.ts`. Each
consumer's Dockerfile builds the shared package after `pnpm install` /
`npm install`:

```dockerfile
COPY services/shared/workflow-engine /shared/workflow-engine
RUN ln -sfn /app/node_modules /shared/workflow-engine/node_modules
RUN cd /shared/workflow-engine && /app/node_modules/.bin/tsc -p tsconfig.json
```

The `node_modules` symlink is required because NodeNext refuses to walk
past the package boundary when resolving bare imports
(`isolated-vm`, `axios`, `@prisma/client/runtime/library`). With the
symlink in place, tsc resolves these from the consumer's node_modules
during type-check, and Node finds them via standard walk-up at runtime.

## Tests

This package owns its test suite (354 tests as of extraction). Run
directly:

```bash
cd services/shared/workflow-engine
npx vitest run
```

Tests reuse the consumer's installed deps via the same node_modules
symlink (created at dev-setup time; recreated in each Dockerfile build).

The CI sharding strategy in Task #34 (OOM mitigation) treats this as a
separate test target alongside workflows + api.

## Why a file:/workspace dep, not a published package?

- Internal-only — no need for registry semantics, versioning, or
  publishing.
- File-system layout keeps "single editable copy" semantics: the
  developer edits `services/shared/workflow-engine/src/foo.ts` and
  both consumers pick up the change after rebuild. Drift mirroring
  across two engine copies is gone.
- pnpm workspaces handle the api side natively; npm's `file:` protocol
  handles the workflows side without forcing it into the pnpm workspace
  (workflows is npm-managed today, and bringing it into pnpm is a
  separate non-trivial migration).
