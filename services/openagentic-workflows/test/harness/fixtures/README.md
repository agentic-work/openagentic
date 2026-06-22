# Harness fixtures

NDJSON / JSON capture files of real flow executions. Used by per-node
primitive tests to replay deterministic input/output sequences without
having to inline a giant payload in the test file.

## Format

Each fixture is named `<node_type>.<scenario>.ndjson` and contains one
JSON object per line — typically the `frames` array a real `runFlow()`
emitted, captured via:

```ts
import fs from 'node:fs';
fs.writeFileSync(
  `test/harness/fixtures/${node}.${scenario}.ndjson`,
  result.frames.map(f => JSON.stringify(f)).join('\n'),
);
```

## Loading

A loader will land in Phase B alongside the first node test that needs
a replay-style assertion. Sketch:

```ts
function loadFixture(name: string): WorkflowExecutionFrame[] {
  const path = join(__dirname, 'fixtures', name);
  return fs.readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
```

## Currently captured

(empty — Phase A scaffold only)
