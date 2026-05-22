# Agent Registry Test Coverage

Sprint deliverable for agent registry regression suite.
Source of truth: `AgentRegistry.ts` exported constants + `admin-agents.ts` SEED_AGENTS.

## Summary

| Layer | Tests | Status |
|-------|-------|--------|
| Static config (A1) | 19 agents × ~12 assertions each | DONE |
| Expected-output schema (A2) | 19 schemas in harness | DONE |
| Behavior test harness (A3) | Parameterized helper | DONE |
| Behavior tests — 5 agents (A3+A4) | reasoning, data_query, code_execution, summarization, validation | DONE |
| Behavior tests — 14 remaining agents | See follow-up column below | TODO |

**Total new tests added: 486**
**Test files added: 6**

---

## Agent Count Clarification

The UI sidebar shows "32 draggable items" — this includes multiple instances of the
same type (e.g., multiple custom agents). The underlying unique `AgentType` values
are **19**. This suite covers all 19.

---

## Static Config Tests (`agentRegistry.static.test.ts`)

Tests `DEFAULT_MODEL_CONFIGS`, `DEFAULT_TOOLS_WHITELIST`, `DEFAULT_PROMPT_MODULES`
against all 19 agent types. No DB required.

### All 19 Agents — Static Config Pass/Fail

| Agent | A1-b config exists | A1-c primaryModel='auto' | A1-j preferredTier valid | A1-k tools whitelist | A1-l prompt modules |
|-------|-------------------|--------------------------|--------------------------|---------------------|---------------------|
| data_query | PASS | PASS | economical | [admin_postgres_raw_query, query_data] | PASS |
| data_extraction | PASS | PASS | economical | [] (all tools) | PASS |
| tool_orchestration | PASS | PASS | balanced | [] (all tools) | PASS |
| reasoning | PASS | PASS | premium | [web_search, web_fetch, sequential_thinking] | PASS |
| summarization | PASS | PASS | economical | [] (all tools) | PASS |
| code_execution | PASS | PASS | balanced | [openagentic_execute] | PASS |
| planning | PASS | PASS | premium | [] (all tools) | PASS |
| validation | PASS | PASS | economical | [web_search] | PASS |
| synthesis | PASS | PASS | balanced | [] (all tools) | PASS |
| artifact_creation | PASS | PASS | premium | [] (all tools) | PASS |
| docs_assistant | PASS | PASS | balanced | [web_search, web_fetch] | PASS |
| flows_agent | PASS | PASS | premium | [] (all tools) | PASS |
| oat_function_builder | PASS | PASS | balanced | [] (all tools) | PASS |
| cloud_operations | PASS | PASS | premium (1M ctx) | [] (all tools) | PASS (20 modules) |
| finops_analyst | PASS | PASS | premium | [] (all tools) | PASS |
| security_auditor | PASS | PASS | premium | [] (all tools) | PASS |
| engineering_metrics | PASS | PASS | premium | [] (all tools) | PASS |
| product_analyst | PASS | PASS | premium | [] (all tools) | PASS |
| custom | PASS | PASS | balanced | [] (all tools) | PASS |

All 19 pass all 12 assertion types. See `agentRegistry.static.test.ts` for the
full parameterized test suite.

---

## Expected Output Schemas (A2)

Declared in `agentBehavior.harness.ts` → `AGENT_EXPECTED_OUTPUT_SCHEMAS`.

Note: The Prisma schema change (`expected_output_schema Json?` on the `Agent` model)
is deferred per the implementation spec (risk of conflicting with concurrent
tenant_id migration). Schemas live in the test harness as fixtures until the
DB migration is applied.

| Agent | Output Type | Required Fields | Notes |
|-------|-------------|-----------------|-------|
| reasoning | text/markdown | — | min 50 chars |
| data_query | JSON | rows (array) | row_count optional |
| tool_orchestration | text | — | non-empty |
| summarization | text/markdown | — | min 20 chars |
| code_execution | text/markdown | — | must reference execution result |
| planning | text/markdown | — | must contain enumerated steps |
| validation | JSON | valid (boolean) | reason optional |
| synthesis | text/markdown | — | min 20 chars |
| artifact_creation | text/markdown | — | min 30 chars |
| docs_assistant | text/markdown | — | min 20 chars |
| flows_agent | text | — | non-empty |
| oat_function_builder | text/markdown | — | min 20 chars |
| cloud_operations | text/markdown | — | min 30 chars |
| finops_analyst | text/markdown | — | min 20 chars |
| security_auditor | text/markdown | — | min 20 chars |
| engineering_metrics | text/markdown | — | min 20 chars |
| product_analyst | text/markdown | — | min 20 chars |
| data_extraction | JSON | extracted (array/obj) | — |
| custom | text | — | non-empty |

---

## Behavior Tests — 5 Agents (A3 + A4)

### reasoning (`reasoning.behavior.test.ts`)
- A3: web_search returns synthetic results → LLM produces structured markdown analysis
- A4: web_search returns null → response carries `[AGENT_FAILED]` sentinel
- Extra: thinkingEnabled, thinkingBudget, tools whitelist (exactly 3 tools)

### data_query (`data_query.behavior.test.ts`)
- A3: query_data returns 5 rows → LLM returns JSON `{rows: [...], row_count: 5}`
- A4: query_data returns null → response has `failed: true, error: "..."` in JSON
- Extra: row ordering check, each row has expected fields

### code_execution (`code_execution.behavior.test.ts`)
- A3: openagentic_execute returns `{stdout: "55\n", exit_code: 0}` → LLM references output
- A4: openagentic_execute returns `exit_code: 1` → response references "unable to execute"
- Extra: bare code block without execution output fails schema (catches false success)

### summarization (`summarization.behavior.test.ts`)
- A3: long document in prompt → LLM returns 4-bullet summary shorter than input
- A4: empty input → response carries "Failed to summarize: unable to process..."
- Extra: documents the "polite non-summary" anti-pattern for A4

### validation (`validation.behavior.test.ts`)
- A3: web_search returns Wikipedia fact → LLM returns `{valid: true, reason: "..."}`
- A4: web_search returns empty results → `{valid: false, failed: true, error: "..."}`
- Extra: documents "passes without checking" anti-pattern, edge case shapes

---

## Follow-up Sprint: 14 Remaining Behavior Tests

The harness is in place. The following agents need behavior test files:

<!-- TODO(agent-test-coverage): add behavior test -->

| Agent | Priority | Suggested Tools to Mock | Notes |
|-------|----------|------------------------|-------|
| tool_orchestration | HIGH | web_search, openagentic_execute, query_data | Tests tool selection logic |
| planning | HIGH | — (no tools) | Tests step enumeration |
| synthesis | HIGH | — (no tools) | Tests combining inputs |
| artifact_creation | HIGH | generate_image, web_search | Needs generate_image mock |
| cloud_operations | HIGH | azure_list_resources, aws_describe_instances | Most complex; 20 modules |
| docs_assistant | MEDIUM | web_search, web_fetch | RAG/retrieval path |
| flows_agent | MEDIUM | — | Workflow execution path |
| oat_function_builder | MEDIUM | — | Function builder path |
| finops_analyst | MEDIUM | azure_cost_query, aws_cost_explorer | Persona; empty data failure |
| security_auditor | MEDIUM | — | Persona; IAM graph output |
| engineering_metrics | MEDIUM | — | Persona; DORA metrics |
| product_analyst | MEDIUM | — | Persona; OKR output |
| data_extraction | LOW | web_search, web_fetch | Extract from large responses |
| custom | LOW | any | Flexible; test via harness |

To add a behavior test for any of these: copy `reasoning.behavior.test.ts`,
update the `AgentFixture`, tool mocks, and LLM response fixtures. The harness
`runAgentBehaviorSuite()` handles the A3/A4 assertions automatically.

---

## Files

| File | Purpose |
|------|---------|
| `src/services/agents/__tests__/agentRegistry.static.test.ts` | 19-agent static config test (A1) |
| `src/services/agents/__tests__/agentBehavior.harness.ts` | Parameterized behavior test helper (A2, A3, A4) |
| `src/services/agents/__tests__/reasoning.behavior.test.ts` | Reasoning agent behavior tests |
| `src/services/agents/__tests__/data_query.behavior.test.ts` | Data query agent behavior tests |
| `src/services/agents/__tests__/code_execution.behavior.test.ts` | Code execution agent behavior tests |
| `src/services/agents/__tests__/summarization.behavior.test.ts` | Summarization agent behavior tests |
| `src/services/agents/__tests__/validation.behavior.test.ts` | Validation agent behavior tests |
| `docs/agent-registry-coverage.md` | This file |

---

## Known Gaps

1. **DB integration tests**: Static tests run against exported constants, not the DB.
   If seedDefaultLoops() has a bug, static tests won't catch it. Consider a
   DB-integration layer test (mark `db-sot`) using the existing prisma mock pattern.

2. **expected_output_schema in DB**: Schemas are currently test fixtures in the harness.
   The Prisma migration to add `expected_output_schema Json?` to the `Agent` model
   is deferred to avoid conflict with the concurrent tenant_id migration (20260425).

3. **Real tool call path**: A3/A4 tests mock at the LLM boundary, not at the
   SubagentOrchestrator boundary. Full integration tests via SubagentOrchestrator
   with injected mock LLM client exist for personas (SubagentOrchestrator.persona.test.ts)
   and should be extended for the remaining 14 agents.

4. **SEED_AGENTS vs DEFAULT_MODEL_CONFIGS divergence**: The admin SEED_AGENTS list
   (admin-agents.ts) contains only 12 of the 19 AgentTypes. The remaining 7 are
   boot-seeded via seedDefaultLoops(). There is no test that verifies the two lists
   stay in sync — add a cross-reference test if this divergence grows.
