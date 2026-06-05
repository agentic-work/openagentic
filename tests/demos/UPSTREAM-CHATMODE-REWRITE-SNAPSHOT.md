# Upstream Chatmode-Rewrite → OSS Port List (snapshot + monitoring baseline)

**Upstream HEAD (baseline for this snapshot):** `20e59f2c7` — `feat(control-plane): #1306 — C1: universal AuthorizationSpine + Governor + audit (the ATO core, F1/F3/F4/F6)`
**Upstream HEAD (actual at scan time):** `7e51ba6ea` — `feat(control-plane): #1307 — C2 SessionVault + MinioStsBroker; fix C0 core/core nesting + hidden-test defect` (one commit ahead of the inventory baseline; the inventory's "UNCOMMITTED WIP" has since landed as #1307)
**Scan date:** 2026-06-05
**Status:** REWRITE IN PROGRESS — ~136 WIP files across two parallel strangler-fig cores, both flag-gated (default OFF) with **zero production behavior change** until their flags flip. Provisional until the P1..P6 / C2..C5 phases commit.

**Driving issues:**
- **#1137** — streaming-core "rip": collapse the dual content-block reducers onto one SDK canonical reducer (one wire, one reducer, one persist/render shape, one renderer).
- **#1305 (C0)** — AwTool core: one tool primitive + `runToolUse` dispatch + `AwToolRegistry` + one `CapabilityClassifier`, behind `CONTROL_PLANE_DISPATCH` (default false).
- **#1306 (C1)** — control-plane / ATO: universal `AuthorizationSpine` + per-chain `Governor` budget + headless `FlowApprovalGrant` + audit, behind `CONTROL_PLANE_AUTHZ` (default false). (#1307 C2 extends it with the session-cred vault.)

> Path note: upstream paths use `services/agenticwork-*`; OSS targets below apply the sync rename (`agenticwork-api → openagentic-api`, `agenticwork-ui → openagentic-ui`, `agent-proxy → openagentic-proxy`). The inventory abbreviated a few UI test paths as `components/Chat/__tests__/...`; the real upstream paths are `src/features/chat/__tests__/...` and `src/__tests__/architecture/...` (corrected below).

---

## 1. What changed upstream (grouped by domain)

### streaming-core (#1137)
| File (upstream) | new/mod | What |
|---|---|---|
| `docs/architecture/streaming-core.md` | new | Design-of-record: two content-block reducers run in parallel, arbitrated by ARRAY LENGTH with a different rule at each of 3 render moments (LIVE `canonical>0`, SETTLED `canonical>=legacy`, RELOAD persisted-else-reconstruct) → live≠settled≠reload. §6.1 keystone gap = `applyRoundFrame` tool_round fold must move into the SDK reducer. |
| `docs/architecture/streaming-core-architecture.html` | new | HTML render of the same design-of-record. |
| `docs/architecture/streaming-core-diagrams.md` | new | wire→reducer→state→render→persist→reload data-flow + accumulator diagrams. |
| `services/agenticwork-ui/src/features/chat/__tests__/streaming-parity.harness.test.tsx` | new | P0 permanent ship-gate: feeds one canonical wire through all 3 render moments, asserts byte-equal DOM. RED today (no SDK tool_round fold). |
| `services/agenticwork-ui/src/features/chat/__tests__/fixtures/canonical-turn.wire.ts` | new | The fixed canonical NDJSON wire capture the parity harness replays. |
| `services/agenticwork-ui/src/__tests__/architecture/no-new-dual-state-writers.source-regression.test.ts` | new | Arch cage (4/4 pass): pins dual-state baselines (`setContentBlocks=43`, `contentBlocksRef.current=36`, second-source-selects=3) as a one-way down-only ratchet; FAILS on any new dual-state writer. |
| `services/agenticwork-ui/src/features/chat/__tests__/no-dual-state.source-regression.test.ts` | modified | 1-line `describe.skip→describe` un-skip; now RUNS and is RED — enumerates the 43 `setContentBlocks` writers + 2 disagreeing source-selection rules. |

### chatmode-pipeline (#1306 wiring into the live pipeline)
| File (upstream) | new/mod | What |
|---|---|---|
| `services/agenticwork-api/src/pipeline/built-in-hooks.ts` | modified | C1a — chat permission hook delegates to `AuthorizationSpine` when `controlPlaneAuthz` is true; OFF → calls `PermissionService` directly (zero behavior change). |

### tool-core (AwTool / dispatch / registry) (#1305, now flattened by #1307)
| File (upstream) | new/mod | What |
|---|---|---|
| `services/agenticwork-api/src/core/tool.ts` | moved | `AwTool` — the single tool primitive; 16 first-party tools wrap to it, ~270 MCP tools adapt via catch-all; `buildTool()` fail-closed; `capabilityClass` UNSET (classifier decides). |
| `services/agenticwork-api/src/core/dispatch.ts` | moved | `runToolUse` — unified dispatcher; replaces legacy 16-arm switch ONLY when `controlPlaneDispatch=true`; pins the corpus-proven gate order (authorize is STEP 4, #850/#871 before the gate). |
| `services/agenticwork-api/src/core/registry.ts` | moved | `AwToolRegistry` — fail-closed name→AwTool resolver: exact first-party → first-party alias → MCP catch-all (last). |
| `services/agenticwork-api/src/core/chatTools.ts` | moved | Wraps the 16 first-party chat tools as AwTools; delegates to the SAME `dispatchChatToolCall` (byte-identical), only adds authoritative first-party `capabilityClass`. |
| `services/agenticwork-api/src/core/concurrency/concurrencySafeMigration.ts` | moved | F17 parity map: migrates the hand-set concurrency-safe set to per-tool `isConcurrencySafe`; parity test asserts new set === old. |
| `services/agenticwork-api/src/core/__tests__/dispatch.gateOrder.test.ts` | moved | Pins authorize at STEP 4 not step 1, #850/#871 before the gate. |
| `services/agenticwork-api/src/core/__tests__/dispatch.corpusReplay.test.ts` | moved | Replays 9 live-captured gpt-oss:20b fixtures byte-identical against `runToolUse` (the F9 oracle). |
| `services/agenticwork-api/src/core/__tests__/registry.test.ts` | moved | Resolution-order tests: exact→alias→MCP-catch-all-last; alias/first-party collision throws. |
| `services/agenticwork-api/src/core/__tests__/tool.buildTool.test.ts` | moved | `buildTool` fail-closed-defaults tests. |
| `services/agenticwork-api/src/core/__tests__/concurrencySafeMigration.parity.test.ts` | moved | Proves new `isConcurrencySafe` verdict set === old hand-maintained set. |
| `reports/controlplane-C0/corpus/wrappedDispatch/` | new | The 9-fixture characterization corpus (ndjson + oracle + gatetrace + tally). |

### classify (#1305 / #1306)
| File (upstream) | new/mod | What |
|---|---|---|
| `services/agenticwork-api/src/core/classify/CapabilityClassifier.ts` | moved | The ONE named lexical classifier (F4) — consolidates the two drifted classifiers; `read\|write\|destructive\|new_connection\|new_synth_tool\|os_job`; unknown → fail-closed `write`; owns the curated parallel-read allowlist. NO regex. |
| `services/agenticwork-api/src/core/__tests__/CapabilityClassifier.parity.test.ts` | moved | Asserts the single classifier matches both retired classifiers' verdicts. |
| `services/agent-proxy/src/services/SecurityAnalyzer.ts` | modified | Regex risk-tier classifier DELETED; `assess()` now derives from the vendored shared `capabilityClassifier` (pinned by a 32-row parity test). |
| `services/agent-proxy/src/services/capabilityClassifier.ts` | new | Vendored lock-step copy of the api classifier carried in the agent-proxy image (81-row parity test). |

### authz / control-plane / ATO (#1306 C1, #1307 C2)
| File (upstream) | new/mod | What |
|---|---|---|
| `docs/architecture/chatmode-control-plane-v2.md` | new | Red-team-hardened control-plane design-of-record ("GO for C0"). |
| `docs/architecture/control-plane-redteam.md` | new | Pre-C0 red-team — source of the F-numbered findings (F1/F3/F4/F5/F6/F8/F9/F19). |
| `services/agenticwork-api/src/core/authz/AuthorizationSpine.ts` | new | The ONE universal authorization choke point (F1/F6); wraps `PermissionService`, takes the STRICTER of (approval matrix, cascade); 10-step body; behind `CONTROL_PLANE_AUTHZ`. 663 lines. |
| `services/agenticwork-api/src/core/authz/authz-rules.ts` | modified | Shared PURE rule source, vendored across api + agent-proxy (kills F4 drift); `APPROVAL_MATRIX` + `stricter()` + `evaluateLocal()`; retires `SecurityAnalyzer.assess()`. |
| `services/agenticwork-api/src/core/authz/Governor.ts` | new | Per-chain aggregate budget ceiling (F3); Redis HASH at `sess:<id>:chain:<chainId>`; `check()` before every dispatch; breach → `budget_exceeded` terminal; fail-OPEN on Redis hiccup. 567 lines. |
| `services/agenticwork-api/src/core/authz/FlowApprovalGrant.ts` | new | Headless-flow pre-resolved approval (F1); `grantCovers` fail-closes on missing/identity/FlowDef-hash/expiry/class mismatch. |
| `services/agenticwork-api/src/core/authz/flowAuthorizeHook.ts` | new | `buildFlowAuthorizeHook` wires the flow engine's `ctx.authorizeNodeAction` to the spine; returns undefined when flag off (engine attaches no hook). |
| `services/agenticwork-api/src/services/PermissionService.ts` | modified | Adds NON-BLOCKING `classifyName(toolName)` (rule resolution + #790 read-only kill-switch WITHOUT the HITL round-trip) — the seam the spine reads the cascade through. |
| `services/agenticwork-api/src/services/AuditLogger.ts` | modified | Adds `logCapabilityDecision` writing the append-only AU-9 hash-chained `admin_audit_log` row INSIDE the spine (F6). |
| `services/agenticwork-api/src/services/WorkflowExecutionEngine.ts` | modified | Wires `buildFlowAuthorizeHook` as `NodeExecutionContext.authorizeNodeAction` (flag off → undefined). |
| `services/shared/workflow-engine/src/nodes/types.ts` | modified | New `NodeExecutionContext.authorizeNodeAction` hook (the gate seam every write-capable node crosses). |
| `services/shared/workflow-engine/src/nodes/mcp_tool/executor.ts` | modified | **F1 keystone** — mcp_tool executor now calls `ctx.authorizeNodeAction` BEFORE the mcp-proxy `/call` POST; non-approved verdict THROWS. |
| `services/agenticwork-api/src/core/session/SessionVault.ts` | new (#1307) | Redis-backed session-only brokered-credential vault (replaces in-memory `CredentialBroker` Map / F19-H3); strict owner+session binding, `revokeAll`, HITL `promote()`; behind `SESSION_VAULT_CRED_INJECTION`. 474 lines. |
| `services/agenticwork-api/src/core/session/SessionNamespace.ts` | new (#1307) | The ONE builder of `sess:<id>:*` Redis keys; sanitizes id/capability segments (no regex). |
| `services/agenticwork-api/src/core/storage/MinioStsBroker.ts` | new (#1307) | Per-user PREFIX-SCOPED (`workspaces/<userId>/*`) time-bounded MinIO STS creds via AssumeRole + inline session policy; replaces the shared MinIO master key baked into every exec pod (F5 / AC-4). 428 lines. |
| `.../core/session/__tests__/SessionVault.isolation.test.ts` | new (#1307) | Cross-session/cross-owner isolation + central revoke + promote proofs. |
| `.../core/storage/__tests__/MinioStsBroker.test.ts` + `MinioStsBroker.flagOff.test.ts` | new (#1307) | Inline STS policy byte-for-intent + Allow/Deny simulation + flag-off. |

### featureFlags
| File (upstream) | new/mod | What |
|---|---|---|
| `services/agenticwork-api/src/config/featureFlags.ts` | modified | `controlPlaneDispatch` + `controlPlaneAuthz` (both default FALSE) — the C0/C1 strangler-fig flags; #1307 adds `sessionVaultCredInjection` (default FALSE) — the C2/C5 cred gate. |

---

## 2. The to-OSS table (every chatmode-pipeline / core change)

Decision basis: the SKIP list (Code Mode, paywall/upsell/402, enterprise admin routes, `docs/`, the control-plane/ATO surface) vs the PORT need (chatmode-core / streaming OSS actually consumes). `services/openagentic-api/src/services/approval/` and `.../services/audit/` are PRESERVE_PREFIXES — the OSS trust seam with no enterprise upstream equivalent.

> **Standing divergence (read first):** OSS already has its OWN streaming-core hardening lineage in `services/openagentic-ui/src/features/chat/__tests__/` (`no-dual-state`, `single-renderer`, `no-streamEngine`, `no-legacy-content-types`, `wire-emit-completeness`, `useChatStream.no-tier-state`). Crucially the OSS `no-dual-state.source-regression.test.ts` checks for `assistantMessage`/`currentMessage` dual-state — a DIFFERENT (and earlier) diagnosis than upstream #1137's `setContentBlocks=43`-writer enumeration. OSS also already ships the pure-reducer `useChatStream.ts` engine (ported wholesale in a prior chat-subsystem sync). So the streaming rows below are about reconciling two parallel lineages, not a clean graft.

| upstream path | OSS target path | PORT / SKIP / WATCH | reason | diverges-from-OSS-current? | risk / deps |
|---|---|---|---|---|---|
| `docs/architecture/streaming-core.md` | `docs/architecture/streaming-core.md` | **SKIP** | `docs/` is a SKIP_PREFIX — design docs never sync. Read as reference only. | yes — OSS has no equivalent design doc | none (informational) |
| `docs/architecture/streaming-core-architecture.html` | — | **SKIP** | `docs/` SKIP_PREFIX. | n/a | none |
| `docs/architecture/streaming-core-diagrams.md` | — | **SKIP** | `docs/` SKIP_PREFIX. | n/a | none |
| `docs/architecture/chatmode-control-plane-v2.md` | — | **SKIP** | `docs/` SKIP_PREFIX + control-plane design (enterprise ATO). | n/a | none |
| `docs/architecture/control-plane-redteam.md` | — | **SKIP** | `docs/` SKIP_PREFIX. | n/a | none |
| `.../ui/src/features/chat/__tests__/streaming-parity.harness.test.tsx` | `services/openagentic-ui/src/features/chat/__tests__/streaming-parity.harness.test.tsx` | **WATCH→PORT** | Genuine chatmode-streaming OSS need (byte-equal across live/settled/reload). But RED-by-construction today and tied to upstream's `applyCanonicalFrame` tool_round fold which OSS does not yet have. Port only AFTER the rip lands + the fixture wire matches OSS's reducer. | yes — OSS lacks this harness; OSS reducer may not produce upstream's frames | M — needs the SDK reducer + fixture wire to match OSS shapes |
| `.../ui/src/features/chat/__tests__/fixtures/canonical-turn.wire.ts` | `services/openagentic-ui/src/features/chat/__tests__/fixtures/canonical-turn.wire.ts` | **WATCH** | Fixture for the above; useless without the harness + matching reducer. | yes | S — but couples to harness |
| `.../ui/src/__tests__/architecture/no-new-dual-state-writers.source-regression.test.ts` | `services/openagentic-ui/src/__tests__/architecture/no-new-dual-state-writers.source-regression.test.ts` | **WATCH (likely SKIP)** | The 43/36/3 baselines are counts of upstream's source; OSS's chat source diverged (already collapsed via its own `single-renderer`/`no-streamEngine` cages), so the numbers won't transfer. Re-derive an OSS-native ratchet instead of porting verbatim. | yes — different source counts | S to adapt / L if forcing upstream baselines |
| `.../ui/src/features/chat/__tests__/no-dual-state.source-regression.test.ts` | `services/openagentic-ui/src/features/chat/__tests__/no-dual-state.source-regression.test.ts` (EXISTS) | **SKIP (keep OSS version)** | OSS already has a file at this exact path checking a DIFFERENT dual-state (`assistantMessage`/`currentMessage`). Do NOT overwrite — the upstream un-skip enumerates upstream-only `setContentBlocks` writers OSS doesn't have. | yes — same path, different test body | HIGH if blindly synced (clobbers the OSS cage) |
| `.../api/src/core/tool.ts` | `services/openagentic-api/src/core/tool.ts` (no `src/core/` in OSS today) | **PORT** | Chatmode tool-core; `AwTool` would supplant the hand-written `toolRegistry.ts` T1 array. ADDITIVE/flag-gated, no live importers until `controlPlaneDispatch` flips. | yes — OSS has NO `src/core/` and no AwTool | M — new dir; must keep flag default false |
| `.../api/src/core/dispatch.ts` | `services/openagentic-api/src/core/dispatch.ts` | **PORT** | `runToolUse` is the registry-driven replacement for OSS's `dispatchChatToolCall.ts` name switch; preserves gate order. | yes — OSS dispatch is a hand switch | M — must reconcile with OSS `dispatchTool.ts` `runAuditAndGate` seam |
| `.../api/src/core/registry.ts` | `services/openagentic-api/src/core/registry.ts` | **PORT** | `AwToolRegistry` resolves the OSS T1+MCP catalog; fail-closed resolution OSS lacks. | yes | S–M |
| `.../api/src/core/classify/CapabilityClassifier.ts` | `services/openagentic-api/src/core/classify/CapabilityClassifier.ts` | **PORT** | The ONE classifier consolidates OSS's classify logic; OSS today classifies via `PermissionService` + `services/approval/classifyTool.ts`. Reconcile with the PRESERVE'd `approval/classifyTool.ts`. | yes — OSS uses approval/classifyTool.ts | M — must not double-classify; align with approval seam |
| `.../api/src/core/chatTools.ts` | `services/openagentic-api/src/core/chatTools.ts` | **PORT** | Wraps OSS's 16 first-party tools to AwTool; delegates to the SAME dispatch (byte-identical). | yes | S — thin wrapper |
| `.../api/src/core/concurrency/concurrencySafeMigration.ts` | `services/openagentic-api/src/core/concurrency/concurrencySafeMigration.ts` | **PORT** | F17 parity; OSS already has `computeConcurrencySafeNames` in `toolRegistry.ts` — this is the migration target. | yes — OSS has the legacy function | S–M (parity test must hold) |
| `.../api/src/core/__tests__/*.test.ts` (dispatch.gateOrder, dispatch.corpusReplay, registry, tool.buildTool, concurrencySafeMigration.parity, CapabilityClassifier.parity) | `services/openagentic-api/src/core/__tests__/*` | **PORT (with the core)** | The behavior-neutral oracles that make the core safe to land. Port alongside their subjects. | yes | M — corpus fixtures (gpt-oss:20b) must replay in OSS |
| `reports/controlplane-C0/corpus/wrappedDispatch/` | `reports/controlplane-C0/corpus/wrappedDispatch/` | **WATCH** | Characterization corpus; `reports/` is not skipped but is upstream porcelain. Port only if the corpusReplay test is ported. | yes | S |
| `.../agent-proxy/src/services/SecurityAnalyzer.ts` | `services/openagentic-proxy/src/services/SecurityAnalyzer.ts` (EXISTS) | **WATCH** | OSS has its own `SecurityAnalyzer.ts`. Upstream DELETES the regex classifier in favor of the vendored shared one — that delete is part of the ATO core. Defer until the classifier is ported; don't blind-sync. | yes — OSS still has the regex version | M — coupled to CapabilityClassifier port |
| `.../agent-proxy/src/services/capabilityClassifier.ts` | `services/openagentic-proxy/src/services/capabilityClassifier.ts` | **PORT (with classifier)** | Vendored lock-step copy; only meaningful once the api classifier lands. | yes — OSS lacks it | S |
| `.../api/src/core/authz/AuthorizationSpine.ts` | `services/openagentic-api/src/core/authz/AuthorizationSpine.ts` | **SKIP** | Control-plane/ATO (OBO-token deny, approval matrix, Governor, FlowApprovalGrant, AU-9 hash-chained audit) — enterprise governance surface, not the OSS chatmode core. OSS gates mutating tools via the PRESERVE'd `services/approval/` seam instead. | yes — OSS uses approval/auditAndGate.ts | HIGH if ported (pulls in Redis chain budget + KMS + STS) |
| `.../api/src/core/authz/authz-rules.ts` | `services/openagentic-api/src/core/authz/authz-rules.ts` | **SKIP** | Part of the ATO spine; the OSS equivalent is `services/approval/approvalGatePolicy.ts` (PRESERVE). | yes | HIGH |
| `.../api/src/core/authz/Governor.ts` | — | **SKIP** | Per-chain Redis budget ceiling = enterprise spend governance (F3); no OSS need. | yes — OSS has no chain budget | HIGH (Redis + cost model) |
| `.../api/src/core/authz/FlowApprovalGrant.ts` | — | **SKIP** | Headless signed-grant flow approval — enterprise ATO. | yes | HIGH |
| `.../api/src/core/authz/flowAuthorizeHook.ts` | — | **SKIP** | Wires the spine into the flow engine; spine is SKIP. | yes | HIGH |
| `.../api/src/pipeline/built-in-hooks.ts` | `services/openagentic-api/src/pipeline/built-in-hooks.ts` (PRESERVE) | **SKIP (keep OSS)** | This file is in the PRESERVE list (the OSS approval-gate seam). Upstream's edit delegates to the spine (SKIP). Never overwrite. | yes — OSS hook calls the approval gate | HIGH if synced (clobbers PRESERVE) |
| `.../api/src/services/PermissionService.ts` | `services/openagentic-api/src/services/PermissionService.ts` | **WATCH** | Upstream adds non-blocking `classifyName` purely to feed the spine. Harmless on its own, but pointless without the spine. Port only if it doesn't conflict with the OSS approval seam. | possibly | S–M |
| `.../api/src/services/AuditLogger.ts` | `services/openagentic-api/src/services/AuditLogger.ts` | **SKIP** | `logCapabilityDecision` writes the spine's AU-9 row — ATO audit. OSS audits via the PRESERVE'd `services/audit/` + `services/approval/auditAndGate.ts`. | yes | M |
| `.../api/src/services/WorkflowExecutionEngine.ts` | `services/openagentic-api/src/services/WorkflowExecutionEngine.ts` (PRESERVE) | **SKIP (keep OSS)** | PRESERVE'd boot/infra fix. Upstream edit wires the spine hook (SKIP). | yes | HIGH if synced |
| `.../shared/workflow-engine/src/nodes/types.ts` | `services/shared/workflow-engine/src/nodes/types.ts` | **WATCH** | Adds `authorizeNodeAction` hook to the node context type. Type-only + optional; harmless to carry, but only meaningful with the spine. Sync only if it doesn't break the OSS engine build. | maybe | S |
| `.../shared/workflow-engine/src/nodes/mcp_tool/executor.ts` | `services/shared/workflow-engine/src/nodes/mcp_tool/executor.ts` | **WATCH** | F1 keystone — gates the mcp_tool node before the proxy POST. OSS flows currently POST straight through; a gate would be a genuine OSS hardening, BUT it depends on the SKIP'd spine. Port only an OSS-native gate (via the approval seam), not the spine wiring. | yes — OSS node has no gate | M — don't import the spine |
| `.../api/src/core/session/SessionVault.ts` | — | **SKIP** | C2 brokered-credential vault — codemode/exec-pod cred isolation; Code Mode is removed from OSS (no exec pods). | yes | HIGH (Redis + KMS) |
| `.../api/src/core/session/SessionNamespace.ts` | — | **SKIP** | Supports SessionVault (SKIP). | yes | n/a |
| `.../api/src/core/storage/MinioStsBroker.ts` | — | **SKIP** | Per-user MinIO STS for exec pods — Code Mode storage isolation; not in OSS. | yes | HIGH |
| `.../api/src/core/session/__tests__/*`, `.../core/storage/__tests__/*` | — | **SKIP** | Tests for SKIP'd C2 surface. | yes | n/a |
| `.../api/src/config/featureFlags.ts` | `services/openagentic-api/src/config/featureFlags.ts` | **WATCH** | OSS has this file. The flags (`controlPlaneDispatch`/`controlPlaneAuthz`/`sessionVaultCredInjection`) are only needed for the surfaces ported. Add ONLY the flags whose code lands in OSS (i.e. dispatch flag if the AwTool core ports; NOT the authz/session flags). | yes — OSS flags differ | S — selective merge, keep defaults false |

---

## 3. Big-ticket items

### A. The streaming-core rip (#1137) — port effort: **L (and partly already done a different way)**
What it means for OSS: a provable single-state stream — `reload(persist(reduce(wire))) === reduce(wire)` — killing the live≠settled≠reload class of bugs. **But OSS already attacked this independently:** OSS ships the pure-reducer `useChatStream.ts` and a set of source-regression cages (`single-renderer`, `no-streamEngine`, `no-legacy-content-types`, `no-dual-state` on `assistantMessage`/`currentMessage`). Upstream's #1137 is a *more advanced, differently-framed* diagnosis (the `setContentBlocks=43` / array-length-arbitration model + the §6.1 tool_round-fold keystone). The work here is **reconciliation, not graft**: do NOT overwrite the OSS `no-dual-state` test (same path, different body); decide whether OSS's reducer needs the `applyRoundFrame` tool_round fold; and if you adopt the parity harness, re-record `canonical-turn.wire.ts` against the OSS reducer and re-derive the ratchet baselines OSS-native. The P1..P6 phases are still landing upstream, so treat as provisional.

### B. The AwTool dispatch/registry/governor core (#1305 C0) — port effort: **M (core) + SKIP (governor)**
What it means for OSS: replaces the hand-written T1 array (`toolRegistry.ts`) + name switch (`dispatchChatToolCall.ts`) + the chatLoop discovery side-channel with one tool primitive (`AwTool`), one registry-driven dispatcher (`runToolUse`), and a fail-closed resolution order — gating it all behind `controlPlaneDispatch` (default false, additive). This is a clean OSS win and exactly the layer OSS lacks (`grep` confirms no `src/core/` and no AwTool today). **Caveat:** the *Governor* (per-chain Redis budget ceiling, F3) and the whole `authz/` subtree are ATO/enterprise spend-governance — those are SKIP. Port the tool primitive + dispatch + registry + classifier + their parity tests; leave `Governor.ts` / `AuthorizationSpine.ts` / `FlowApprovalGrant.ts` upstream. Reconcile `CapabilityClassifier` with the PRESERVE'd `services/approval/classifyTool.ts` so OSS doesn't end up with two classifiers.

### C. The CapabilityClassifier (#1305 F4) — port effort: **S–M**
What it means for OSS: one named lexical classifier (`read|write|destructive|new_connection|new_synth_tool|os_job`, unknown → fail-closed `write`, no regex) consolidating the two drifted classifiers, vendored lock-step into the proxy. For OSS this is a real correctness/maintainability win (the model can't self-declare `read` to dodge the gate on the ~270 MCP tools). **The OSS-specific work** is that OSS already classifies via `PermissionService` + `services/approval/classifyTool.ts` (PRESERVE) — the port must make `CapabilityClassifier` the single source and have the approval seam read through it, not stack a second classifier. The proxy-side `SecurityAnalyzer.ts` delete + vendored copy follow once the api classifier lands.

---

## 4. Monitoring note

**Baseline recorded: upstream HEAD `20e59f2c7` (#1306 C1)** — this snapshot's reference point. Actual HEAD at scan time was `7e51ba6ea` (#1307 C2); the inventory's "uncommitted WIP" (SessionVault / MinioStsBroker / `core/core → core` flatten) has since committed as #1307 and is folded into the rows above.

A future re-run should diff **`20e59f2c7..<new HEAD>`** in `~/agenticwork/agentic` (or `7e51ba6ea..<new HEAD>` to skip C2, which is SKIP for OSS anyway) and re-classify any new files under `services/agenticwork-{api,ui}/src/core/`, `.../features/chat/`, `services/shared/workflow-engine/`, and `services/agent-proxy/src/services/` through the RENAMES → SKIP → PRESERVE → port classification.

The rewrite is **mid-flight**: #1137 ships only P0 test-infra + the arch cage so far (P1..P6 collapse the legacy switch onto the SDK reducer); #1305/#1306/#1307 are all flag-gated strangler-figs (`controlPlaneDispatch` / `controlPlaneAuthz` / `sessionVaultCredInjection`, all default FALSE) with zero production behavior change until their flags flip. **This list is therefore provisional** — PORT/WATCH/SKIP verdicts (especially the streaming reconciliation and the AwTool↔OSS-approval-seam alignment) should be re-confirmed once the upstream phases actually commit and the OSS `src/core/` graft is attempted against a real build.
