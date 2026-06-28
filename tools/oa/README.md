# `oa` — headless control plane for OpenAgentic

Drive everything OpenAgentic's chat, flows, and agent registry can do from the
terminal — no web UI required. Part of the [oa epic (#116)](https://github.com/agentic-work/openagentic/issues/116).

## Status

Foundation (#117) — in progress. Implemented and tested:

| Command | What it does |
|---|---|
| `oa login --instance <url> -u <user> [-w <pw>]` | Authenticate; **mints a user-bound, revocable api key** and saves it as a profile (stores the key, never the JWT). |
| `oa logout` | Remove a stored profile. |
| `oa whoami` | Show the authenticated identity. |
| `oa health` | Check instance health. |
| `oa key list \| create <name> \| revoke <id>` | Manage user-bound api keys. |
| `oa flow list \| run <id> [--input <json>]` | List / run flows (workflows). |
| `oa agent list \| run <id> <task…>` | List / run registered platform agents. |
| `oa agent create \| schedules \| status \| logs \| start \| stop \| delete` | Autonomous agents (#122) — turn a flow into a scheduled, unattended agent and manage it. |
| `oa chat <message…> [--session <id>]` | Send one chat turn and stream the reply. |
| `oa do <text…>` / `oa "<english>"` | Natural-language layer (#120) — route plain English through the chat pipeline; concrete platform actions, with mutating-tool approvals handled in your terminal. |
| `oa tui` / bare `oa` on a TTY | Interactive terminal UI (#121) — login, home dashboard, chat, flows, agents, and key management as an Ink app. |

Global flags: `-p/--profile <name>`, `--instance <url>`, `--json`.

## Autonomous agents — `oa agent <schedule cmd>` (#122)

An **autonomous agent** is just an existing **flow + a cron schedule** that runs
it unattended. `oa agent` is a thin façade over the schedule CRUD API plus the
existing workflow/execution endpoints — there is no new runtime. The agent's
report-out is the flow's own terminal node (e.g. a `send_email` / Slack node);
`oa agent logs` surfaces each run's output regardless.

These scheduling commands live in the same `oa agent` group as the platform-agent
`list` / `run` commands. Because the bare `oa agent list` already lists the
platform agent registry, the **scheduled-agent listing is `oa agent schedules`**.

```bash
# turn flow w_abc into a 9am-daily autonomous agent (prints the plan, then asks)
oa agent create --flow w_abc --schedule "0 9 * * *" --name "morning triage"
oa agent create --flow w_abc --schedule "0 9 * * *" -y        # skip the prompt
oa agent create --flow w_abc --schedule "*/15 * * * *" --timezone America/New_York

# list your autonomous agents (flows that have a schedule)
oa agent schedules

# a single agent's schedule + recent runs, and the latest run's report payload
oa agent status w_abc
oa agent logs w_abc

# pause / resume (toggles the schedule's is_active)
oa agent stop  w_abc sc_123
oa agent start w_abc sc_123

# remove a schedule (asks unless -y)
oa agent delete w_abc sc_123 -y
```

`oa agent create` prints the resolved plan (flow id + cron), then **asks for
confirmation** unless you pass `-y` or `--json` (both signal explicit intent and
proceed). After creating, it prints the schedule id and `next_run_at`.

### `--report-to` is advisory

`oa agent create --report-to <email>` is accepted but **advisory for v1**. `oa`
is a thin client and cannot verify SMTP or rewrite your flow, so it prints a note
that email report-out requires the flow to contain a `send_email` node **and**
server SMTP config — and reminds you that `oa agent logs <flowId>` shows each
run's output either way. It does **not** fabricate flow nodes.

Planned next (same epic): richer run history + report formatting.

## Natural language — `oa do`

`oa do "<english>"` (and the bare shorthand `oa "<english>"`) routes plain
English through the **existing chat pipeline** — no special server endpoints.
The model turns your request into concrete platform actions (MCP tool calls);
`oa` stays a thin client and streams the assistant's reply to your terminal.

```bash
# bare form — anything that isn't a known subcommand is treated as a request
oa "what's the status of the prod cluster?"

# explicit form (identical behaviour)
oa do "scale the api deployment to 5 replicas"

# reuse a session, or get machine-readable output
oa do --session <id> "and now roll it back"
oa do --json "delete the stuck pod in namespace prod"
```

`oa do` is just `do` with the word spliced in for you: the first non-flag token
that isn't a real subcommand makes `oa` insert `do`. Real subcommands
(`oa chat …`, `oa flow …`) and flags (`--help`, `--version`) pass through
untouched.

### Mutating-tool approvals (HITL)

When the model calls a **mutating** tool, the server pauses and the stream
emits an `approval_required` event. `oa` prints the tool name, a preview, and
the arguments, then asks you to approve:

- **Interactive (a TTY):** you get a `Approve tool <name>? [y/N]` prompt. `y`
  approves; anything else denies. `oa` POSTs your decision and the stream
  resumes.
- **`-y` / `--yes`:** auto-approves every tool call (non-interactive runs / CI).
- **`--json` or a non-TTY (no `--yes`):** **fails safe — denies.** Nothing
  mutating runs unless you explicitly approved it.

On timeout the server itself fails safe (deny). Approvals go to
`POST /api/chat/approvals/:id` with your user-bound key — the same gate the web
UI uses, driven from the terminal.

## Interactive TUI — `oa tui`

`oa tui` (or just `oa` when run in an interactive terminal) launches an Ink
terminal UI over the same client and profile store as the scripting commands:

```bash
oa tui                       # explicit
oa                           # bare, on a TTY → launches the TUI
oa tui --profile prod        # pick a stored profile / instance
oa flow list --json          # scripting fast path — never loads the TUI
```

Screens: **Login** (pick a saved profile, or an inline form that mints a
user-bound api key and stores only the key), **Home** (identity + health badge +
menu), **Chat** (live token streaming, thinking omitted), **Flows** (list and
run, with optional JSON input), **Agents** (list and run on a task), and **Keys**
(list, create — shown once — and revoke with confirmation). `esc` backs out of a
screen; `q` / Ctrl-C quit from Home.

The TUI is **lazily loaded**: `oa tui` / a bare TTY launch dynamically import the
Ink subtree, so the scripting fast path (`oa flow list --json`, any subcommand)
never pays the React/Ink import cost. A bare `oa` in a **non-interactive** shell
(pipe / CI) prints help instead of launching the UI, and any unknown leading
positional is still rewritten to `oa do "<english>"`.

> The TUI's brand palette (`src/tui/theme.tsx`) is an intentional local copy of
> the install wizard's (`tools/setup/src/ui/Theme.tsx`) — they are separate npm
> packages. A brand-color change must be made in **both** places.

## Auth model

`oa` only ever uses **api-issued, user-bound, revocable** keys
(`/api/workflows/user/api-keys`) — `oa login` exchanges your credentials for a
short-lived JWT, immediately mints an api key with it, and stores only the key.
No env-static system tokens.

## Develop

```bash
cd tools/oa
npm install
npm test            # vitest (config store, API client, commands, CLI, Ink TUI screens)
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/cli.js + dist/tui/run.js (lazy TUI chunk)
npm start -- --help # run from source via tsx
npm start -- tui    # run the TUI from source via tsx
```

Tests run against an in-process fake API server (no live instance, no mocks);
the TUI screens are driven with `ink-testing-library` over that same fake API.
