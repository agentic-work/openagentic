# TUI vs codemode — open deltas (left uncommitted, 2026-05-02 audit)

Source-of-truth: `services/openagentic-ui/tests/e2e/tui-vs-codemode-diff.report.md`.
Capturer: `_capture.py` (drives openagentic in pexpect+pyte PTY).

The two commits already on main close the smallest-blast-radius gaps
(/btw, /tools, /status). Everything below is left for follow-up; most
require daemon / api changes the UI repo can't make alone.

## High severity, daemon-side (api repo)

- **/help** — daemon emits no result frame. The UI's
  `dispatchSlashCommand` `case 'help'` deliberately falls through to
  the daemon (rationale comment in CodeModeChatView.tsx). The api's
  slash-dispatcher must emit the canonical command list as a synthetic
  assistant turn — same shape as openagentic TUI's `general / commands /
  custom-commands` tabs.
- **/context** — daemon throws `Right side of assignment cannot be
  destructured`. Bug in api `slash-dispatcher.ts` /context handler.
- **/hooks** — daemon throws `context.getAppState is not a function`.
  Same dispatcher needs the getAppState shim.
- **/agents** — picker payload only carries built-in agents; TUI also
  shows Plugin agents (sonnet pills). Daemon needs to include them in
  `system_init._detail.agents` with `source: 'plugin'`.
- **/mcp** — picker shows only Playwright; TUI also lists
  aws-serverless. Daemon's mcp inventory missing the plugin MCPs.
- **/resume** — codemode says "No sessions yet" while TUI shows 50
  sessions. Wire the daemon's session list via `control_request`
  (subtype: `list_sessions`) and surface in `RichModals.ResumeModal`.

## Medium severity, UI-side (codemode)

- **/skills** — group by source (User skills / Plugin skills) and show
  approx-token cost like the TUI does. Edit `pickers/SkillsPicker.tsx`
  to consume the `source` field on each SkillDetail.
- **/permissions** — split tool chips into `Recently denied / Allow /
  Ask / Deny / Workspace` tabs and add a "+ Add new rule" row. Edit
  `RichModals.tsx` PermissionsModal.
- **/memory** — add the auto-memory and auto-dream toggles the TUI
  picker shows. Edit `CommandModals.tsx` MemoryModal.
- **/cost** — minor: codemode flattens to single-line; TUI shows
  indented column block (Total cost / API duration / wall / changes /
  usage). Add a CostMessage renderer or change the api's text format.

## Low / accept

- **/init, /pr-comments, /plan, /model** — functional parity, format
  differences are acceptable.
- **/output-style, /release-notes, /version** — TEXT match.
- **/doctor, /upgrade, /migrate-installer, /files, /bug** — not real
  v0.7.0 skills; the TUI prints "Unknown skill: <name>". Codemode also
  drops them silently. Either remove from `slashCommands.ts` (cleanest)
  or keep as hidden suggestions for a future v0.7.x. Slated for a
  later cleanup pass — non-load-bearing.
