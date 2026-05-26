/**
 * Phase-0 visual mock for the codemode slash-command rewrite.
 *
 * Route: /dev/codemode-slash-mocks
 * Gated by NODE_ENV !== 'production' in App.tsx.
 *
 * Plan reference: /home/trent/.claude/plans/sprightly-percolating-brook.md
 *
 * What this page shows:
 *
 * Side-by-side TUI-vs-DOM comparison for every slash command in the
 * codemode matrix, plus the inline artifact sandbox preview (claude.ai
 * parity). The right-side mock is a static React rendering using the
 * inline `mockInk.tsx` primitives (NOT the real Phase-3 ink-dom library
 * — those don't exist yet). When Phase 3 lands, the section files swap
 * import paths and the visual remains the same.
 *
 * The intent: lock the visual design with the user before any Phase 1+
 * (reconciler / wire-protocol / RIP) work begins.
 */

import * as React from 'react';
import { MockBox, MockText, MockNewline, MockSpacer, MockFocusRow, MockKeyHints } from './mockInk';
import { MockSection, MockChatBubble, MockTuiPane } from './MockChatBubble';

const SlashMocksPage: React.FC = () => (
  <div
    style={{
      minHeight: '100vh',
      backgroundColor: 'var(--cm-bg-secondary, #161b22)',
      color: 'var(--cm-text, #e6edf3)',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '32px 48px',
    }}
  >
    <header style={{ maxWidth: 1500, margin: '0 auto 32px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
        Codemode slash-command rewrite — visual mock
      </h1>
      <p style={{ color: 'var(--cm-text-muted, #8b949e)', marginTop: 8, fontSize: 14, lineHeight: 1.6 }}>
        Phase-0 deliverable per <code>/home/trent/.claude/plans/sprightly-percolating-brook.md</code>.
        Each section: openagentic TUI rendering on the left (today) → codemode browser rendering on the right (after rewrite).
        Right-side previews use inline mock primitives that mimic the real Phase-3 ink-dom library.
        <strong style={{ color: 'var(--cm-text, #e6edf3)' }}> If the right side looks right, the architecture proceeds. If it doesn't, we iterate here before touching backend code.</strong>
      </p>
    </header>

    <main style={{ maxWidth: 1500, margin: '0 auto' }}>
      {/* ═════════════════════════════════════════════════════════════════
          1. Static text-output commands
         ═════════════════════════════════════════════════════════════════ */}
      <h2 style={{ fontSize: 16, color: 'var(--cm-accent, #58a6ff)', marginTop: 32, marginBottom: 16 }}>
        1 · Static text-output commands
      </h2>

      {/* ───── /help ───── */}
      <MockSection
        title="Help"
        command="/help"
        category="static text"
        description="Lists every available slash command for this session, sourced from the daemon's command registry. No interactivity — pure prose + a table of names."
      >
        <MockTuiPane>{`OpenAgentic v0.7.0 — slash commands

Usage:
  /<name> [args]            Run a built-in or custom command
  /                          Open the slash-command palette

Built-in commands (always available):
  /help          Show this help
  /clear         Clear the conversation
  /model [id]    Switch the active model
  /cost          Show session cost & token usage
  /context       Visualise context-window usage
  /version       Print version & build metadata
  /exit          End this session
  /resume [id]   Resume a previous conversation

Type /<TAB> to autocomplete; ↑/↓ to recall recent prompts.`}</MockTuiPane>

        <MockChatBubble userInput="/help" affordanceLabel="static text — server-rendered Ink → JSON → DOM">
          <MockBox flexDirection="column" gap={1}>
            <MockText bold>OpenAgentic v0.7.0 — slash commands</MockText>
            <MockNewline />
            <MockText dimColor>Usage:</MockText>
            <MockBox flexDirection="row" gap={2}>
              <MockText color="cyan">/&lt;name&gt; [args]</MockText>
              <MockText>Run a built-in or custom command</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={2}>
              <MockText color="cyan">/</MockText>
              <MockText>Open the slash-command palette</MockText>
            </MockBox>
            <MockNewline />
            <MockText dimColor>Built-in commands (always available):</MockText>
            {[
              ['/help', 'Show this help'],
              ['/clear', 'Clear the conversation'],
              ['/model [id]', 'Switch the active model'],
              ['/cost', 'Show session cost & token usage'],
              ['/context', 'Visualise context-window usage'],
              ['/version', 'Print version & build metadata'],
              ['/exit', 'End this session'],
              ['/resume [id]', 'Resume a previous conversation'],
            ].map(([cmd, desc]) => (
              <MockBox key={cmd} flexDirection="row" gap={2}>
                <MockText color="cyan">{cmd}</MockText>
                <MockText>{desc}</MockText>
              </MockBox>
            ))}
            <MockNewline />
            <MockText dimColor>Type /&lt;TAB&gt; to autocomplete; ↑/↓ to recall recent prompts.</MockText>
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ───── /cost ───── */}
      <MockSection
        title="Cost report"
        command="/cost"
        category="static text"
        description="Per-model cost & token breakdown for the current session. Daemon-resident state, formatted by openagentic's cost-tracker."
      >
        <MockTuiPane>{`Session cost — 2026-04-25 21:42 → now (43m 12s)

  Model                              In tokens   Out tokens   Cost
  ───────────────────────────────────────────────────────────────────
  global.anthropic.claude-sonnet-4-6     12,840       3,127   $0.041
  gpt-oss:20b (ollama)                    8,210         425   $0.000  (local)

  Total                                  21,050       3,552   $0.041`}</MockTuiPane>

        <MockChatBubble userInput="/cost" affordanceLabel="static text — daemon emits formatted text via Ink, browser renders identically">
          <MockBox flexDirection="column">
            <MockText bold>Session cost</MockText>
            <MockText dimColor>2026-04-25 21:42 → now (43m 12s)</MockText>
            <MockNewline />
            <MockBox flexDirection="row" gap={4}>
              <MockText dimColor>Model</MockText>
              <MockSpacer />
              <MockText dimColor>In</MockText>
              <MockText dimColor>Out</MockText>
              <MockText dimColor>Cost</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={4}>
              <MockText color="cyan">global.anthropic.claude-sonnet-4-6</MockText>
              <MockSpacer />
              <MockText>12,840</MockText>
              <MockText>3,127</MockText>
              <MockText color="green">$0.041</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={4}>
              <MockText color="cyan">gpt-oss:20b</MockText>
              <MockText dimColor>(ollama)</MockText>
              <MockSpacer />
              <MockText>8,210</MockText>
              <MockText>425</MockText>
              <MockText dimColor>$0.000 (local)</MockText>
            </MockBox>
            <MockNewline />
            <MockBox flexDirection="row" gap={4}>
              <MockText bold>Total</MockText>
              <MockSpacer />
              <MockText bold>21,050</MockText>
              <MockText bold>3,552</MockText>
              <MockText bold color="green">$0.041</MockText>
            </MockBox>
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ═════════════════════════════════════════════════════════════════
          2. Interactive picker commands (THE big-deal ones)
         ═════════════════════════════════════════════════════════════════ */}
      <h2 style={{ fontSize: 16, color: 'var(--cm-accent, #58a6ff)', marginTop: 48, marginBottom: 16 }}>
        2 · Interactive picker commands — arrow-key navigation, Enter to select
      </h2>

      {/* ───── /model ───── */}
      <MockSection
        title="Model picker"
        command="/model"
        category="interactive picker"
        description="THE one the user explicitly cares about. Arrow keys navigate; Enter swaps the model for this session. State lives in the daemon (setMainLoopModelOverride); browser sends arrow-key events back over the WS."
      >
        <MockTuiPane>{`Switch model for this session

  ◯  global.anthropic.claude-opus-4-7         ($0.030 / $0.150 per 1k)
› ●  global.anthropic.claude-sonnet-4-6        ($0.003 / $0.015 per 1k)  current
  ◯  global.anthropic.claude-haiku-4-5         ($0.0008 / $0.004 per 1k)
  ◯  gpt-oss:20b                               (free, local Ollama)
  ◯  us.deepseek.r1-v1:0                       ($0.0014 / $0.0028 per 1k)

  ↑↓ navigate   enter select   esc cancel`}</MockTuiPane>

        <MockChatBubble userInput="/model" affordanceLabel="interactive picker — keystrokes flow browser→daemon, picker re-renders on every up/down">
          <MockBox flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
            <MockText bold>Switch model for this session</MockText>
            <MockNewline />
            <MockFocusRow>
              <MockText>◯ global.anthropic.claude-opus-4-7</MockText>
              <MockText dimColor>  ($0.030 / $0.150 per 1k)</MockText>
            </MockFocusRow>
            <MockFocusRow focused>
              <MockText color="green">● global.anthropic.claude-sonnet-4-6</MockText>
              <MockText dimColor>  ($0.003 / $0.015 per 1k)</MockText>
              <MockText color="cyan">  current</MockText>
            </MockFocusRow>
            <MockFocusRow>
              <MockText>◯ global.anthropic.claude-haiku-4-5</MockText>
              <MockText dimColor>  ($0.0008 / $0.004 per 1k)</MockText>
            </MockFocusRow>
            <MockFocusRow>
              <MockText>◯ gpt-oss:20b</MockText>
              <MockText dimColor>  (free, local Ollama)</MockText>
            </MockFocusRow>
            <MockFocusRow>
              <MockText>◯ us.deepseek.r1-v1:0</MockText>
              <MockText dimColor>  ($0.0014 / $0.0028 per 1k)</MockText>
            </MockFocusRow>
            <MockKeyHints
              hints={[
                ['↑↓', 'navigate'],
                ['enter', 'select'],
                ['esc', 'cancel'],
              ]}
            />
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ───── /resume ───── */}
      <MockSection
        title="Resume picker"
        command="/resume"
        category="interactive picker"
        description="Pick a previous session to continue. Each row is a real session row from the daemon's persistent transcript store. Same arrow-key UX as /model."
      >
        <MockTuiPane>{`Resume previous conversation

› ●  Today  16:42  Bob — investigate the codemode WS hang  (43 turns)
  ◯  Today  09:18  refactor RegistrySeeder to drop legacy column  (12 turns)
  ◯  Yesterday    debug Argo image-updater stale-pin loop  (28 turns)
  ◯  Apr 24       wave-A through wave-F server.ts split  (104 turns)
  ◯  Apr 23       SVC sticky-session retire from k3s  (8 turns)

  ↑↓ navigate   enter select   esc cancel   d delete`}</MockTuiPane>

        <MockChatBubble userInput="/resume" affordanceLabel="interactive picker — same machinery as /model">
          <MockBox flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
            <MockText bold>Resume previous conversation</MockText>
            <MockNewline />
            <MockFocusRow focused>
              <MockText color="green">●</MockText>
              <MockText dimColor>  Today  16:42  </MockText>
              <MockText>Bob — investigate the codemode WS hang  </MockText>
              <MockText dimColor>(43 turns)</MockText>
            </MockFocusRow>
            <MockFocusRow>
              <MockText>◯  </MockText>
              <MockText dimColor>Today  09:18  </MockText>
              <MockText>refactor RegistrySeeder to drop legacy column  </MockText>
              <MockText dimColor>(12 turns)</MockText>
            </MockFocusRow>
            <MockFocusRow>
              <MockText>◯  </MockText>
              <MockText dimColor>Yesterday    </MockText>
              <MockText>debug Argo image-updater stale-pin loop  </MockText>
              <MockText dimColor>(28 turns)</MockText>
            </MockFocusRow>
            <MockFocusRow>
              <MockText>◯  </MockText>
              <MockText dimColor>Apr 24       </MockText>
              <MockText>wave-A through wave-F server.ts split  </MockText>
              <MockText dimColor>(104 turns)</MockText>
            </MockFocusRow>
            <MockKeyHints
              hints={[
                ['↑↓', 'navigate'],
                ['enter', 'select'],
                ['esc', 'cancel'],
                ['d', 'delete'],
              ]}
            />
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ───── /permissions ───── */}
      <MockSection
        title="Permissions editor"
        command="/permissions"
        category="interactive picker"
        description="Multi-select picker for granting/revoking tool permissions. Daemon mirrors changes to the session's permissionContext immediately."
      >
        <MockTuiPane>{`Tool permissions — openagentic-mcp-tester / current session

  Bash                             [✓]  always allow
  Read                             [✓]  always allow
  Write                            [✓]  always allow
  Edit                             [✓]  always allow
  WebFetch                         [ ]  ask each time
› WebSearch                        [ ]  ask each time         ← cursor
  Grep                             [✓]  always allow
  Glob                             [✓]  always allow
  Task                             [✓]  always allow
  Skill                            [ ]  ask each time

  ↑↓ navigate   space toggle   enter save   esc cancel`}</MockTuiPane>

        <MockChatBubble userInput="/permissions" affordanceLabel="interactive picker with multi-select state">
          <MockBox flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
            <MockText bold>Tool permissions</MockText>
            <MockText dimColor>openagentic-mcp-tester / current session</MockText>
            <MockNewline />
            {[
              { name: 'Bash', state: '✓', label: 'always allow' },
              { name: 'Read', state: '✓', label: 'always allow' },
              { name: 'Write', state: '✓', label: 'always allow' },
              { name: 'Edit', state: '✓', label: 'always allow' },
              { name: 'WebFetch', state: ' ', label: 'ask each time' },
              { name: 'WebSearch', state: ' ', label: 'ask each time', focused: true },
              { name: 'Grep', state: '✓', label: 'always allow' },
              { name: 'Glob', state: '✓', label: 'always allow' },
              { name: 'Task', state: '✓', label: 'always allow' },
              { name: 'Skill', state: ' ', label: 'ask each time' },
            ].map(({ name, state, label, focused }) => (
              <MockFocusRow key={name} focused={focused}>
                <MockText>{name.padEnd(20)}</MockText>
                <MockText color={state === '✓' ? 'green' : 'gray'}>[{state}]</MockText>
                <MockText dimColor>  {label}</MockText>
              </MockFocusRow>
            ))}
            <MockKeyHints
              hints={[
                ['↑↓', 'navigate'],
                ['space', 'toggle'],
                ['enter', 'save'],
                ['esc', 'cancel'],
              ]}
            />
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ═════════════════════════════════════════════════════════════════
          3. Install/manage UIs (plugins / skills / MCP)
         ═════════════════════════════════════════════════════════════════ */}
      <h2 style={{ fontSize: 16, color: 'var(--cm-accent, #58a6ff)', marginTop: 48, marginBottom: 16 }}>
        3 · Install/manage UIs — answer to "we can install plugins/skills/mcps yes?"
      </h2>

      {/* ───── /plugins ───── */}
      <MockSection
        title="Plugins manager"
        command="/plugins"
        category="install/manage"
        description="Browse marketplace, install/uninstall plugins, toggle enabled. Backed by openagentic's actual plugin handler — clicking Install in the browser fires the SAME daemon code path the TUI uses."
      >
        <MockTuiPane>{`Plugin marketplace — anthropics/claude-plugins-official

  ✓  obra/superpowers          v2.4.1   installed   ⏵ enabled
  ✓  obra/code-mode            v1.7.0   installed   ⏵ enabled
  ⌛ obra/web-research          v0.9.0   installing…
  ◯  obra/release-notes-helper v1.2.0   marketplace
  ◯  obra/git-flow             v0.4.0   marketplace
  ◯  openagentic/cdc-helpers   v0.1.0   marketplace

  ↑↓ navigate   i install   u uninstall   e toggle enable   esc close`}</MockTuiPane>

        <MockChatBubble userInput="/plugins" affordanceLabel="install/uninstall buttons fire the daemon's existing plugin handler — no new install plumbing">
          <MockBox flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
            <MockText bold>Plugin marketplace</MockText>
            <MockText dimColor>anthropics/claude-plugins-official</MockText>
            <MockNewline />
            <MockBox flexDirection="row" gap={2}>
              <MockText color="green">✓</MockText>
              <MockText>obra/superpowers</MockText>
              <MockText dimColor>v2.4.1</MockText>
              <MockSpacer />
              <MockText color="green">installed</MockText>
              <MockText color="cyan">⏵ enabled</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={2}>
              <MockText color="green">✓</MockText>
              <MockText>obra/code-mode</MockText>
              <MockText dimColor>v1.7.0</MockText>
              <MockSpacer />
              <MockText color="green">installed</MockText>
              <MockText color="cyan">⏵ enabled</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={2}>
              <MockText color="yellow">⌛</MockText>
              <MockText>obra/web-research</MockText>
              <MockText dimColor>v0.9.0</MockText>
              <MockSpacer />
              <MockText color="yellow">installing…</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={2}>
              <MockText dimColor>◯</MockText>
              <MockText>obra/release-notes-helper</MockText>
              <MockText dimColor>v1.2.0</MockText>
              <MockSpacer />
              <MockText dimColor>marketplace</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={2}>
              <MockText dimColor>◯</MockText>
              <MockText>obra/git-flow</MockText>
              <MockText dimColor>v0.4.0</MockText>
              <MockSpacer />
              <MockText dimColor>marketplace</MockText>
            </MockBox>
            <MockBox flexDirection="row" gap={2}>
              <MockText dimColor>◯</MockText>
              <MockText>openagentic/cdc-helpers</MockText>
              <MockText dimColor>v0.1.0</MockText>
              <MockSpacer />
              <MockText dimColor>marketplace</MockText>
            </MockBox>
            <MockKeyHints
              hints={[
                ['↑↓', 'navigate'],
                ['i', 'install'],
                ['u', 'uninstall'],
                ['e', 'toggle enable'],
                ['esc', 'close'],
              ]}
            />
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ───── /mcp ───── */}
      <MockSection
        title="MCP servers"
        command="/mcp"
        category="install/manage"
        description="Add, remove, and toggle MCP servers. Same install affordances as /plugins."
      >
        <MockTuiPane>{`MCP servers — current session

  ✓  k8s              http://mcp-proxy.agentic-dev.svc:8080/k8s   ⏵ 12 tools
  ✓  azure            http://mcp-proxy.agentic-dev.svc:8080/azure ⏵ 31 tools
  ✓  aws              http://mcp-proxy.agentic-dev.svc:8080/aws   ⏵ 31 tools
  ⏸  gcp              http://mcp-proxy.agentic-dev.svc:8080/gcp   ⏵ 46 tools (paused)
  ◯  postgres         (disabled)

  + add server     ↑↓ navigate   space pause/resume   r remove   esc close`}</MockTuiPane>

        <MockChatBubble userInput="/mcp">
          <MockBox flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
            <MockText bold>MCP servers</MockText>
            <MockText dimColor>current session</MockText>
            <MockNewline />
            {[
              { state: '✓', name: 'k8s', url: 'http://mcp-proxy.agentic-dev.svc:8080/k8s', meta: '⏵ 12 tools', color: 'green' as const },
              { state: '✓', name: 'azure', url: 'http://mcp-proxy.agentic-dev.svc:8080/azure', meta: '⏵ 31 tools', color: 'green' as const },
              { state: '✓', name: 'aws', url: 'http://mcp-proxy.agentic-dev.svc:8080/aws', meta: '⏵ 31 tools', color: 'green' as const },
              { state: '⏸', name: 'gcp', url: 'http://mcp-proxy.agentic-dev.svc:8080/gcp', meta: '⏵ 46 tools (paused)', color: 'yellow' as const },
              { state: '◯', name: 'postgres', url: '(disabled)', meta: '', color: 'gray' as const },
            ].map((s) => (
              <MockBox key={s.name} flexDirection="row" gap={2}>
                <MockText color={s.color}>{s.state}</MockText>
                <MockText>{s.name.padEnd(8)}</MockText>
                <MockText dimColor>{s.url}</MockText>
                <MockSpacer />
                <MockText dimColor>{s.meta}</MockText>
              </MockBox>
            ))}
            <MockNewline />
            <MockBox flexDirection="row" gap={2}>
              <MockText color="cyan">+ add server</MockText>
            </MockBox>
            <MockKeyHints
              hints={[
                ['↑↓', 'navigate'],
                ['space', 'pause/resume'],
                ['r', 'remove'],
                ['esc', 'close'],
              ]}
            />
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ───── /skills ───── */}
      <MockSection
        title="Skills"
        command="/skills"
        category="install/manage"
        description="Skills (TUI nomenclature for Anthropic skill packs). Same install/uninstall flow as plugins."
      >
        <MockTuiPane>{`Skills — installed + marketplace

  ✓  superpowers/systematic-debugging       v5.0.7   ⏵ enabled
  ✓  superpowers/test-driven-development    v5.0.7   ⏵ enabled
  ✓  superpowers/brainstorming              v5.0.7   ⏵ enabled
  ✓  superpowers/code-reviewer              v5.0.7   ⏵ enabled
  ◯  anthropic/web-research                 v0.4.0   marketplace
  ◯  anthropic/python-data-science          v0.2.0   marketplace
  ◯  anthropic/docx                         v0.1.0   marketplace

  ↑↓ navigate   i install   u uninstall   e toggle   esc close`}</MockTuiPane>

        <MockChatBubble userInput="/skills">
          <MockBox flexDirection="column" borderStyle="round" borderColor="gray" padding={1}>
            <MockText bold>Skills</MockText>
            <MockText dimColor>installed + marketplace</MockText>
            <MockNewline />
            {[
              { installed: true, name: 'superpowers/systematic-debugging', v: 'v5.0.7' },
              { installed: true, name: 'superpowers/test-driven-development', v: 'v5.0.7' },
              { installed: true, name: 'superpowers/brainstorming', v: 'v5.0.7' },
              { installed: true, name: 'superpowers/code-reviewer', v: 'v5.0.7' },
              { installed: false, name: 'anthropic/web-research', v: 'v0.4.0' },
              { installed: false, name: 'anthropic/python-data-science', v: 'v0.2.0' },
              { installed: false, name: 'anthropic/docx', v: 'v0.1.0' },
            ].map((s) => (
              <MockBox key={s.name} flexDirection="row" gap={2}>
                <MockText color={s.installed ? 'green' : 'gray'}>{s.installed ? '✓' : '◯'}</MockText>
                <MockText>{s.name}</MockText>
                <MockText dimColor>{s.v}</MockText>
                <MockSpacer />
                <MockText color={s.installed ? 'cyan' : 'gray'}>
                  {s.installed ? '⏵ enabled' : 'marketplace'}
                </MockText>
              </MockBox>
            ))}
            <MockKeyHints
              hints={[
                ['↑↓', 'navigate'],
                ['i', 'install'],
                ['u', 'uninstall'],
                ['e', 'toggle'],
                ['esc', 'close'],
              ]}
            />
          </MockBox>
        </MockChatBubble>
      </MockSection>

      {/* ═════════════════════════════════════════════════════════════════
          6. Inline artifact sandbox preview (claude.ai parity)
         ═════════════════════════════════════════════════════════════════ */}
      <h2 style={{ fontSize: 16, color: 'var(--cm-accent, #58a6ff)', marginTop: 48, marginBottom: 16 }}>
        6 · Inline artifact sandbox preview — claude.ai parity (task #300)
      </h2>

      <section
        style={{
          marginBottom: 48,
          paddingBottom: 32,
          borderBottom: '1px solid var(--cm-border, #30363d)',
        }}
      >
        <p style={{ color: 'var(--cm-text-muted, #8b949e)', fontSize: 13, lineHeight: 1.6, maxWidth: 900 }}>
          When the assistant produces a renderable artifact (HTML / SVG / Mermaid / React / Python plot),
          codemode docks a live preview on the right side of the layout. Re-prompts hot-swap the panel content
          without flicker. iframe sandboxed (<code>sandbox="allow-scripts"</code>, no <code>same-origin</code>).
          Mock below shows the SVG case mid-stream and a follow-up "make it bigger" hot-swap.
        </p>

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            alignItems: 'stretch',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 8,
            overflow: 'hidden',
            backgroundColor: 'var(--cm-bg, #0d1117)',
          }}
        >
          {/* Left: chat transcript with the request */}
          <div style={{ padding: 16, borderRight: '1px solid var(--cm-border, #30363d)' }}>
            <div
              style={{
                display: 'inline-block',
                backgroundColor: 'rgba(88,166,255,0.10)',
                color: 'var(--cm-accent, #58a6ff)',
                padding: '4px 10px',
                borderRadius: 12,
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 12,
                marginBottom: 12,
              }}
            >
              build me an animated SVG hello-world button
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <div style={{ color: 'var(--cm-accent, #58a6ff)', fontSize: 14, paddingTop: 4 }}>●</div>
              <div style={{ flexGrow: 1, color: 'var(--cm-text, #e6edf3)', fontSize: 13, lineHeight: 1.6 }}>
                Here's an animated SVG button. Hovering scales it up; clicking triggers a small bounce.
                Open the preview pane on the right to interact.
                <div
                  style={{
                    marginTop: 12,
                    backgroundColor: 'var(--cm-bg-secondary, #161b22)',
                    border: '1px solid var(--cm-border, #30363d)',
                    padding: '6px 10px',
                    borderRadius: 6,
                    fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                    fontSize: 11,
                    color: 'var(--cm-text-muted, #8b949e)',
                  }}
                >
                  📎 artifact: <span style={{ color: 'var(--cm-accent, #58a6ff)' }}>svg-hello-button</span>
                  &nbsp;· streaming · 312 / ~480 chars
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: 16,
                fontSize: 11,
                color: 'var(--cm-text-muted, #8b949e)',
                fontStyle: 'italic',
              }}
            >
              ◀ chat pane (left)
            </div>
          </div>

          {/* Right: artifact panel */}
          <div style={{ padding: 0, backgroundColor: '#0a0e13' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderBottom: '1px solid var(--cm-border, #30363d)',
                backgroundColor: 'var(--cm-bg, #0d1117)',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--cm-accent, #58a6ff)' }}>●</span>
              <span style={{ color: 'var(--cm-text, #e6edf3)' }}>svg-hello-button</span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--cm-bg, #0d1117)',
                  backgroundColor: '#7ee787',
                  padding: '1px 6px',
                  borderRadius: 8,
                  fontWeight: 600,
                }}
              >
                STREAMING
              </span>
              <span style={{ flexGrow: 1 }} />
              <button
                style={{
                  background: 'transparent',
                  border: '1px solid var(--cm-border, #30363d)',
                  color: 'var(--cm-text-muted, #8b949e)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                view source
              </button>
              <button
                style={{
                  background: 'transparent',
                  border: '1px solid var(--cm-border, #30363d)',
                  color: 'var(--cm-text-muted, #8b949e)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                padding: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 280,
                backgroundColor: '#fff',
              }}
            >
              {/* The mocked SVG artifact */}
              <svg width="200" height="80" viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#58a6ff" />
                    <stop offset="100%" stopColor="#bc8cff" />
                  </linearGradient>
                </defs>
                <rect x="10" y="10" width="180" height="60" rx="30" fill="url(#g)">
                  <animate
                    attributeName="opacity"
                    values="0.85;1;0.85"
                    dur="2s"
                    repeatCount="indefinite"
                  />
                </rect>
                <text
                  x="100"
                  y="48"
                  textAnchor="middle"
                  fill="white"
                  fontFamily="Inter, system-ui, sans-serif"
                  fontWeight="600"
                  fontSize="20"
                >
                  Hello World 👋
                </text>
              </svg>
            </div>
            <div
              style={{
                padding: '6px 12px',
                borderTop: '1px solid var(--cm-border, #30363d)',
                backgroundColor: 'var(--cm-bg, #0d1117)',
                fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                fontSize: 10,
                color: 'var(--cm-text-muted, #8b949e)',
                display: 'flex',
                gap: 12,
              }}
            >
              <span>iframe sandbox="allow-scripts"</span>
              <span>·</span>
              <span>kind: svg</span>
              <span>·</span>
              <span>id: svg-hello-button</span>
              <span style={{ flexGrow: 1 }} />
              <span style={{ fontStyle: 'italic' }}>artifact panel (right) ▶</span>
            </div>
          </div>
        </div>

        <p
          style={{
            marginTop: 24,
            color: 'var(--cm-text-muted, #8b949e)',
            fontSize: 13,
            lineHeight: 1.6,
            maxWidth: 900,
          }}
        >
          <strong style={{ color: 'var(--cm-text, #e6edf3)' }}>Hot-swap behavior:</strong> when the user
          asks "change the color to blue", the next assistant turn streams a new artifact with the
          same <code>artifactId</code> (svg-hello-button); the panel re-renders the iframe content in place
          with no scroll-jump or unmount flash. State (focus, scroll position) is preserved where the
          DOM allows. For React artifacts, the inner React root reconciles; for SVG/HTML/Mermaid, the
          iframe srcdoc is replaced atomically. For Python (Pyodide), the kernel persists across
          re-renders and only the displayed output replaces.
        </p>
      </section>

      {/* Tail note */}
      <footer
        style={{
          marginTop: 48,
          padding: 24,
          backgroundColor: 'var(--cm-bg, #0d1117)',
          border: '1px solid var(--cm-border, #30363d)',
          borderRadius: 8,
          maxWidth: 1500,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--cm-accent, #58a6ff)' }}>
          What's still TBD in this mock
        </h3>
        <ul
          style={{
            margin: '12px 0 0 16px',
            padding: 0,
            color: 'var(--cm-text-muted, #8b949e)',
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          <li>
            Categories 4 (modal-replacement: <code>/agents</code>, <code>/hooks</code>,{' '}
            <code>/memory</code>, <code>/plan</code>, <code>/save</code>, <code>/system</code>,{' '}
            <code>/task</code>, <code>/stats</code>, <code>/debug</code>) and 5 (client-only:{' '}
            <code>/clear</code>, <code>/theme</code>, <code>/sounds</code>, <code>/copy</code>,{' '}
            <code>/logout</code>, <code>/effort</code>) are stub-able once the patterns above are approved
            — they reuse the same <code>MockBox</code>/<code>MockText</code>/<code>MockFocusRow</code> primitives.
          </li>
          <li>
            Real TUI screenshots (PNG) for the LEFT column. Currently using monospace text rendition.
            Easy to swap once we capture them via <code>script -c "openagentic" /tmp/tui.log</code> + ANSI-to-image.
          </li>
          <li>
            Color palette tuning. The mock uses GitHub Dark colors via the existing{' '}
            <code>--cm-*</code> CSS variables; if the theme should diverge from the rest of codemode,
            now is the time.
          </li>
        </ul>
      </footer>
    </main>
  </div>
);

export default SlashMocksPage;
