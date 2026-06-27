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

Global flags: `-p/--profile <name>`, `--instance <url>`, `--json`.

Planned next (same epic): `oa key`, `oa flow`, `oa agent`, `oa chat`, the
natural-language layer (`oa "create an agent that …"`, #120), the Ink TUI
(#121), and the autonomous agent runtime (#122).

## Auth model

`oa` only ever uses **api-issued, user-bound, revocable** keys
(`/api/workflows/user/api-keys`) — `oa login` exchanges your credentials for a
short-lived JWT, immediately mints an api key with it, and stores only the key.
No env-static system tokens.

## Develop

```bash
cd tools/oa
npm install
npm test            # vitest (config store, API client, commands, CLI)
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/cli.js (runnable bin)
npm start -- --help # run from source via tsx
```

Tests run against an in-process fake API server (no live instance, no mocks).
