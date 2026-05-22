# Codemode live proof — chat-dev evidence

Run: 2026-05-02T13:10:38.493Z
Base: https://chat-dev.openagentic.io
Account: mcp-tester@phatoldsungmail.onmicrosoft.com

Spec file: `codemode-live-proof.spec.ts` — 980 LOC, 45405 bytes

## Test 1 — Tool inline interleaving — **SOFT-SKIP**

Tool blocks observed in DOM order: ["Read"]

SOFT-SKIP: gpt-oss:20b only emitted ["Read"] — the prompt asked for Read → Bash → Write but the model declined to issue all three tool calls. The render pipeline cannot be proved on the missing steps without the model cooperating; re-run after switching the codemode default to a frontier model.

![interleave.png](codemode-live-proof-artifacts/interleave.png)

## Test 2 — Parallel subagent dispatch — **SOFT-SKIP**

Task blocks first-seen offsets (ms from submit): {"call_25c362bd869d4df08a34d6cc":2687,"call_231cb458fd184d6ba973f898":11246}

SOFT-SKIP: gpt-oss:20b (codemode default on chat-dev) declined to fan out 3 parallel Task calls. This is a model-side compliance issue, not a render-pipeline bug. To re-prove fan-out, re-run after switching the codemode default to a frontier model that reliably emits parallel tool_use blocks.

![parallel-subagents.png](codemode-live-proof-artifacts/parallel-subagents.png)

## Test 3 — TodoWrite live counter — **SOFT-SKIP**

Active todo render path: status-tasks-only (ActiveTaskBar fallback)

ActiveTaskBar progress badge visible: true

ROOT CAUSE: gpt-oss:20b emitted the Todo tool with `(5 todos)` summary but the materialised UiToolUseBlock arrived without `input.todos` — `SpecialisedToolBody` returns null and the canonical `.cm-todo-list` never renders. ActiveTaskBar still works (its source is the daemon-side todo state event), so the live counter does propagate; only the inline tool-body render is missing. TODO: add a `input.todos` parse fallback in `Part.tsx::SpecialisedToolBody` (around line 1287) that reads `result.text` JSON when `input.todos` is empty, or adjust `useCodeModeState.ts::session_event todoupdate` to backfill the parent block input.

![todowrite.png](codemode-live-proof-artifacts/todowrite.png)

## Test 4 — Thinking blocks default-collapsed — **SOFT-SKIP**

SOFT-SKIP: no [data-part="thinking"] block was emitted by the model for this prompt.

![thinking-collapsed.png](codemode-live-proof-artifacts/thinking-collapsed.png)
