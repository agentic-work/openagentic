# Bob UC Harness

Smoke-tests Bob's `cloud_operations` use cases against a live
OpenAgentic chat API. Zero npm deps, one bun file.

## Files
- `bob-uc.yaml` — UC catalog (id, prompt, expected_tools, expected_patterns, timeout_s)
- `run-uc.ts` — bun-runnable runner using native `fetch` + SSE parsing

## Run

```sh
export UC_HARNESS_TOKEN=<bearer-jwt>
export UC_API_BASE=https://chat-dev.openagentic.io   # default
bun testing/uc-harness/run-uc.ts                     # uses bob-uc.yaml
bun testing/uc-harness/run-uc.ts path/to/other.yaml  # override
```

If `UC_HARNESS_TOKEN` is unset the runner prints a skip line and exits 0
(so it's safe to wire into CI that only has a token in some envs).

## Assertions per case
- every `expected_tools` entry appears in the streamed tool calls
- every `expected_patterns` regex matches the assistant text (case-insens.)
- no SSE error event

Non-zero exit if any UC fails. Prints a pass/fail table at the end.

## Adding a case
Append a list item to `bob-uc.yaml`:

```yaml
- id: UC-XYZ-short-slug
  prompt: "..."
  expected_tools: [tool_a, tool_b]
  expected_patterns: ["regex1", "regex2"]
  timeout_s: 120
```
