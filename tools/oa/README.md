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
| `oa agent list \| run <id> <task…>` | List / run registered agents. |
| `oa chat <message…> [--session <id>]` | Send one chat turn and stream the reply. |
| `oa do <text…>` / `oa "<english>"` | Natural-language layer (#120) — route plain English through the chat pipeline; concrete platform actions, with mutating-tool approvals handled in your terminal. |
| `oa tui` / bare `oa` on a TTY | Interactive terminal UI (#121) — login, home dashboard, chat, flows, agents, and key management as an Ink app. |

Global flags: `-p/--profile <name>`, `--instance <url>`, `--json`.

Planned next (same epic): the autonomous agent runtime (#122).

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
