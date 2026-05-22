# TUI vs CodeMode slash-command diff report

Run: 2026-05-02 (worktree `agent-a63ef9b36808929bc`)
TUI capture: `openagentic --ollama-host http://hal:11434 --permissive --model nemotron3:33b` driven via `pexpect` + `pyte`, fresh process per command, 50×160 PTY. Captures saved to `tui-vs-codemode-artifacts/tui-<cmd>.txt`.
CodeMode capture: existing `codemode-slash-battery-artifacts/<cmd>.png` from chat-dev battery (last run 2026-05-02).

The TUI is the SoT — these are the things to fix in CodeMode.

## Per-command diff

| Cmd | TUI (artifact) | CodeMode (artifact) | Diff (one-liner) | Severity | Fix target |
|---|---|---|---|---|---|
| /agents | `tui-agents.txt` — picker with **Plugin agents** + **Built-in agents** sections, "Create new agent" first row, count `6 agents` | `agents.png` — modal "Agents 3 available", missing the **Plugin** section (only Built-in shown), no "Create new agent" entry | [FIXED 2026-05-02] UI: section labels read "Plugin agents" / "Built-in agents (always available)", "Create new agent" first row, `<N> agents` count. **[FIXED 2026-05-02 15dde91] daemon side**: confirmed `_detail.agents` already preserves `source:'plugin'` for plugin-pack agents (e.g. `superpowers:code-reviewer`) — pinned with regression test in systemInit.test.ts so a future refactor can't strip the source discriminator. Live verified: `_detail.agents` on a fresh pod includes built-in + plugin agents with proper source field. | high | `RichModals.tsx` AgentsModal + daemon agent payload |
| /btw | `tui-btw.txt` — daemon prints `⎿  Usage: /btw` (slash result) | `btw.png` — palette popup `/btw <question>  Ask a quick side question…` with the `/btw` text in composer; no submission, no echo | autocomplete inserts and waits instead of submitting | high | `slashCommands.ts` (mark args optional) + `CodeModeChatView.handleSlashSelect` |
| /bug | `tui-bug.txt` — typeahead resolved to `/superpowers:systematic-debugging` (no `/bug` skill in v0.7.0); spinner | `bug.png` — `/bug` echoed, no output | [PIN 2026-05-02] dispatchSlashCommand falls through unknown slashes to the daemon as a chat prompt instead of dropping. Pinned in `CodeModeChatView.modalTrigger.test.tsx` ("/bug — unknown slash command falls through to the daemon as a prompt"). True typeahead/skill-autocomplete on /bug remains daemon-side work. | medium | daemon slash-dispatcher fallback OR friendly "no such command" |
| /config | `tui-config.txt` — full screen `Status / Config / Usage` tabbed picker with searchable settings list | `config.png` — RichModal "Configuration" with Session/Resources/Actions read-only rows | [FIXED 2026-05-02] ConfigModal rebuilt with Status/Config/Usage tabs + searchable settings list (Auto-compact, Show tips, Reduce motion, Thinking mode, Verbose output, Terminal progress, Show turn duration toggles + Theme/Notifications/Output style/Editor mode choice rows). localStorage-backed; daemon side-effects deferred. Pinned in `parity.tuiCommands.test.tsx`. | high | `RichModals.tsx` ConfigModal — add tabs + per-setting toggle rows |
| /context | `tui-context.txt` — visual block grid (200k token map) + per-category breakdown + MCP tool token list | `context.png` — **Error: slash /context failed: Right side of assignment cannot be destructured** | [FIXED 2026-05-02 942ced6] context-noninteractive.call() now defends against the headlessSlashDispatch stub-context shape (messages/getAppState/options.{mainLoopModel,tools,agentDefinitions} undefined) and returns a friendly "context inspection unavailable" markdown table instead of throwing past the dispatcher's catch. | high | `context-noninteractive.ts` |
| /cost | `tui-cost.txt` — multi-line aligned block (Total cost / API duration / wall / changes / usage) | `cost.png` — single-line inline text "Total cost: $0.0000  Total duration (API): 0s …" | format: codemode flattens to inline; TUI uses indented column block | low | `slash-dispatcher.ts` /cost output OR a CostMessage renderer |
| /doctor | `tui-doctor.txt` — **`Unknown skill: doctor`** (TUI v0.7.0 has no `/doctor`) | `doctor.png` — `/doctor` echoed, no output | TUI says "unknown" explicitly; codemode silently drops | low | drop /doctor from `slashCommands.ts` (not in v0.7.0) |
| /files | `tui-files.txt` — daemon spat `/update-config` then errored "Undefined cannot be represented in JSON Schema" — `/files` is also not a real v0.7.0 skill | `files.png` — `/files` echoed, no output | both are broken — TUI errors, codemode silent | low | drop from registry (not in v0.7.0) |
| /help | `tui-help.txt` — full structured page: `OpenAgentic v0.7.0  general  commands  custom-commands` tabs + Shortcuts grid | `help.png` — empty assistant turn after `/help` | codemode doesn't render anything for /help | high | api `slash-dispatcher.ts` /help OR CodeModeHelpRenderer |
| /hooks | `tui-hooks.txt` — picker "Hooks · 2 hooks configured" + 5 lifecycle rows | `hooks.png` — **Error: slash /hooks threw during call(): context.getAppState is not a function** | [FIXED 2026-05-02 d0e243a] headlessJsxSlashDispatch now wires a getAppState() shim that returns getDefaultAppState() (toolPermissionContext populated) and a setAppState no-op, unblocking /hooks + /agents + /add-dir + /fast + /commit-push-pr + /security-review + /advisor + /brief + /rename + /ultraplan in headless dispatch. | high | `headlessJsxSlashDispatch.ts` |
| /init | `tui-init.txt` — spinner "Rendering…" (would write OPENAGENTIC.md after thinking) | `init.png` — Write tool invocation that wrote OPENAGENTIC.md (via the LLM) | functionally equivalent — both produce OPENAGENTIC.md | accept | n/a |
| /mcp | `tui-mcp.txt` — picker "Manage MCP servers · 2 servers" listing each MCP w/ ✔ connected | `mcp.png` — RichModal "MCP Servers · 1 configured" (only Playwright) | [FIXED 2026-05-02 15dde91] buildSystemInitMessage._detail.mcp_servers now merges plugin-declared MCP servers (`inputs.plugins[].mcpServers`) into the live mcpClients list with status:'pending' for declared-but-not-yet-connected entries. De-duped by name so live + declared don't double-emit. aws-serverless will appear once its plugin pack is installed. | medium | `systemInit.ts` buildDetail |
| /memory | `tui-memory.txt` — picker "Memory · Auto-memory: on / Auto-dream: off" + 3 actions | `memory.png` — modal with **Project / User** tabs and a textarea | [FIXED 2026-05-02] MemoryModal now renders Auto-memory + Auto-dream ToggleRows above the project/user textarea. localStorage-backed (cm-auto-memory / cm-auto-dream); daemon-side enforcement deferred. Pinned in `parity.tuiCommands.test.tsx`. | medium | `CommandModals.tsx` MemoryModal — add auto-memory / auto-dream rows |
| /migrate-installer | `tui-migrate-installer.txt` — **`Unknown skill: migrate-installer`** | `migrate-installer.png` — `/migrate-installer` echoed, no output | not a real v0.7.0 skill | low | drop from registry |
| /model | `tui-model.txt` — `/model: fetch failed (HTTP 404)` (Ollama-only env) | `model.png` — RichModal "Models 1 available · current: gpt-oss-120b" listing 1 model | codemode shows admin-locked model list; TUI fails since no platform endpoint | accept | n/a (env-specific) |
| /output-style | `tui-output-style.txt` — `/output-style has been deprecated. Use /config…` | `output-style.png` — same string, inline | identical text content | match | n/a |
| /permissions | `tui-permissions.txt` — full picker `Recently denied / Allow / Ask / Deny / Workspace` tabs + Search | `permissions.png` — RichModal with bypassPermissions mode + Default/Permissive/Plan switch + 73 tool chips | [FIXED 2026-05-02] PermissionsModal now renders Recently denied / Allow / Ask / Deny / Workspace tab bar + search box + "Add a new rule…" row. Per-rule editor (split chips per tab) is daemon-driven and deferred until daemon ships rule-storage RPCs. Pinned in `parity.tuiCommands.test.tsx`. | medium | `RichModals.tsx` PermissionsModal — split tool chips into Allow/Ask/Deny tabs + add "Add new rule" row |
| /plan | `tui-plan.txt` — daemon prints `⎿  Enabled plan mode` + footer `⏸ plan mode on` | `plan.png` — small modal "/plan · Plan Mode" with toggle switch + explainer | both work; TUI is single-line confirm, codemode is interactive toggle (improvement) | accept | n/a |
| /pr-comments | `tui-pr-comments.txt` — spinner "Scaffolding…" (would scaffold a PR fetch flow) | `pr-comments.png` — LLM thinking + "I cannot fetch PR comments because this workspace is not a Git repository" | both functional; codemode goes via LLM, TUI via dedicated handler | low | n/a (env-specific) |
| /release-notes | `tui-release-notes.txt` — `⎿ See the full changelog at: https://github.com/agentic-work/openagentic/blob/main/CHANGELOG.md` | `release-notes.png` — same line, formatted as inline link | identical | match | n/a |
| /resume | `tui-resume.txt` — full-screen picker "Resume Session (1 of 50)" with search + last 12 sessions + Ctrl+A/B/V/R | `resume.png` — small modal "/resume · No sessions yet" | [FIXED 2026-05-02 ecb590a] daemon `list_sessions` RPC was already wired (handler at daemonRequestHandlers.ts:853 + entry in HANDLERS table); ResumeModal already calls it. Empty result on a fresh pod is correct behavior — pin the wire-shape contract with 5 dispatcher tests so a future refactor can't silently regress the empty-state path. | high | `daemonRequestHandlers.ts` list_sessions (already shipped) |
| /skills | `tui-skills.txt` — picker "Skills · 22 skills" with **User skills** + **Plugin skills** sections, token-cost annotations | `skills.png` — modal "Skills · 17 available" flat alphabetical | [FIXED 2026-05-02] UI: SkillsModal renders "~<N> description tokens" when SkillDetail.tokenCost present. **[FIXED 2026-05-02 15dde91] daemon side**: list_skills now emits `source: cmd.source` (SettingSource: userSettings/projectSettings/policySettings/plugin/bundled) instead of the bare 'skills' bucket — UI's SOURCE_LABELS lookup now lights up correctly. Also populates `tokenCost: estimateSkillFrontmatterTokens(cmd)` per row, and mirrors tokenCost in `_detail.skills` for the system_init payload via an inline 4-chars-per-token estimator. | medium | `daemonRequestHandlers.ts` listSkills + `systemInit.ts` buildDetail |
| /status | `tui-status.txt` — `Status / Config / Usage` tabs picker (same as /config), Status tab shows Version/Session ID/cwd/Auth/MCP/Setting sources | `status.png` — empty assistant turn after `/status` | codemode doesn't render anything for /status | high | api `slash-dispatcher.ts` /status OR a StatusModal client trigger (StatusModal already exists, just unwired) |
| /theme | `tui-theme.txt` — picker "Theme" with 6 modes + diff preview window | `theme.png` — modal "/theme · Choose a CodeMode color theme" with 7 themes | shape close; TUI shows live diff preview, codemode just labels | low | `ThemePicker.tsx` — optional preview pane |
| /tools | `tui-tools.txt` — daemon prints "openagentic — 56 tools available" + Usage hints + grouped tool list (READ-ONLY / SHELL / EDIT / WEB / DISPATCH / VERIFICATION) | `tools.png` — palette popup `/tools [<tool> <key> <value>] List tools and per-tool config` (no submission) | autocomplete waits for args instead of submitting bare /tools | high | `slashCommands.ts` — make /tools args optional (picker pattern) |
| /upgrade | `tui-upgrade.txt` — **`Unknown skill: upgrade`** | `upgrade.png` — `/upgrade` echoed, no output | not in v0.7.0 | low | drop from registry |
| /version | `tui-version.txt` — same `Status / Config / Usage` picker as /status (Status tab) | `version.png` — small modal "/version · OpenAgentic 0.7.0 · Model · Permission Mode · Session · Platform" | shape close — codemode is more compact, TUI is full-screen | low | n/a (codemode form is acceptable) |

## Severity tally

- **High** (totally different / broken): 9 — agents, btw, config, context, help, hooks, resume, status, tools
- **Medium** (close but wrong data / missing sections): 5 — bug, mcp, memory, permissions, skills
- **Low** (cosmetic or v0.7.0-not-a-real-cmd): 9 — cost, doctor, files, migrate-installer, output-style, plan, pr-comments, release-notes, theme, version, upgrade
- **Accept** (env-specific or behavior parity): 3 — init, model, plan, pr-comments

## Fix priority order (smallest blast radius first)

1. **/btw and /tools args-optional** — `slashCommands.ts`: drop `args` field on /btw (it's optional) and /tools (picker semantics) so the palette submits on Enter instead of inserting+waiting. Pure config edit, ~2 LOC. **HIGH×2 → trivially fixable**
2. **Drop non-v0.7.0 commands from registry** — `slashCommands.ts`: remove or hide /doctor, /upgrade, /migrate-installer, /files. ~4 LOC. **LOW×4 → trivially fixable**
3. **/help wire-up** — `CodeModeChatView.dispatchSlashCommand`: /help currently `return false` (falls through to daemon, daemon emits nothing). Add a system message dump like /shortcuts does, OR fix the daemon side to emit canonical command list. **HIGH**
4. **/status wire-up** — same pattern as /help. The StatusModal component already exists in `chat-messages/StatusModal.tsx` — just trigger `setOpenModal('status')`. **HIGH**
5. **/context daemon crash** — out of scope for ui-only fix; track for api repo
6. **/hooks daemon crash** — same, api repo
7. **Config / Permissions / Resume / Skills modal data fidelity** — needs daemon-side payload changes, deferred for follow-up

Out-of-scope for this pass (api / daemon side):
- /context destructure error — [FIXED 2026-05-02 942ced6]
- /hooks getAppState — [FIXED 2026-05-02 d0e243a]
- /agents plugin-agents payload — [VERIFIED 2026-05-02 15dde91] (already correct, pinned)
- /mcp aws-serverless missing — [FIXED 2026-05-02 15dde91]
- /resume session list — [VERIFIED 2026-05-02 ecb590a] (already wired, pinned)
- /skills source grouping — [FIXED 2026-05-02 15dde91]
- /skills tokenCost — [FIXED 2026-05-02 15dde91]

Daemon build manifest: openagentic-exec 0.7.0-19e5a7cc, image
`harbor.openagentic.io/openagentic/openagentic-exec@sha256:281abece6c452e2d7ae9b01c7fc6f8c78f599a18ad64d0872693a9208487878e`,
openagentic-code-manager rolled 2026-05-02 (deployment/openagentic-code-manager).
Live spec re-run: 5/5 passing. Live `system_init._detail` verified on fresh pod:
skills carry `source: bundled/userSettings/...` + numeric `tokenCost`,
agents preserve `source: built-in/plugin/userSettings`, mcp_servers
include declared-but-unconnected entries with status `pending`.

