# Codemode slash-command battery — chat-dev evidence

Run: 2026-05-02T13:33:57.741Z
Base: https://chat-dev.openagentic.io
Account: mcp-tester@phatoldsungmail.onmicrosoft.com

Spec file: `codemode-slash-battery.spec.ts` — 859 LOC, 28518 bytes

Daemon-advertised slash commands (count=0): (none observed)

Commands exercised in this run (count=27): agents, btw, bug, config, context, cost, doctor, files, help, hooks, init, mcp, memory, migrate-installer, model, output-style, permissions, plan, pr-comments, release-notes, resume, skills, status, theme, tools, upgrade, version

Tally — pass: 16, requires-interaction: 11, soft-warn: 0, fail: 0

## Pass/fail summary

| Command | Status | Notes | Screenshot |
| --- | --- | --- | --- |
| /agents | requires-interaction | gate: modal:[data-testid="agents-picker"] | ![agents.png](codemode-slash-battery-artifacts/agents.png) |
| /btw | pass | ok | ![btw.png](codemode-slash-battery-artifacts/btw.png) |
| /bug | pass | ok | ![bug.png](codemode-slash-battery-artifacts/bug.png) |
| /config | requires-interaction | gate: modal:[role="dialog"] | ![config.png](codemode-slash-battery-artifacts/config.png) |
| /context | pass | ok | ![context.png](codemode-slash-battery-artifacts/context.png) |
| /cost | pass | ok | ![cost.png](codemode-slash-battery-artifacts/cost.png) |
| /doctor | pass | ok | ![doctor.png](codemode-slash-battery-artifacts/doctor.png) |
| /files | pass | ok | ![files.png](codemode-slash-battery-artifacts/files.png) |
| /help | pass | ok | ![help.png](codemode-slash-battery-artifacts/help.png) |
| /hooks | pass | ok | ![hooks.png](codemode-slash-battery-artifacts/hooks.png) |
| /init | pass | ok | ![init.png](codemode-slash-battery-artifacts/init.png) |
| /mcp | requires-interaction | gate: modal:[role="dialog"] | ![mcp.png](codemode-slash-battery-artifacts/mcp.png) |
| /memory | requires-interaction | gate: modal:[role="dialog"] | ![memory.png](codemode-slash-battery-artifacts/memory.png) |
| /migrate-installer | pass | ok | ![migrate-installer.png](codemode-slash-battery-artifacts/migrate-installer.png) |
| /model | requires-interaction | gate: modal:[data-testid="model-picker"] | ![model.png](codemode-slash-battery-artifacts/model.png) |
| /output-style | pass | ok | ![output-style.png](codemode-slash-battery-artifacts/output-style.png) |
| /permissions | requires-interaction | gate: modal:[role="dialog"] | ![permissions.png](codemode-slash-battery-artifacts/permissions.png) |
| /plan | requires-interaction | gate: modal:[role="dialog"] | ![plan.png](codemode-slash-battery-artifacts/plan.png) |
| /pr-comments | pass | ok | ![pr-comments.png](codemode-slash-battery-artifacts/pr-comments.png) |
| /release-notes | pass | ok | ![release-notes.png](codemode-slash-battery-artifacts/release-notes.png) |
| /resume | requires-interaction | gate: modal:[role="dialog"] | ![resume.png](codemode-slash-battery-artifacts/resume.png) |
| /skills | requires-interaction | gate: modal:[data-testid="skills-picker"] | ![skills.png](codemode-slash-battery-artifacts/skills.png) |
| /status | pass | ok | ![status.png](codemode-slash-battery-artifacts/status.png) |
| /theme | requires-interaction | gate: modal:[role="dialog"] | ![theme.png](codemode-slash-battery-artifacts/theme.png) |
| /tools | pass | ok | ![tools.png](codemode-slash-battery-artifacts/tools.png) |
| /upgrade | pass | ok | ![upgrade.png](codemode-slash-battery-artifacts/upgrade.png) |
| /version | requires-interaction | gate: modal:[role="dialog"] | ![version.png](codemode-slash-battery-artifacts/version.png) |

## /agents — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /agents)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[data-testid="agents-picker"]
```

Requires-interaction gate: `modal:[data-testid="agents-picker"]`

![agents.png](codemode-slash-battery-artifacts/agents.png)

## /btw — **PASS**

```
daemon advertised 0 slash commands (does NOT include /btw)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via inline-cm-output
```

![btw.png](codemode-slash-battery-artifacts/btw.png)

## /bug — **PASS**

```
daemon advertised 0 slash commands (does NOT include /bug)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![bug.png](codemode-slash-battery-artifacts/bug.png)

## /config — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /config)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![config.png](codemode-slash-battery-artifacts/config.png)

## /context — **PASS**

```
daemon advertised 0 slash commands (does NOT include /context)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![context.png](codemode-slash-battery-artifacts/context.png)

## /cost — **PASS**

```
daemon advertised 0 slash commands (does NOT include /cost)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![cost.png](codemode-slash-battery-artifacts/cost.png)

## /doctor — **PASS**

```
daemon advertised 0 slash commands (does NOT include /doctor)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![doctor.png](codemode-slash-battery-artifacts/doctor.png)

## /files — **PASS**

```
daemon advertised 0 slash commands (does NOT include /files)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![files.png](codemode-slash-battery-artifacts/files.png)

## /help — **PASS**

```
daemon advertised 0 slash commands (does NOT include /help)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![help.png](codemode-slash-battery-artifacts/help.png)

## /hooks — **PASS**

```
daemon advertised 0 slash commands (does NOT include /hooks)
idle reached: true via result-frame
result subtype: success
render detected: true via inline-cm-output
```

![hooks.png](codemode-slash-battery-artifacts/hooks.png)

## /init — **PASS**

```
daemon advertised 0 slash commands (does NOT include /init)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![init.png](codemode-slash-battery-artifacts/init.png)

## /mcp — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /mcp)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![mcp.png](codemode-slash-battery-artifacts/mcp.png)

## /memory — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /memory)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![memory.png](codemode-slash-battery-artifacts/memory.png)

## /migrate-installer — **PASS**

```
daemon advertised 0 slash commands (does NOT include /migrate-installer)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![migrate-installer.png](codemode-slash-battery-artifacts/migrate-installer.png)

## /model — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /model)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[data-testid="model-picker"]
```

Requires-interaction gate: `modal:[data-testid="model-picker"]`

![model.png](codemode-slash-battery-artifacts/model.png)

## /output-style — **PASS**

```
daemon advertised 0 slash commands (does NOT include /output-style)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![output-style.png](codemode-slash-battery-artifacts/output-style.png)

## /permissions — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /permissions)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![permissions.png](codemode-slash-battery-artifacts/permissions.png)

## /plan — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /plan)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![plan.png](codemode-slash-battery-artifacts/plan.png)

## /pr-comments — **PASS**

```
daemon advertised 0 slash commands (does NOT include /pr-comments)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![pr-comments.png](codemode-slash-battery-artifacts/pr-comments.png)

## /release-notes — **PASS**

```
daemon advertised 0 slash commands (does NOT include /release-notes)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![release-notes.png](codemode-slash-battery-artifacts/release-notes.png)

## /resume — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /resume)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![resume.png](codemode-slash-battery-artifacts/resume.png)

## /skills — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /skills)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[data-testid="skills-picker"]
```

Requires-interaction gate: `modal:[data-testid="skills-picker"]`

![skills.png](codemode-slash-battery-artifacts/skills.png)

## /status — **PASS**

```
daemon advertised 0 slash commands (does NOT include /status)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![status.png](codemode-slash-battery-artifacts/status.png)

## /theme — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /theme)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![theme.png](codemode-slash-battery-artifacts/theme.png)

## /tools — **PASS**

```
daemon advertised 0 slash commands (does NOT include /tools)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via assistant-block
```

![tools.png](codemode-slash-battery-artifacts/tools.png)

## /upgrade — **PASS**

```
daemon advertised 0 slash commands (does NOT include /upgrade)
idle reached: true via result-frame
result subtype: success
render detected: true via assistant-block
```

![upgrade.png](codemode-slash-battery-artifacts/upgrade.png)

## /version — **REQUIRES-INTERACTION**

```
daemon advertised 0 slash commands (does NOT include /version)
idle reached: true via dom-idle
no result frame seen — slash command may be local-only (TUI command bypasses daemon)
render detected: true via modal:[role="dialog"]
```

Requires-interaction gate: `modal:[role="dialog"]`

![version.png](codemode-slash-battery-artifacts/version.png)
