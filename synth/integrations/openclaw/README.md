# Proprietary and confidential. Unauthorized copying prohibited.

# Synth — OpenClaw Skill

This directory packages Synth as an [OpenClaw](https://openclaw.ai) Skill so
that OpenClaw agents can call `synth tool` for any task no other installed
skill covers. One skill replaces the long tail of "install an MCP server for
each service."

## Files

- `synth/SKILL.md` — the skill manifest (YAML frontmatter + inline-JSON metadata + model instructions).

Nothing else is needed; OpenClaw Skills are prompt wrappers around host
binaries. The host must have `synth` on `PATH`.

## Install locally (verified on OpenClaw 2026.4.15)

```bash
# 1. Make sure synth is installed and on PATH
pip install -e /path/to/synth          # or: uv tool install synth
# If it's only in a repo .venv, symlink it so OpenClaw can find it:
ln -sf /path/to/synth/.venv/bin/synth ~/.local/bin/synth
synth version                          # sanity check

# 2. Tell OpenClaw where to find this skill (points at the directory
#    containing `synth/`, not at SKILL.md itself).
openclaw config set skills.load.extraDirs \
  '["/path/to/synth/integrations/openclaw"]' --strict-json

# 3. Verify discovery + readiness
openclaw skills info synth
#   🧪 synth ✓ Ready
#   Source: openclaw-extra
#   Binaries: ✓ synth
```

Configure per-capability credentials in your OpenClaw config under
`skills.entries.synth.env`. Synth reads from env — never from chat. Example:

```yaml
skills:
  entries:
    synth:
      env:
        OPENAGENTIC_API_KEY: "awc_..."
        GITHUB_TOKEN: "ghp_..."
        STRIPE_API_KEY: "sk_test_..."
```

## Publish to ClawHub

```bash
clawhub publish ./integrations/openclaw \
  --slug synth--synth \
  --version 0.1.0
```

Register the `@synth` namespace first if you haven't. ClawHub will hash the
bundle, check it against VirusTotal, and list it on https://clawhub.ai once
scans come back clean.

## Known limitations (v1)

- **Chat-transport approval integration is not wired.** `synth tool` prompts
  on stdin for approve/deny. In an OpenClaw main (CLI) session this works;
  in chat transports (Telegram / Slack / Discord) the agent will hang on the
  prompt. Roadmap: emit a structured approval request that OpenClaw renders
  as an inline chat button, then re-invoke with the decision.
- **Output is Rich-decorated text, not JSON.** Agents parse the `Result:`
  panel text. A `--json` output mode for machine-readable output is planned.
- **`synth/mcp/server.py` exists but isn't a CLI subcommand.** Don't try to
  `synth mcp serve` from this skill — it's internal-only today.

## Mapping to synth's capabilities

The skill's `metadata.openclaw.requires.bins: ["synth"]` is the only hard
requirement. Scope-specific credentials are optional — the user adds them
for whichever capabilities they want the agent to reach. See
`SKILL.md` for the full env-var table.

## Related

- Synth repo: https://github.com/agentic-work/synth
- OpenClaw Skills docs: https://docs.openclaw.ai/tools/skills
- ClawHub publish docs: https://docs.openclaw.ai/tools/clawhub
