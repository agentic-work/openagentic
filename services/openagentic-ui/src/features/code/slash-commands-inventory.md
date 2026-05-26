# Slash Commands Inventory

**Last updated:** 2026-04-11 | **Total commands:** 85+ | **Format:** Compact inventory for React DOM port

---

## Priority 0 (Essential)

| Name | File | Description | UI | Blocking | Notes |
|------|------|-------------|----|---------:|-------|
| /clear | clear/index.ts | Clear conversation history and free up context | none | true | Aliases: reset, new. Supports compact mode. |
| /compact | compact/index.ts | Clear history but keep summary in context | none | true | Supports custom summarization args. Optional args. |
| /config | config/index.ts | Open config panel (theme, model, effort, etc.) | modal | true | Alias: settings. Multi-tab Settings component. |
| /context | context/index.ts | Visualize current context usage as colored grid | custom | false | Interactive/non-interactive variants. |
| /cost | cost/index.ts | Show session cost and duration | none | false | Hidden for subscribers unless internal user. |
| /exit | exit/index.ts | Exit the REPL | none | true | Alias: quit. Immediate. |
| /help | help/index.ts | Show help and available commands | none | false | Immediate. |
| /model | model/index.ts | Set AI model for OpenAgentic | picker | true | Dynamic description showing current model. |
| /permissions | permissions/index.ts | Manage allow & deny tool permission rules | form | true | Alias: allowed-tools. PermissionRuleList component. |
| /theme | theme/index.ts | Change the theme | picker | true | Dark/light picker. Supports direct-set via args. |

## Priority 1 (Common)

| Name | File | Description | UI | Blocking | Notes |
|------|------|-------------|----|---------:|-------|
| /agents | agents/index.ts | Manage agent configurations | custom | true | AgentsMenu component. Loads all available agents. |
| /btw | btw/index.ts | Ask quick side question without interrupting | none | true | Immediate. Requires question arg. |
| /login | login/index.ts | Sign in / switch OpenAgentic accounts | form | true | Dynamic description (login vs. switch). |
| /logout | logout/index.ts | Sign out from OpenAgentic account | none | false | Can be disabled via env. |
| /mcp | mcp/index.ts | Manage MCP servers (enable/disable) | picker | true | Immediate. Args: [enable\|disable [server-name]]. |
| /plan | plan/index.ts | Enable plan mode or view current plan | modal | true | Args: [open\|<description>]. Editor integration. |
| /remote-control | bridge/index.ts | Connect for remote-control sessions | custom | true | Feature-gated (BRIDGE_MODE). Aliases: rc. |
| /resume | resume/index.ts | Resume a previous conversation | picker | true | Aliases: continue. Search/filter by ID or term. |
| /skills | skills/index.ts | List available skills | none | false | Skills menu display. |
| /status | status/index.ts | Show OpenAgentic status (version, model, auth, tools) | none | false | Immediate. Comprehensive diagnostics. |

## Priority 2 (Common/Secondary)

| Name | File | Description | UI | Blocking | Notes |
|------|------|-------------|----|---------:|-------|
| /add-dir | add-dir/index.ts | Add a new working directory | form | true | Requires path arg. Directory validation. |
| /branch | branch/index.ts | Create conversation branch at this point | form | true | Optional name. Alias: fork (conditional). |
| /color | color/index.ts | Set prompt bar color for session | picker | true | Immediate. Default color reset option. |
| /copy | copy/index.ts | Copy last response to clipboard | none | false | Optional N-th message selector. |
| /diff | diff/index.ts | View uncommitted changes & per-turn diffs | custom | false | Shows git & conversation diffs. |
| /effort | effort/index.ts | Set effort level for model usage | picker | true | Args: [low\|medium\|high\|max\|auto]. |
| /export | export/index.ts | Export conversation to file or clipboard | form | true | Optional filename arg. |
| /fast | fast/index.ts | Toggle fast mode (Sonnet only) | picker | true | Args: [on\|off]. Feature-gated. |
| /hooks | hooks/index.ts | View hook configurations for tool events | none | false | Immediate. Read-only display. |
| /keybindings | keybindings/index.ts | Open/create keybindings config file | none | false | Opens external editor. |
| /memory | memory/index.ts | Edit OpenAgentic memory files | form | true | Memory file picker & editor. |
| /pr-comments | pr_comments/index.ts | Get comments from a GitHub PR | none | true | Plugin redirect. Structured prompt. |
| /release-notes | release-notes/index.ts | View release notes | none | false | Static/cached display. |
| /rewind | rewind/index.ts | Restore to previous point in code or conversation | picker | true | Aliases: checkpoint. No args. |
| /sandbox | sandbox-toggle/index.ts | Toggle code execution sandbox | form | true | Conditional on platform. Auto-allow & fallback options. |
| /share | share/index.ts | Share conversation (disabled) | none | false | Stub. Hidden. |
| /tag | tag/index.ts | Toggle searchable tag on session | none | true | Internal-only. Requires tag-name arg. |
| /tasks | tasks/index.ts | List and manage background tasks | custom | true | Aliases: bashes. BackgroundTasksDialog. |
| /tools | tools/index.ts | List tools and per-tool config options | none | false | Supports non-interactive. Config syntax: /tools <tool> <key> <value>. |

## Priority 3 (Debug/Internal/Feature-Gated)

| Name | File | Description | UI | Blocking | Notes |
|------|------|-------------|----|---------:|-------|
| /advisor | advisor.ts | Set or show advisor model | none | false | Model validation. Config storage. |
| /openagenticplatform | openagenticPlatform/index.ts | Show OpenAgentic diagnostics (auth, models, MCP) | none | false | Immediate. Platform health check. |
| /brief | brief.ts | Brief mode for compact reasoning | none | false | Feature-gated. Config-driven opt-in. |
| /bridge-kick | bridge-kick.ts | Internal: inject bridge failure states (test/debug) | none | false | Internal-only. Failure mode injection for recovery testing. |
| /commit | commit.ts | Commit staged changes with message | none | true | Attribution, git safety, hooks. |
| /commit-push-pr | commit-push-pr.ts | Create commit, push, and open PR | none | true | Enhanced attribution, workflow scaffolding. |
| /doctorCli | doctorCli/doctorCli.ts | Diagnostics CLI (internal) | none | false | Internal-only. System health. |
| /files | files/index.ts | List all files in context | none | false | Internal-only. Non-interactive support. |
| /init | init.ts | Setup OPENAGENTIC.md for repo | none | true | Two-phase init: interactive Q&A then generation. |
| /init-verifiers | init-verifiers.ts | Create verifier skills for automated testing | none | true | Multi-step verifier creation (web, CLI, API). |
| /insights | insights.ts | Code insights & analytics | none | false | Heavy analysis. Large file. |
| /logsCli | logsCli/logsCli.ts | View debug logs (internal) | none | false | Internal-only. Log filtering. |
| /model-dev | (stub) | — | none | false | Disabled/hidden. |
| /output-style | output-style/index.ts | Deprecated: use /config instead | none | false | Hidden. Redirect to /config. |
| /perf-issue | perf-issue/index.ts | Report performance issue | none | false | Disabled. Stub. |
| /privacy-settings | privacy-settings/index.ts | View and update privacy settings | form | true | Subscriber-only. |
| /reload-plugins | reload-plugins/index.ts | Activate pending plugin changes | none | false | Non-interactive. Control request. |
| /remote-env | remote-env/index.ts | Configure default remote environment | form | true | Subscriber-only. Feature-gated. |
| /remote-setup | remote-setup/index.ts | Setup OpenAgentic on the web (GitHub) | form | true | Alias: web-setup. Feature-gated. |
| /rename | rename/index.ts | Rename current conversation | form | true | Immediate. Optional name arg. |
| /reset-limits | reset-limits/index.ts | Reset usage limits (disabled) | none | false | Stub. Hidden. |
| /review | review.ts | Code review of a pull request | none | true | Local or Ultrareview mode. PR analysis. |
| /security-review | security-review.ts | Security review of pending changes | none | true | Frontmatter-driven. Tool restrictions. |
| /session | session/index.ts | Show remote session URL and QR code | custom | false | Remote-mode only. Hidden otherwise. |
| /stats | stats/index.ts | Show usage stats and activity | custom | false | OpenAgentic usage dashboard. |
| /summary | summary/index.ts | Session summary (disabled) | none | false | Stub. Hidden. |
| /teleport | teleport/index.ts | Teleport to remote session (disabled) | none | false | Stub. Hidden. |
| /terminal-setup | terminalSetup/index.ts | Enable key bindings (platform-specific) | form | true | Conditional on terminal type. |
| /ultraplan | ultraplan.tsx | Multi-agent exploration & remote agent planning | modal | true | 30-min timeout. CCR terms. OAuth. |
| /version | version.ts | Print OpenAgentic version | none | false | Internal-only. Build time. |
| /web-setup | (see remote-setup) | — | form | true | Alias of remote-setup. |
| /workflow | (null) | Feature-gated; not imported | none | false | Stub (WORKFLOW_SCRIPTS). |

---

## Shared UI Components

### PermissionRuleList
- **Commands using it:** /permissions
- **Reuse:** Permission rule editor can be used in other security/config contexts

### ModelPicker
- **Commands using it:** /model, /fast, /effort
- **Reuse:** All model-selection commands share the same picker component

### Settings (multi-tab)
- **Commands using it:** /config
- **Reuse:** Config, theme, output-style all route through a single Settings component

### ThemePicker
- **Commands using it:** /theme
- **Reuse:** Themed UI components

### BackgroundTasksDialog
- **Commands using it:** /tasks
- **Reuse:** Can be embedded in other commands that manage async work

---

## Stub/Hidden/Disabled Commands

These can be trivially stubbed (print "not yet ported" message):

- /env (stub)
- /extra-usage (stub)
- /issue (stub)
- /onboarding (stub)
- /perf-issue (stub)
- /reset-limits (stub)
- /share (stub)
- /summary (stub)
- /teleport (stub)
- /workflow (feature-gated null)

**Reason:** All are either disabled via feature flags, have no interactive UI, or are deprecations pointing to other commands.

---

## Must-Port Commands (Block on These)

Before the React UI is usable, port these P0 and P1 commands:

1. **Core Navigation:** /help, /exit, /clear, /context
2. **User Config:** /config, /theme, /model, /permissions
3. **Session Lifecycle:** /resume, /plan, /branch, /rewind
4. **Diagnostics:** /status, /cost, /openagenticplatform
5. **Auth:** /login, /logout
6. **Tools:** /mcp, /skills, /tasks
7. **Advanced:** /agents, /permission rules

---

## Implementation Notes

- **Type:** Commands are either `local-jsx` (React), `local` (CLI), or `prompt` (AI-driven).
- **Blocking:** All `local-jsx` commands block the REPL until `onDone` is called; some `local` commands may async-return.
- **Immediate:** Some commands (e.g., /color, /btw, /status) run synchronously without user input; they still open UI but fire `onDone` immediately after setup.
- **Aliases:** Many commands have aliases (e.g., /reset → /clear, /rc → /remote-control); handle these at the command registry level.
- **Feature Flags:** Several commands are behind feature gates (BRIDGE_MODE, WORKFLOW_SCRIPTS, etc.); respect feature flag state during porting.
- **Non-interactive Mode:** Some commands (cost, tools, release-notes, files, version, compact) support `supportsNonInteractive: true` for scripting; these should not block UI in headless contexts.

