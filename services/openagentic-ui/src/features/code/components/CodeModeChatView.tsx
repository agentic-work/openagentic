import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { motion } from 'framer-motion';
import { Sparkles, Plus } from '@/shared/icons';
import { CodemodeFooterModelPill } from './CodemodeFooterModelPill';
import { useAuth } from '@/app/providers/AuthContext';
import { useCodeModeChat } from '../hooks/useCodeModeChat';
import { usePermissionMode } from '../hooks/usePermissionMode';
import { PermissionsProvider } from '../state/PermissionsContext';
import { shouldSendModeOverride } from '../permissionModeReconciler';
import { usePromptHistory } from '../hooks/usePromptHistory';
import {
  useTurnCompleteSound,
  getSoundsEnabled,
  setSoundsEnabled,
} from '../hooks/useTurnCompleteSound';
import { formatFooterModeShort, type PermissionMode } from '../permissionMode';
import { MessageRow } from './chat-messages/MessageTree';
import { InkDomViewContext } from './InkDomView';
import { deriveCurrentTodos } from '../utils/deriveCurrentTodos';
import { enrichTodos, type EnrichedTodo } from '../utils/enrichTodos';
import { buildPopoutUrl } from '../utils/popoutUrl';
import { ConnectionDot } from './ConnectionDot';
import { OpenAgenticWordmark } from '@/shared/components/OpenAgenticWordmark';
import { ActiveTaskBar } from './ActiveTaskBar';
import { CodeModeBanner } from './CodeModeBanner';
import { CodeModeRule } from './CodeModeRule';
import type { TodoItem } from '@/stores/useCodeModeStore';
import {
  SlashCommandPalette,
  type SlashCommandPaletteHandle,
} from './chat-messages/SlashCommandPalette';
import { findSlashCommand, commandsFromDaemonNames, commandsFromSkillNames } from '../slashCommands';
import { ThemePicker } from './chat-messages/ThemePicker';
import { ThemeSelectorPill } from './chat-messages/ThemeSelectorPill';
import { PermissionDialog } from './chat-messages/PermissionDialog';
import { SessionInfoModal, type ListItem } from './chat-messages/SessionInfoModal';
import { apiEndpoint } from '@/utils/api';
import { DaemonRPCContext } from '../hooks/useDaemonRPC';
import { useDaemonRPCBridge } from '../../../codemode/state/daemonRPCBridge';
import { SkillsPicker } from './pickers/SkillsPicker';
import { PluginsPicker } from './pickers/PluginsPicker';
import { ModelPicker } from './pickers/ModelPicker';
import { MCPPicker } from './pickers/MCPPicker';
import { AgentsPicker } from './pickers/AgentsPicker';

/**
 * Phase 4 of the codemode-bridge plan replaces the screen-blocking
 * `PermissionDialog` modal with an inline approval card mounted at the
 * end of the streaming assistant message — see
 * `chat-messages/InlinePermissionCard.tsx`. The legacy modal is kept
 * import-reachable via this dev-toggle so we can A/B compare under
 * `?cm-permission-modal=1` without redeploying. Default behavior is the
 * inline card.
 */
function devPermissionModalEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('cm-permission-modal') === '1';
  } catch {
    return false;
  }
}
import {
  CompactModal,
  DebugModal,
  HelpModal,
  HooksModal,
  MemoryModal,
  PlanModal,
  ResumeModal,
  SaveModal,
  SystemPromptModal,
  TaskModal,
  VersionModal,
} from './chat-messages/CommandModals';
import { StatsModal } from './chat-messages/StatsModal';
import { StatusModal as StatusSettingsModal } from './chat-messages/StatusModal';
import {
  MCPModal,
  ToolsModal,
  PluginsModal,
  SkillsModal,
  AgentsModal,
  ConfigModal,
  PermissionsModal,
} from './chat-messages/RichModals';
import { detectDevServerUrl } from './PreviewPanel';
import { CodeModeStatusLine } from './CodeModeStatusLine';
// CodemodeModelPill removed — model is /model-only per Plan P5.

interface CodeModeChatViewProps {
  sessionId: string | null;
  authToken?: string;
  className?: string;
}

export const CodeModeChatView: React.FC<CodeModeChatViewProps> = ({
  sessionId,
  authToken,
  className,
}) => {
  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    clear,
    cancel,
    contextTokens,
    compactionFlash,
    model,
    fastMode,
    totalCostUsd,
    totalOutputTokens,
    lastTurnMs,
    pendingPermission,
    respondToPermission,
    sendControl,
    sessionMeta,
    inkDomViews,
    sendUiEvent,
    activePicker,
    closePicker,
    daemonRPC,
  } = useCodeModeChat({
    sessionId,
    authToken,
  });

  // A.9 — Push daemonRPC.call into the zustand bridge so FilePanel
  // (mounted ABOVE this component in ChatContainer) can reach it without
  // lifting the WS or provider up the tree.
  //
  // A.15 — Split set-on-update from clear-on-unmount. The previous shape
  // had its cleanup wipe bridge.call to null on EVERY dep change (e.g.,
  // when WS reconnects re-create daemonRPC.call). That window of null
  // caused FileTreeSection to render its "Daemon RPC not yet available"
  // error mid-session even though chat was healthy. Now we only ever
  // clear the bridge when CodeModeChatView fully unmounts.
  const setBridgeCall = useDaemonRPCBridge((s) => s.setCall);
  useEffect(() => {
    if (daemonRPC.call) setBridgeCall(daemonRPC.call);
  }, [daemonRPC.call, setBridgeCall]);
  useEffect(() => {
    return () => setBridgeCall(null);
  }, [setBridgeCall]);

  // A.14 — Push user-scoped cwd into the bridge so FileTreeSection
  // can request the correct workspace root (/workspaces/<userId>) instead
  // of the hardcoded /workspaces that canonicalizeUnderRoot rejects.
  // Same split-cleanup pattern as the call channel above.
  const setBridgeCwd = useDaemonRPCBridge((s) => s.setCwd);
  useEffect(() => {
    if (sessionMeta?.cwd) setBridgeCwd(sessionMeta.cwd);
  }, [sessionMeta?.cwd, setBridgeCwd]);
  useEffect(() => {
    return () => setBridgeCwd(null);
  }, [setBridgeCwd]);

  // Phase E (codemode-permanent-plan §4): provide an `InkDomViewContext`
  // around the message tree so any `<InkDomView viewId={...} />` rendered
  // by `Part.tsx` for an `inkdom_view` block can read its vdom snapshot
  // and emit `ui_event` frames back over the chat WS. The value is
  // memoized so unrelated re-renders don't churn the context.
  const inkDomViewContextValue = React.useMemo(
    () => ({
      getView: (viewId: string) => inkDomViews[viewId],
      sendUiEvent,
    }),
    [inkDomViews, sendUiEvent],
  );
  // Derive current todos from the latest TodoWrite tool_use in the
  // transcript. Claude code CLI (PTY) shows a persistent task panel pinned
  // above the input that updates as the assistant calls TodoWrite with
  // updated statuses. We pull the input of the LAST TodoWrite tool_use
  // across all assistant messages — that represents the current state.
  // Use the shared helper — it walks Task sub-blocks AND falls back to
  // tryParseInput(partialInputJson) so live streaming Todo updates land
  // BEFORE the block fully closes (was causing "stuck panel" UX).
  const currentTodos: TodoItem[] = React.useMemo(() => {
    const raw = deriveCurrentTodos(messages);
    return raw.map((t, i) => ({
      id: (t.id as string | number | undefined) || `todo-${i}`,
      content: String(t.content ?? ''),
      activeForm: t.activeForm ? String(t.activeForm) : undefined,
      status: (t.status === 'in_progress' || t.status === 'completed') ? t.status : 'pending',
    } as TodoItem));
  }, [messages]);

  // Deep-viz enrichment: parent todos get a live timer + cumulative
  // tokens, with subtask attribution from non-Todo tool_use blocks
  // that ran while each todo was in_progress. Now-arg uses Date.now()
  // so durationMs is fresh on every re-render (the 1s tick inside
  // ActiveTaskBar drives that).
  const enrichedTodos: EnrichedTodo[] = React.useMemo(
    () => enrichTodos(messages, Date.now()),
    [messages],
  );

  // Daemon-supplied slash commands (built-in + plugin-supplied) come
  // through `system/init` as `slash_commands: string[]`. The static
  // SLASH_COMMANDS registry only knows about built-ins compiled into
  // the UI bundle — plugin-installed commands like
  // `superpowers:test-driven-development` only appear here. After
  // /reload-plugins fires post-install, sessionMeta refreshes with
  // the new plugin commands.
  //
  // 2026-05-02: user reported "loaded plugins don't show in slash
  // after install". Cause: SlashCommandPalette only read the static
  // registry. Now it merges these synthetics so plugin commands
  // surface in the palette as the user types `/`.
  const daemonExtraCommands = React.useMemo(
    () => [
      ...commandsFromDaemonNames(sessionMeta?.slashCommands ?? []),
      // 2026-05-06: surface plugin skills (e.g. brainstorming,
      // test-driven-development, systematic-debugging from superpowers)
      // as virtual slash commands so /brain, /test, /debug autocompletes
      // match without forcing the user to open the /skills picker.
      // Parity with openagentic/Claude Code TUI's slash UX.
      ...commandsFromSkillNames(sessionMeta?.skills ?? []),
    ],
    [sessionMeta?.slashCommands, sessionMeta?.skills],
  );

  const { mode, config: modeConfig, cycle: cyclePermissionMode, setMode: setPermissionMode } = usePermissionMode(sessionId);
  const history = usePromptHistory(sessionId);

  // CodeModeRule's elapsed timer starts the first time we see a
  // sessionMeta (system/init) come through. The wire doesn't carry a
  // `started_at` field, so we capture it on the UI side. The ref pin
  // means subsequent re-renders don't reset the start (which would
  // cause the elapsed counter to flicker back to 0s).
  const sessionStartedAtRef = useRef<number | null>(null);
  if (sessionStartedAtRef.current === null && sessionMeta) {
    sessionStartedAtRef.current = Date.now();
  }
  const sessionStartedAtMs = sessionStartedAtRef.current ?? undefined;

  // Push mode changes live to the exec-pod CLI so the currently-running
  // daemon picks up the new permission mode for subsequent tool calls.
  //
  // Bug #195 (audit 2026-05-04): the previous "skip first render"
  // branch silently swallowed the case where localStorage restored the
  // chip to (say) `default` while the daemon was still in its boot
  // mode `bypassPermissions` — Write went through unprompted because
  // the daemon never received the override. Replaced with the pure
  // `shouldSendModeOverride` reconciler that compares against the
  // daemon's reported `sessionMeta.permissionMode` (from system/init).
  const lastSentModeRef = useRef<string | null>(null);
  const daemonMode = sessionMeta?.permissionMode;
  useEffect(() => {
    if (!sessionId) return;
    if (
      !shouldSendModeOverride({
        localMode: mode,
        daemonMode,
        lastSentMode: lastSentModeRef.current,
      })
    ) {
      // Even when we don't send, mark this mode as "agreed" so a
      // subsequent matching change doesn't re-fire. The reconciler's
      // `lastSentMode === localMode` short-circuit relies on this.
      if (daemonMode && mode === daemonMode) {
        lastSentModeRef.current = mode;
      }
      return;
    }
    lastSentModeRef.current = mode;
    void sendControl({
      type: 'control_request',
      request_id: `pm-${Date.now()}`,
      request: { subtype: 'set_permission_mode', mode },
    });
  }, [mode, sessionId, sendControl, daemonMode]);
  // Play a chime when a turn completes. Toggled via localStorage —
  // hidden toggle for now, exposed via /sounds slash command below.
  useTurnCompleteSound(isStreaming);

  const { user, logout } = useAuth();
  const displayName = user?.name || user?.email?.split('@')[0] || 'user';
  const [soundsOn, setSoundsOn] = useState<boolean>(getSoundsEnabled);

  // Lightweight slash-command toast. Used for client-side commands that
  // don't have a dedicated modal yet (e.g. /effort, /memory-stub, /logout
  // confirmations) and for ack-only server-side dispatches. Auto-clears
  // after ~2.5s. Matches openagentic's one-line status banner pattern.
  const [slashToast, setSlashToast] = useState<string | null>(null);
  const slashToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showSlashToast = useCallback((msg: string) => {
    setSlashToast(msg);
    if (slashToastTimer.current) clearTimeout(slashToastTimer.current);
    slashToastTimer.current = setTimeout(() => setSlashToast(null), 2500);
  }, []);
  useEffect(() => () => {
    if (slashToastTimer.current) clearTimeout(slashToastTimer.current);
  }, []);

  // Send a slash command to openagentic as a server-side control_request.
  // openagentic natively handles /compact, /cost, /status, /resume,
  // /context, /exit, /continue — they print their output into the
  // transcript stream, no local modal needed. We still show a toast so
  // the user has immediate UI feedback while the request is in flight.
  const sendServerSlashCommand = useCallback(
    (subtype: string, label?: string) => {
      void sendControl({
        type: 'control_request',
        request_id: `sc-${subtype}-${Date.now()}`,
        request: { subtype },
      });
      showSlashToast(label ?? `/${subtype} sent`);
    },
    [sendControl, showSlashToast],
  );

  // #56: detect dev-server URLs in tool results so the layout can
  // auto-open the Preview panel when e.g. `npm run dev` spins up.
  const [detectedPreviewUrl, setDetectedPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role !== 'assistant') continue;
      for (const b of (m as any).blocks ?? []) {
        if (b.kind === 'tool_use' && b.result?.text) {
          const url = detectDevServerUrl(b.result.text);
          if (url && url !== detectedPreviewUrl) {
            setDetectedPreviewUrl(url);
            return;
          }
        }
      }
    }
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const [input, setInput] = useState('');
  type ModalId = 'theme' | 'tools' | 'mcp' | 'agents' | 'skills' | 'plugins' | 'permissions' | 'config' | 'compact' | 'debug' | 'hooks' | 'help' | 'memory' | 'plan' | 'resume' | 'save' | 'system' | 'task' | 'version' | 'status' | 'stats' | null;
  const [openModal, setOpenModal] = useState<ModalId>(null);

  /**
   * Smart command dispatcher for modals. Intercepts known action patterns
   * and routes them through the control_request API instead of sending as
   * slash command text (which would hit the bridge allowlist and fail for
   * local-jsx commands). Display-only commands open the corresponding modal.
   */
  const handleModalCommand = useCallback((cmd: string) => {
    // Plugin actions → control_request
    const pluginInstall = cmd.match(/^\/plugin\s+install\s+(\S+)@(\S+)/);
    if (pluginInstall) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'install_plugin', pluginId: pluginInstall[1], marketplaceName: pluginInstall[2], scope: 'user' },
      });
      return;
    }
    const pluginToggle = cmd.match(/^\/plugin\s+(enable|disable)\s+(\S+)/);
    if (pluginToggle) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'plugin_toggle', pluginId: pluginToggle[2], enabled: pluginToggle[1] === 'enable' },
      });
      return;
    }
    const pluginUninstall = cmd.match(/^\/plugin\s+uninstall\s+(\S+)/);
    if (pluginUninstall) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'uninstall_plugin', pluginId: pluginUninstall[1], scope: 'user' },
      });
      return;
    }
    // Reload plugins → control_request
    if (/^\/reload-plugins\b/.test(cmd)) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'reload_plugins' },
      });
      return;
    }
    // MCP actions → control_request
    const mcpToggle = cmd.match(/^\/mcp\s+(enable|disable)\s+(\S+)/);
    if (mcpToggle) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'mcp_toggle', serverName: mcpToggle[2], enabled: mcpToggle[1] === 'enable' },
      });
      return;
    }
    const mcpReconnect = cmd.match(/^\/mcp\s+reconnect(?:\s+(\S+))?/);
    if (mcpReconnect) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'mcp_reconnect', serverName: mcpReconnect[1] ?? '' },
      });
      return;
    }
    // Permission mode → control_request
    const permMode = cmd.match(/^\/permissions\s+(default|acceptEdits|bypassPermissions|plan)/);
    if (permMode) {
      void sendControl({
        type: 'control_request',
        request_id: `cr-${Date.now()}`,
        request: { subtype: 'set_permission_mode', mode: permMode[1] },
      });
      return;
    }
    // Display-only modals → open locally, no bridge round-trip
    // Codemode v0.6.7: /model is no longer a user-facing command. The
    // active model is admin-configured and enforced server-side —
    // see routes/openagentic.ts :: /v1/messages. Removed from the
    // modal map so typing /model falls through to the "unknown
    // slash command" handler downstream.
    const modalMap: Record<string, ModalId> = {
      '/plugins': 'plugins', '/plugin': 'plugins', '/marketplace': 'plugins',
      '/mcp': 'mcp', '/tools': 'tools', '/skills': 'skills',
      '/agents': 'agents', '/config': 'config', '/permissions': 'permissions',
    };
    const baseCmd = cmd.split(/\s/)[0];
    if (baseCmd && modalMap[baseCmd] && cmd.trim() === baseCmd) {
      setOpenModal(modalMap[baseCmd]);
      return;
    }
    // Everything else: send as regular message through the bridge
    void sendMessage(cmd, { permissionMode: mode });
  }, [sendControl, sendMessage, mode, setOpenModal]);

  // Codemode v0.6.7: model is enforced server-side (routes/openagentic.ts)
  // from SystemConfiguration.awcode.defaultModel → DEFAULT_CODE_MODEL →
  // platform default. The UI no longer overrides it. We keep a
  // display-only `adminDefaultModel` so the chip shows the real model
  // name; it's read from /api/chat/models.codemodeDefault (the same
  // field that drives the server resolution).
  const [adminDefaultModel, setAdminDefaultModel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers.Authorization = `Bearer ${authToken}`;
        const r = await fetch('/api/chat/models', { headers });
        if (!r.ok) return;
        const data = await r.json().catch(() => null);
        const fromAdmin = (data?.codemodeDefault ?? null) as string | null;
        if (cancelled || !fromAdmin || typeof fromAdmin !== 'string') return;
        setAdminDefaultModel(fromAdmin);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [authToken]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<SlashCommandPaletteHandle>(null);

  /**
   * Called when the user picks a command from the slash palette.
   * Recognized zero-arg / modal commands dispatch immediately
   * (/theme, /model, /clear, /help, etc.). Commands that take args
   * (/memory, /context <opts>) just insert `/<name> ` into the
   * textarea so the user can finish typing.
   */
  const handleSlashSelect = (name: string) => {
    // Try local dispatch first — if dispatch handles it, clear the
    // input and we're done.
    const full = `/${name}`;
    if (dispatchSlashCommand(full)) {
      history.push(full);
      setInput('');
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    // Otherwise: if the command is registered with NO `args` field, it
    // takes no arguments and should submit to the daemon now. Inserting
    // `/<name> ` and waiting causes a "stuck on Enter" loop because the
    // palette stays open and Enter just re-fires commit() on the same
    // selection. Only insert-and-wait for commands that actually need
    // user input (e.g. `/add-dir <path>`, `/effort [low|medium|...]`).
    //
    // Picker commands (/skills, /plugin, /mcp) declare `args` for help
    // text BUT the picker is the args UI — so submit immediately so the
    // browser-side interceptor in useCodeModeChat can catch the slash
    // and open the React overlay. Without this branch, palette would
    // insert `/plugin ` and wait, defeating the user's "press Enter to
    // open" intent (observed live on chat-dev 2026-04-29).
    const cmd = findSlashCommand(name);
    if (cmd && (!cmd.args || cmd.picker)) {
      history.push(full);
      setInput('');
      void sendMessage(full, { permissionMode: mode });
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    // Plugin commands (e.g. `superpowers:brainstorming`) and plugin
    // skills aren't in the static SLASH_COMMANDS registry — they're
    // surfaced via daemonExtraCommands. They take no typed args; the
    // user activates them by Enter on the picker row. User feedback
    // 2026-05-06: "i see brainstoring but I cant actrivate it" — the
    // old fallthrough inserted `/superpowers:brainstorming ` into the
    // textarea and waited, which felt broken because nothing happened
    // after the autocomplete. Now: if the chosen command lives in
    // daemonExtraCommands, send it immediately like the built-in
    // no-args branch above.
    const isDaemonExtra = daemonExtraCommands.some((c) => c.name === name);
    if (isDaemonExtra) {
      history.push(full);
      setInput('');
      void sendMessage(full, { permissionMode: mode });
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    setInput(`/${name} `);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const len = `/${name} `.length;
      textareaRef.current?.setSelectionRange(len, len);
    });
  };

  /**
   * Input prefix mode — openagentic's TUI convention:
   *   `!cmd`  → bash pass-through (runs command directly)
   *   `#text` → appended to persistent memory
   *   `/cmd`  → slash command
   *   default → normal LLM chat
   * We show a matching mode pill above the input so the user knows
   * their prefix was recognized, same as the TUI's bash-mode indicator.
   */
  type InputMode = 'chat' | 'bash' | 'memory' | 'slash';
  const inputMode: InputMode = input.startsWith('!')
    ? 'bash'
    : input.startsWith('#')
      ? 'memory'
      : input.startsWith('/')
        ? 'slash'
        : 'chat';

  // Auto-scroll to bottom as content streams in. Two triggers:
  //   1. useEffect on messages — fires when a new message is appended
  //      OR when block content within the latest assistant message
  //      mutates (we include the last block count as a dep signal).
  //   2. ResizeObserver on the transcript inner container — fires
  //      whenever the rendered content grows (text_delta stream,
  //      tool_use becoming tool_result, plan mode writing a file
  //      diff, etc.). This covers in-place block mutations that
  //      the messages dep alone can miss.
  // Both respect atBottomRef: if the user has manually scrolled up
  // more than 100px from the bottom, we stop following so they can
  // read earlier output. Threshold is 100px (was 40px) to tolerate
  // minor scroll wobbles from inline code-block renders.
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      atBottomRef.current = distFromBottom < 100;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Trigger on messages changes. Signal derived from last message's
  // block count so in-place .blocks.push still re-runs this.
  const lastBlockCount = messages.length > 0
    ? (messages[messages.length - 1] as any)?.blocks?.length ?? 0
    : 0;
  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, lastBlockCount]);

  // Content-follow: pin the viewport to the bottom whenever rendered
  // content grows. The scroll container's children are the messages
  // themselves (one DIV per user/assistant message — no single inner
  // wrapper), so we observe ALL current children with a single
  // ResizeObserver and re-attach the observer when the child list
  // changes (new messages added). Streaming text deltas grow the
  // assistant message in place; the per-child ResizeObserver catches
  // those without depending on block-count or messages-length deps.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasRO = typeof ResizeObserver !== 'undefined';
    const hasMO = typeof MutationObserver !== 'undefined';

    const followToBottom = () => {
      if (atBottomRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    };

    let ro: ResizeObserver | null = null;
    if (hasRO) {
      ro = new ResizeObserver(followToBottom);
      const observeAll = () => {
        ro!.disconnect();
        for (const child of Array.from(el.children)) {
          ro!.observe(child as Element);
        }
      };
      observeAll();
      // Re-observe when the messages list itself adds/removes children.
      let mo: MutationObserver | null = null;
      if (hasMO) {
        mo = new MutationObserver(() => {
          observeAll();
          followToBottom();
        });
        mo.observe(el, { childList: true });
      }
      return () => {
        ro?.disconnect();
        mo?.disconnect();
      };
    }

    // Fallback for environments without ResizeObserver: use
    // MutationObserver on the subtree to catch any descendant change
    // (slower / chattier but functionally equivalent for our needs).
    if (hasMO) {
      const mo = new MutationObserver(followToBottom);
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      return () => mo.disconnect();
    }
    return undefined;
  }, []);

  // Auto-grow the textarea as the user types (up to ~6 rows), shrinks
  // back when content is cleared.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  /**
   * Client-side slash command dispatcher. Handles the p0 commands
   * that don't require a backend round-trip (1:1 with openagentic's
   * in-TUI handling of /clear, /help, /cost, /context, /exit, /theme,
   * etc.). Unknown slash commands fall through to the LLM so the
   * agent can handle them as instructions — matching openagentic's
   * "send unrecognized command as prompt" fallback.
   *
   * Returns true if the command was handled locally (input should be
   * cleared, history pushed), false to continue to the LLM.
   */
  const dispatchSlashCommand = (text: string): boolean => {
    const m = text.match(/^\/([a-zA-Z][a-zA-Z0-9_-]*)(?:\s+(.*))?$/);
    if (!m) return false;
    const name = m[1].toLowerCase();
    const args = (m[2] ?? '').trim();

    switch (name) {
      case 'clear':
      case 'reset':
      case 'new':
        clear();
        return true;

      case 'exit':
      case 'quit':
        // Openagentic's /exit closes the REPL. In browser context we
        // forward the intent to the daemon (which gracefully ends the
        // session) AND clear the local transcript. See
        // sendServerSlashCommand above.
        sendServerSlashCommand('exit', 'session exit requested');
        clear();
        return true;

      case 'help':
        // /help — open the local Help modal listing the SLASH_COMMANDS
        // registry. Phase 0 (commit d621f370) ripped /help from the api
        // slash-dispatcher (only /exit + /clear remain) and the daemon's
        // headless slash dispatch isn't yet wired in remote-session mode
        // (Phase 1, companion repo). Without this case /help fell through
        // to the daemon and emitted nothing — captured 2026-05-02 in
        // tui-vs-codemode-diff.report.md as a high-severity gap.
        setOpenModal('help');
        return true;

      // /cost and /context fall through to the daemon's headless slash
      // dispatcher — both upstream commands are type:'local' with
      // supportsNonInteractive=true. The dispatcher (cli/print.ts +
      // headlessSlashDispatch.ts) parses the slash text, runs the
      // command's call(args) directly, and emits the output as a
      // streaming assistant turn. Routing them via control_request
      // here was a dead path: openagentic's bridgeHandle has no `cost`
      // or `context` subtype handler, so the daemon replied with
      // "Unsupported control request subtype: cost" instead of the
      // actual cost report. See task #382.

      case 'theme':
        // /theme — open the local theme picker modal (lives in
        // chat-messages/ThemePicker.tsx). Applies immediately via
        // the shared cm-theme localStorage key.
        setOpenModal('theme');
        return true;

      case 'effort': {
        // /effort <low|medium|high|max|auto> — forwards the reasoning
        // effort preference to the daemon via control_request. No local
        // modal yet (admin-only knob today), so we surface a toast so
        // users know the request was dispatched.
        const level = args || 'auto';
        void sendControl({
          type: 'control_request',
          request_id: `sc-effort-${Date.now()}`,
          request: { subtype: 'set_effort', level },
        });
        showSlashToast(`effort: ${level}`);
        return true;
      }

      case 'logout': {
        // /logout — sign out of OpenAgentic entirely. We use the shared
        // AuthContext logout which tears down the session cookie,
        // clears localStorage, and redirects to /login.
        showSlashToast('signing out…');
        void logout();
        return true;
      }

      case 'sounds': {
        // /sounds — toggle audible turn-complete chime. Custom
        // command beyond openagentic's standard set (openagentic TUI
        // has no concept of browser audio).
        const next = !soundsOn;
        setSoundsEnabled(next);
        setSoundsOn(next);
        return true;
      }

      case 'stats':
        setOpenModal('stats');
        return true;

      // RichModal triggers — modals were JSX-mounted (openModal === '<name>')
      // but had no dispatchSlashCommand cases, so typing /<command> fell
      // through to sendMessage and routed to the daemon's brittle InkVdom
      // JSX bridge instead of the React modal. Audit 2026-04-30 flagged
      // these as "mounted but trigger unclear".
      //
      // Bare `/<command>` opens the corresponding modal locally — no WS
      // user frame is sent. Argument forms either fall through to the
      // daemon (memory/plan/version/resume don't take args here) or are
      // intercepted by handleModalCommand for control_request semantics
      // (/permissions <mode>, /config <key>=<val>).
      case 'permissions':
      case 'allowed-tools':
        if (!args) {
          setOpenModal('permissions');
          return true;
        }
        // /permissions <mode> — forward to control_request via the
        // existing handleModalCommand path so the live mode actually
        // changes server-side. Without this, typing /permissions plan
        // directly would hit the daemon as a chat message.
        if (/^(default|acceptEdits|bypassPermissions|plan)\b/.test(args)) {
          handleModalCommand(`/permissions ${args}`);
          return true;
        }
        return false;

      case 'plan':
        // Bare /plan opens the plan-management modal (read-only switcher
        // for plan permission mode + a brief explainer). The modal's
        // toggle button calls back into the chat to fire `/plan` or
        // `/plan off` through sendMessage if the user wants the daemon
        // to enter/exit plan mode end-to-end. Args fall through.
        if (!args) {
          setOpenModal('plan');
          return true;
        }
        return false;

      case 'memory':
        // Bare /memory opens the memory-actions modal. Args (e.g.
        // `/memory edit`, `/memory <text>`) fall through to the daemon
        // — openagentic's command handler resolves them server-side.
        if (!args) {
          setOpenModal('memory');
          return true;
        }
        return false;

      case 'config':
      case 'settings':
        // Bare /config opens the Configuration RichModal (session
        // settings + resource overview). Args are not recognized at
        // this layer — fall through to the daemon which can either
        // handle them or reply with help text.
        if (!args) {
          setOpenModal('config');
          return true;
        }
        return false;

      case 'version':
        // /version is read-only — don't pollute the transcript with a
        // daemon round-trip. The modal renders openagenticVersion +
        // model + permissionMode + sessionId from sessionMeta.
        setOpenModal('version');
        return true;

      case 'status':
        // /status — open the local Status / Config / Usage tabbed
        // modal (chat-messages/StatusModal.tsx). TUI parity audit
        // 2026-05-02 (tui-vs-codemode-diff.report.md) captured an
        // empty assistant turn for /status because dispatch had no
        // case. The modal was already mounted under
        // openModal === 'status'; we just needed to trigger it.
        setOpenModal('status');
        return true;

      case 'resume':
      case 'continue':
        // Bare /resume opens the resume modal (button-driven UX —
        // session-id is not a typed slash arg here). If the user
        // somehow types `/resume <id>` directly, fall through to the
        // daemon which handles session resolution.
        if (!args) {
          setOpenModal('resume');
          return true;
        }
        return false;

      case 'compact':
        // /compact [summary-args] — compaction is a daemon-side action.
        // Args are optional ([summary-args]) so handleSlashSelect's
        // "has args → insert and wait" path causes a popup loop where
        // each Enter just commits the same selection. Intercept here so
        // the slash text submits cleanly, with or without args. The
        // daemon's slash dispatcher runs the actual compaction and
        // emits a summary turn.
        handleModalCommand(args ? `/compact ${args}` : '/compact');
        return true;

      case 'reload-plugins':
        // /reload-plugins — same popup-loop concern as /compact above
        // when (hypothetically) args are added in the future. Today
        // the command is no-args, but routing through handleModalCommand
        // ensures we hit the existing reload_plugins control_request
        // path instead of falling through to a chat-mode passthrough.
        handleModalCommand('/reload-plugins');
        return true;

      case 'copy': {
        // /copy — copy the last assistant message's text blocks to
        // the system clipboard. Falls back to a console warn if the
        // clipboard API is unavailable or denied.
        const lastAssistant = [...messages]
          .reverse()
          .find((m) => m.role === 'assistant');
        if (!lastAssistant || lastAssistant.role !== 'assistant') return true;
        const text = lastAssistant.blocks
          .filter((b) => b.kind === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n\n')
          .trim();
        if (text && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(text).catch(() => {
            console.warn('[CodeMode] /copy: clipboard denied');
          });
        }
        return true;
      }

      // ── pure passthrough commands ─────────────────────────────────
      // Sent to openagentic as-is. No local React UI needed — the
      // server handles them and returns transcript output.
      default:
        return false;
    }
  };

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isStreaming || !sessionId) return;

    // Client-side slash command dispatch — see dispatchSlashCommand.
    if (text.startsWith('/') && dispatchSlashCommand(text)) {
      history.push(text);
      setInput('');
      return;
    }

    history.push(text);
    setInput('');
    // If there are pending image attachments, include them as
    // base64 image blocks alongside the text content.
    const images = pendingImages.length > 0 ? [...pendingImages] : undefined;
    if (images) setPendingImages([]);
    // Codemode is admin-locked to one model — do NOT send a model field.
    // The API ignores it anyway (routes/openagentic.ts) but omitting it
    // keeps the client honest about the contract.
    void sendMessage(text, {
      permissionMode: mode,
      ...(images ? { images } : {}),
    });
  };

  /**
   * Returns true if the textarea caret is on the first visible line
   * (when pressing Up) or the last visible line (when pressing Down).
   * History navigation only triggers from an edge — otherwise Up/Down
   * move the caret within a multi-line draft, matching readline.
   */
  const caretAtEdge = (
    el: HTMLTextAreaElement,
    direction: 'up' | 'down',
  ): boolean => {
    const pos = el.selectionStart ?? 0;
    const value = el.value;
    if (direction === 'up') {
      // Anywhere in the first line counts as "top".
      const firstNewline = value.indexOf('\n');
      if (firstNewline < 0) return true;
      return pos <= firstNewline;
    }
    const lastNewline = value.lastIndexOf('\n');
    if (lastNewline < 0) return true;
    return pos > lastNewline;
  };

  /**
   * Scrollback navigation — routes Ctrl+End / Ctrl+Home / PgUp /
   * PgDn / Ctrl+U / Ctrl+D to the transcript scroll container when
   * the input is empty (so they don't steal arrow/page keys from
   * active editing). Matches openagentic's chat:* scroll bindings.
   */
  const scrollTranscript = (delta: number | 'start' | 'end') => {
    const el = scrollRef.current;
    if (!el) return;
    if (delta === 'start') el.scrollTop = 0;
    else if (delta === 'end') el.scrollTop = el.scrollHeight;
    else el.scrollTop = Math.max(0, Math.min(el.scrollHeight, el.scrollTop + delta));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;

    // Shift+Tab cycles permission mode — matches openagentic's
    // chat:cycleMode binding (src/keybindings/defaultBindings.ts).
    // Order: default → acceptEdits → plan → bypassPermissions → default.
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      cyclePermissionMode();
      return;
    }

    // Scrollback shortcuts — only when input is empty, so they don't
    // hijack editing. Ctrl+End → latest, Ctrl+Home → oldest,
    // PgUp/PgDn → one viewport, Ctrl+U/Ctrl+D → half viewport.
    if (input.length === 0) {
      const viewportH = scrollRef.current?.clientHeight ?? 400;
      if (e.key === 'End' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        scrollTranscript('end');
        return;
      }
      if (e.key === 'Home' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        scrollTranscript('start');
        return;
      }
      if (e.key === 'PageUp') {
        e.preventDefault();
        scrollTranscript(-viewportH);
        return;
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        scrollTranscript(viewportH);
        return;
      }
      if (e.key === 'u' && e.ctrlKey) {
        e.preventDefault();
        scrollTranscript(-viewportH / 2);
        return;
      }
      if (e.key === 'd' && e.ctrlKey) {
        e.preventDefault();
        scrollTranscript(viewportH / 2);
        return;
      }
    }

    // Slash command palette — when the palette is open (input starts
    // with `/` and matches ≥1 command), route arrow keys and Enter to
    // it so the user can pick with the keyboard. Esc closes.
    const palette = paletteRef.current;
    if (palette?.isOpen) {
      if (e.key === 'ArrowDown') {
        if (palette.stepDown()) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'ArrowUp') {
        if (palette.stepUp()) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        if (palette.commit()) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Escape') {
        // Drop the leading slash so the palette closes but keep text
        // the user already typed after any space.
        e.preventDefault();
        const rest = input.replace(/^\/\S*\s?/, '');
        setInput(rest);
        return;
      }
    }

    // Esc / Ctrl+C — interrupt a running turn if one is in flight,
    // otherwise clear the draft. Ctrl+C is suppressed when the user
    // has text selected so normal copy still works. Matches
    // openagentic's chat:cancel binding (1:1).
    const isCtrlC = e.key === 'c' && e.ctrlKey && !e.metaKey;
    if (isCtrlC) {
      const hasSelection = el.selectionStart !== el.selectionEnd;
      const docSelection = typeof window !== 'undefined'
        ? window.getSelection()?.toString()
        : '';
      if (hasSelection || (docSelection && docSelection.length > 0)) {
        return; // let browser handle copy
      }
    }
    if (e.key === 'Escape' || isCtrlC) {
      if (isStreaming) {
        e.preventDefault();
        cancel();
        return;
      }
      if (history.isBrowsing) history.resetBrowse();
      setInput('');
      e.preventDefault();
      return;
    }

    // Up / Down — prompt history navigation (only from edges).
    if (e.key === 'ArrowUp' && caretAtEdge(el, 'up')) {
      const prev = history.stepBack(input);
      if (prev !== null) {
        e.preventDefault();
        setInput(prev);
        // Defer the caret move until after React applies the value.
        requestAnimationFrame(() => {
          el.setSelectionRange(prev.length, prev.length);
        });
      }
      return;
    }
    if (e.key === 'ArrowDown' && caretAtEdge(el, 'down')) {
      const next = history.stepForward();
      if (next !== null) {
        e.preventDefault();
        setInput(next);
        requestAnimationFrame(() => {
          el.setSelectionRange(next.length, next.length);
        });
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  /**
   * Drop out of history browsing on any user edit — matches the
   * TUI's behavior where scrolling up and then typing creates a new
   * draft based on the retrieved entry.
   */
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (history.isBrowsing && e.target.value !== input) {
      history.resetBrowse();
    }
    setInput(e.target.value);
  };

  /**
   * Paste + drop handler — when the user pastes/drops a file into
   * the chat view, read it and inline its contents (or a reference
   * for binary/image files) into the prompt. Matches openagentic's
   * file-attachment behavior roughly 1:1 for text files; images are
   * noted as placeholders until the multi-block stream-json input
   * path ships (task #42 + vision-capable model support).
   */
  // Pending image attachments for the next sendMessage call. Stored
  // as base64 content blocks that get sent alongside the text prompt.
  const [pendingImages, setPendingImages] = useState<
    Array<{ name: string; mediaType: string; base64: string }>
  >([]);

  const handleAttachFiles = async (files: FileList) => {
    const inserts: string[] = [];
    const newImages: typeof pendingImages = [];
    for (let i = 0; i < files.length && i < 5; i++) {
      const f = files[i];
      const name = f.name || 'pasted-file';
      if (f.type.startsWith('text/') || /\.(md|ts|tsx|js|jsx|json|yaml|yml|toml|py|go|rs|sh|sql|css|html|xml)$/i.test(name)) {
        try {
          const text = await f.text();
          const lang = (name.split('.').pop() || '').toLowerCase();
          inserts.push('\n\n```' + lang + ' (' + name + ')\n' + text + '\n```\n');
        } catch {
          inserts.push('\n\n[attachment failed: ' + name + ']\n');
        }
      } else if (f.type.startsWith('image/')) {
        // Convert image to base64 for vision-capable models. The
        // base64 data is stored in pendingImages and sent as part
        // of the next message via a multi-block content array.
        try {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
          const b64 = btoa(binary);
          newImages.push({ name, mediaType: f.type, base64: b64 });
          inserts.push('\n\n[image attached: ' + name + ' (' + Math.round(f.size / 1024) + 'KB)]\n');
        } catch {
          inserts.push('\n\n[image attach failed: ' + name + ']\n');
        }
      } else {
        // Binary files (xlsx, pdf, zip, etc.) — upload to pod's
        // /uploads directory so openagentic can access them with tools.
        try {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
          const b64 = btoa(binary);
          if (sessionId && authToken) {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + authToken,
            };
            const resp = await fetch(
              '/api/code/sessions/' + encodeURIComponent(sessionId) + '/upload',
              {
                method: 'POST',
                headers,
                body: JSON.stringify({ filename: name, content: b64 }),
              },
            );
            if (resp.ok) {
              const data = await resp.json() as { relativePath?: string };
              inserts.push('\n\n[uploaded file: ' + name + ' to ~/uploads/' + name + ' — use Read tool or Bash to access]\n');
            } else {
              inserts.push('\n\n[upload failed: ' + name + ']\n');
            }
          } else {
            inserts.push('\n\n[file: ' + name + ' — session not ready for upload]\n');
          }
        } catch {
          inserts.push('\n\n[upload failed: ' + name + ']\n');
        }
      }
    }
    if (newImages.length > 0) {
      setPendingImages((prev) => [...prev, ...newImages]);
    }
    if (inserts.length > 0) {
      setInput((prev) => prev + inserts.join(''));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      void handleAttachFiles(e.clipboardData.files);
    }
  };

  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      setDragOver(false);
      void handleAttachFiles(e.dataTransfer.files);
    }
  };

  return (
    <DaemonRPCContext.Provider value={daemonRPC}>
    <PermissionsProvider value={{ mode, setMode: setPermissionMode }}>
    <div
      className={clsx('flex flex-col h-full min-h-0 relative', className)}
      style={{
        backgroundColor: 'var(--cm-bg, #0d1117)',
        color: 'var(--cm-text, #e6edf3)',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
            backgroundColor: 'rgba(88, 166, 255, 0.12)',
            border: '2px dashed var(--cm-accent, #58a6ff)',
            borderRadius: 6,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily:
              'var(--cm-mono-font, ui-monospace, SFMono-Regular, monospace)',
            fontSize: 14,
            color: 'var(--cm-accent, #58a6ff)',
          }}
        >
          drop file to attach
        </div>
      )}
      {/* Slash-command toast — unobtrusive status banner for commands
          that don't open a modal (e.g. /effort, /cost, /logout). Fades
          out after ~2.5s via setSlashToast(null). */}
      {slashToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 60,
            padding: '6px 12px',
            borderRadius: 6,
            backgroundColor: 'var(--cm-bg-secondary, #161b22)',
            border: '1px solid var(--cm-border, #30363d)',
            color: 'var(--cm-text, #e6edf3)',
            fontFamily:
              'var(--cm-mono-font, ui-monospace, SFMono-Regular, Menlo, monospace)',
            fontSize: 12,
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
            pointerEvents: 'none',
          }}
        >
          {slashToast}
        </div>
      )}

      {/* Permission dialog — Phase 4 of the codemode-bridge plan moved
          mid-turn approvals INLINE inside the streaming assistant message
          (see InlinePermissionCard mounted via MessageRow below). The
          legacy modal stays reachable via `?cm-permission-modal=1` for
          dev A/B comparison; remove this branch once the inline UX is
          settled. */}
      {pendingPermission && devPermissionModalEnabled() && (
        <PermissionDialog
          request={pendingPermission}
          onAllow={() => void respondToPermission({ behavior: 'allow' })}
          onDeny={() =>
            void respondToPermission({
              behavior: 'deny',
              message: 'User denied via dialog',
            })
          }
        />
      )}

      {/* Slice 1 of the codemode native React pickers plan — SkillsPicker
          overlay. Triggered when the user types `/skills`; the slash
          interceptor in useCodeModeChat dispatches `open_picker:skills`. */}
      <SkillsPicker
        open={activePicker === 'skills'}
        onClose={closePicker}
      />

      {/* Slice 2 — PluginsPicker overlay. Triggered when the user types
          `/plugin` or `/plugins`; the slash interceptor dispatches
          `open_picker:plugins`. */}
      <PluginsPicker
        open={activePicker === 'plugins'}
        onClose={closePicker}
        onAfterMutation={() => {
          // After install/uninstall/toggle, fire the daemon's
          // reload_plugins control_request so the running session's
          // AppState picks up the new skills/commands/agents. TUI
          // parity: openagentic TUI requires the user to type
          // /reload-plugins after install — codemode does it for them.
          //
          // Without this, the live-verified bug 2026-05-02:
          // superpowers installs to disk but `/skills` keeps reporting
          // the boot-time count until a session restart.
          void sendControl({
            type: 'control_request',
            request_id: `plugin-reload-${Date.now()}`,
            request: { subtype: 'reload_plugins' },
          });
          showSlashToast('reloading plugins…');
        }}
      />

      {/* Slice 4 — ModelPicker overlay. Triggered when the user types
          `/model`; the slash interceptor dispatches `open_picker:model`.
          Picking a row triggers a mid-session model swap via `set_model`
          and closes the picker on success. The chat continues without
          losing context — the swap is purely "the next user message
          uses this model". */}
      <ModelPicker
        open={activePicker === 'model'}
        onClose={closePicker}
      />

      {/* Slice 5 — MCPPicker overlay. Triggered when the user types
          `/mcp`; the slash interceptor dispatches `open_picker:mcp`.
          Read-only browse of configured MCP servers via `list_mcps`.
          Toggle/delete actions are TODO — daemon would need new RPCs. */}
      <MCPPicker
        open={activePicker === 'mcp'}
        onClose={closePicker}
      />

      {/* Slice 6 — AgentsPicker overlay. Triggered when the user types
          `/agents`; the slash interceptor dispatches `open_picker:agents`.
          Read-only browse of registered subagents via `list_agents`.
          v1 ships read-only — detail/edit/create/delete RPCs deferred
          to a later slice. */}
      <AgentsPicker
        open={activePicker === 'agents'}
        onClose={closePicker}
      />

      {/* Slash command modals — overlays rendered on top of the chat.
          Esc/backdrop-click dismisses; see SlashCommandModal. */}
      {openModal === 'theme' && <ThemePicker onClose={() => setOpenModal(null)} />}
      {openModal === 'tools' && (
        <ToolsModal
          tools={sessionMeta?.detail?.tools ?? []}
          fallbackTools={sessionMeta?.tools ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
        />
      )}
      {openModal === 'mcp' && (
        <MCPModal
          servers={sessionMeta?.detail?.mcp_servers ?? []}
          fallbackServers={sessionMeta?.mcpServers ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
        />
      )}
      {openModal === 'agents' && (
        <AgentsModal
          agents={sessionMeta?.detail?.agents ?? []}
          fallbackAgents={sessionMeta?.agents ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
        />
      )}
      {openModal === 'skills' && (
        <SkillsModal
          skills={sessionMeta?.detail?.skills ?? []}
          fallbackSkills={sessionMeta?.skills ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
        />
      )}
      {openModal === 'plugins' && (
        <PluginsModal
          plugins={sessionMeta?.detail?.plugins ?? []}
          fallbackPlugins={sessionMeta?.plugins ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
        />
      )}
      {openModal === 'permissions' && (
        <PermissionsModal
          permissionMode={mode}
          tools={sessionMeta?.tools ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
          onSetMode={(next) => setPermissionMode(next as PermissionMode)}
        />
      )}
      {openModal === 'config' && (
        <ConfigModal
          model={model ?? ''}
          permissionMode={mode}
          cwd={sessionMeta?.cwd ?? ''}
          version={sessionMeta?.openagenticVersion ?? ''}
          toolCount={sessionMeta?.tools.length ?? 0}
          mcpServerCount={sessionMeta?.mcpServers.length ?? 0}
          agentCount={sessionMeta?.agents.length ?? 0}
          pluginCount={sessionMeta?.plugins.length ?? 0}
          skillCount={sessionMeta?.skills.length ?? 0}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { handleModalCommand(cmd); setOpenModal(null); }}
        />
      )}

      {/* Command-specific modals (interactive React UIs) */}
      {openModal === 'compact' && (
        <CompactModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'debug' && (
        <DebugModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'hooks' && (
        <HooksModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'help' && (
        <HelpModal onClose={() => setOpenModal(null)} />
      )}
      {openModal === 'memory' && (
        <MemoryModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'plan' && (
        <PlanModal
          currentMode={mode}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }}
          onCycleMode={cyclePermissionMode}
        />
      )}
      {openModal === 'resume' && (
        <ResumeModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'save' && (
        <SaveModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'system' && (
        <SystemPromptModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'task' && (
        <TaskModal onClose={() => setOpenModal(null)} onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }} />
      )}
      {openModal === 'version' && (
        <VersionModal
          version={sessionMeta?.openagenticVersion ?? ''}
          model={model ?? ''}
          permissionMode={mode}
          sessionId={sessionId ?? ''}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === 'stats' && (
        <StatsModal
          model={model ?? ''}
          permissionMode={mode}
          sessionId={sessionId ?? ''}
          contextTokens={contextTokens}
          contextLimit={131072}
          totalOutputTokens={totalOutputTokens}
          totalCostUsd={totalCostUsd}
          lastTurnMs={lastTurnMs}
          version={sessionMeta?.openagenticVersion ?? ''}
          toolCount={sessionMeta?.tools.length ?? 0}
          mcpCount={sessionMeta?.mcpServers.length ?? 0}
          messages={messages}
          onClose={() => setOpenModal(null)}
        />
      )}
      {openModal === 'status' && (
        <StatusSettingsModal
          model={model ?? ''}
          permissionMode={mode}
          sessionId={sessionId ?? ''}
          contextTokens={contextTokens}
          contextLimit={131072}
          totalOutputTokens={totalOutputTokens}
          totalCostUsd={totalCostUsd}
          version={sessionMeta?.openagenticVersion ?? ''}
          cwd={sessionMeta?.cwd ?? ''}
          toolCount={sessionMeta?.tools.length ?? 0}
          mcpServers={sessionMeta?.mcpServers ?? []}
          agents={sessionMeta?.agents ?? []}
          plugins={sessionMeta?.plugins ?? []}
          skills={sessionMeta?.skills ?? []}
          onClose={() => setOpenModal(null)}
          onSend={(cmd) => { void sendMessage(cmd, { permissionMode: mode }); }}
        />
      )}

      {/* Plan P11: the big PTY-style running header (pixel banner +
          rule strip + metadata grid) was deleted. The single-letter
          `codemode` tag + ConnectionDot now collapse into the
          composer footer (right side) so the chat region is pure
          transcript above a Claude-Code-style floating composer.

          2026-04-30: brought back a SLIM version of the pixel banner
          + cm-rule top status row for visual parity with the
          codemode-tui-parity mocks. Banner is faded (opacity 0.18)
          and pointer-events: none — it's pure decoration that doesn't
          steal real estate; cm-rule is one tight line. See
          mocks/codemode-tui-parity/mock-2-fullstack-build.html lines
          11-25 for the visual contract. */}
      <CodeModeBanner visible={messages.length === 0} />
      {/* CodeModeRule (READY · tok · cost · elapsed · model · workspace)
          removed 2026-05-05 per UX cleanup — every datapoint duplicates
          something already in the bottom toolbar (model/cwd) or the
          composer mode chip + connection dot, while the unique fields
          (tok / cost / elapsed) are surfaced more deliberately by
          /status and /cost slash commands. Keeping the import +
          component file in case we want to reintroduce a slimmed
          variant. */}

      {/* Message list — monospace transcript styled to match the
          openagentic TUI (gutter symbols, markdown text, dim thinking,
          tool-specific summaries). See chat-messages/MessageTree.tsx.
          The inner wrapper centers the transcript at --transcript-max-width
          so codemode and chatmode share the SAME column (sidebar flip
          must not produce a visible width jump). Token lives in
          styles/design-tokens.css. */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
        style={{ backgroundColor: 'var(--cm-bg, #0d1117)' }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 'var(--transcript-max-width)',
            margin: '0 auto',
          }}
        >
          {messages.length === 0 && !isStreaming && (
            <EmptyState
              model={model}
              version={sessionMeta?.openagenticVersion}
              permissionMode={mode}
              toolCount={sessionMeta?.tools.length}
              mcpCount={sessionMeta?.mcpServers.length}
              cwd={sessionMeta?.cwd || '/workspace'}
            />
          )}
          <InkDomViewContext.Provider value={inkDomViewContextValue}>
            {(() => {
              // Flag the first assistant-role message so MessageTree renders
              // the "Initialized session / Started Openagentic" breadcrumb chips.
              const firstAssistantId = messages.find((m) => m.role === 'assistant')?.id;
              // Locate the streaming-in-flight assistant message — that's
              // where the InlinePermissionCard mounts (Phase 4). Skip the
              // wiring entirely when the dev modal toggle is on so the old
              // portal'd PermissionDialog handles approvals instead.
              const useInlinePermission =
                !!pendingPermission && !devPermissionModalEnabled();
              const streamingAssistantId = useInlinePermission
                ? [...messages]
                    .reverse()
                    .find((m) => m.role === 'assistant' && (m as any).streaming)?.id
                : undefined;
              // Flat transcript — no turn dividers, no older-turns
              // collapser. User feedback 2026-05-08: "get rid of the
              // turn shit — i have no fucking idea whats going on when
              // I ask questions now". The collapser was hiding active
              // context and the dividers were chopping the flow.
              return messages.map((msg) => {
                const isStreamingTarget =
                  useInlinePermission && msg.id === streamingAssistantId;
                return (
                  <MessageRow
                    key={msg.id}
                    message={msg}
                    isFirstAssistantTurn={msg.id === firstAssistantId}
                    pendingPermission={isStreamingTarget ? pendingPermission : null}
                    respondToPermission={
                      isStreamingTarget
                        ? (decision) => void respondToPermission(decision as any)
                        : undefined
                    }
                  />
                );
              });
            })()}
          </InkDomViewContext.Provider>
        </div>
      </div>

      {/* Plan P11: Claude-Code-style floating composer.
          ABOVE: small chips — permission mode, cwd, pop-out icon.
          INPUT: single rounded floating block, dark background, single
                 placeholder, return-arrow glyph at the right edge.
          BELOW: thin status row — accept-edits-style mode label + small
                 attach/mic icons (left), model + ConnectionDot (right).
          The big banner + heavy metadata strip + slash-hint status line
          are gone — this row is the entire chrome. */}
      <div
        className="shrink-0 px-4 py-4"
        style={{
          backgroundColor: 'var(--cm-bg, #0d1117)',
          fontFamily:
            'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
        }}
      >
        <div style={{ maxWidth: 'var(--transcript-max-width, 902px)', marginInline: 'auto', width: '100%' }}>
        {error && (
          <div
            className="mb-2 px-3 py-2 rounded-md"
            style={{
              fontSize: 12,
              color: 'var(--cm-error, #f85149)',
              background: 'rgba(248, 81, 73, 0.08)',
              border: '1px solid rgba(248, 81, 73, 0.25)',
            }}
          >
            {error}
          </div>
        )}
        {/* Sticky todo panel — mirrors claude code CLI / openagentic PTY
            behavior: when the assistant calls TodoWrite, a compact task
            list pins above the composer showing pending / in-progress /
            completed items. Self-hides when there are no todos. */}
        {currentTodos.length > 0 && (
          <div
            className="mb-2 px-2 py-1.5 rounded"
            style={{
              border: '1px solid var(--cm-border, #30363d)',
              background: 'var(--cm-bg-secondary, rgba(255,255,255,0.02))',
            }}
          >
            <ActiveTaskBar todos={currentTodos} enriched={enrichedTodos} />
          </div>
        )}

        {/* Slash command palette — opens above the input when the user
            types `/`. Arrow keys navigate, Enter commits. */}
        <SlashCommandPalette
          ref={paletteRef}
          input={input}
          onSelect={handleSlashSelect}
          onDismiss={() => setInput('')}
          extraCommands={daemonExtraCommands}
        />

        {/* Input mode pill — shows when a prefix (!, #, /) is typed so
            the user knows their intent is recognized. */}
        {inputMode !== 'chat' && (
          <div
            className="mb-1.5 inline-flex items-center gap-2 px-2 py-0.5 rounded"
            style={{
              fontSize: 11,
              fontFamily: 'inherit',
              backgroundColor:
                inputMode === 'bash'
                  ? 'rgba(210, 153, 34, 0.15)'
                  : inputMode === 'memory'
                    ? 'rgba(163, 113, 247, 0.15)'
                    : 'rgba(88, 166, 255, 0.15)',
              color:
                inputMode === 'bash'
                  ? '#d29922'
                  : inputMode === 'memory'
                    ? '#a371f7'
                    : 'var(--cm-accent, #58a6ff)',
              border: `1px solid ${
                inputMode === 'bash'
                  ? 'rgba(210, 153, 34, 0.4)'
                  : inputMode === 'memory'
                    ? 'rgba(163, 113, 247, 0.4)'
                    : 'rgba(88, 166, 255, 0.4)'
              }`,
            }}
          >
            {inputMode === 'bash' && <>! bash — run command directly</>}
            {inputMode === 'memory' && <># memory — append to persistent memory</>}
            {inputMode === 'slash' && <>/ slash command</>}
          </div>
        )}

        {/* ── ABOVE-INPUT ROW ───────────────────────────────────────────
             Phase H: only the pop-out icon lives above the input now.
             Mode chip + cwd chip moved into the below-input toolbar to
             match Claude-Code's footer density and free up vertical
             real-estate above the composer.                            ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 6,
            marginBottom: 8,
          }}
        >
          {/* Top-right pop-out button — wires to buildPopoutUrl(sessionId).
              Disabled while session is still resolving so we don't open
              /openagentic-window?sessionId=null. */}
          <button
            type="button"
            data-testid="cm-composer-popout-btn"
            disabled={!sessionId}
            onClick={() => {
              if (!sessionId) return;
              window.open(
                buildPopoutUrl(sessionId),
                `openagentic-${sessionId}`,
                'width=1100,height=820',
              );
            }}
            title="Open codemode in a new window"
            aria-label="Open in new window"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: '1px solid var(--cm-border, #30363d)',
              background: 'transparent',
              color: 'var(--cm-text-muted, #6e7681)',
              cursor: sessionId ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: sessionId ? 1 : 0.4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
              <path d="M21 14v7H3V3h7" />
            </svg>
          </button>
        </div>

        {/* ── FLOATING INPUT ────────────────────────────────────────────
             Single rounded box, dark background, single placeholder, with
             a return-arrow glyph at the right edge. Replaces the prior
             cm-input-card with a calmer chrome that floats over the
             transcript instead of sitting in a tinted footer.        ── */}
        <div
          data-testid="cm-floating-composer"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '12px 16px',
            background: 'var(--cm-bg-secondary, #161b22)',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 14,
            transition: 'border-color 140ms ease-out, box-shadow 140ms ease-out',
          }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              !sessionId
                ? 'Waiting for session…'
                : isStreaming
                  ? 'Agent is working…'
                  : 'Describe a task or ask a question'
            }
            disabled={!sessionId}
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none placeholder:text-[var(--cm-text-muted,#6e7681)]"
            style={{
              color: 'var(--cm-text, #e6edf3)',
              maxHeight: 180,
              fontFamily: 'var(--cm-prose-font, "Inter", "IBM Plex Sans", system-ui, sans-serif)',
              fontSize: 15,
              lineHeight: 1.55,
              border: 'none',
              boxShadow: 'none',
              padding: 0,
              letterSpacing: '-0.005em',
              caretColor: 'var(--cm-accent, #58a6ff)',
              background: 'transparent',
            }}
          />
          {/* Return-arrow ↵ submit affordance — matches the glyph shown
              at the right edge of Claude Code's composer. Visible when
              there's input to send; otherwise renders a static dim
              glyph as a hint. */}
          {input.trim().length > 0 && !isStreaming && sessionId ? (
            <button
              type="button"
              onClick={() => handleSubmit()}
              aria-label="Send message"
              title="Send (Enter)"
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                borderRadius: 6,
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--cm-accent, #58a6ff)',
                color: 'var(--cm-bg, #0d1117)',
                cursor: 'pointer',
                transition: 'transform 100ms ease-out, filter 140ms ease-out',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 10 4 15 9 20" />
                <path d="M20 4v7a4 4 0 0 1-4 4H4" />
              </svg>
            </button>
          ) : (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 26,
                height: 26,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--cm-text-muted, #6e7681)',
                opacity: 0.5,
                fontSize: 15,
                lineHeight: 1,
              }}
            >
              ↵
            </span>
          )}
        </div>

        {/* ── BELOW-INPUT TOOLBAR ───────────────────────────────────────
             Phase H layout (left → right):
               [Mode chip] [cwd chip] [Theme] [Attach +] [GitHub]
                 · · ·
               [Model] [ConnectionDot]
             The mode chip is the SINGLE permission-mode display (the
             redundant text label that previously lived here was removed
             — both surfaces opened the same cycle handler).           ── */}
        <div
          style={{
            marginTop: 8,
            fontSize: 11.5,
            color: 'var(--cm-text-muted, #6e7681)',
            fontFamily: 'var(--cm-prose-font, "IBM Plex Sans", Inter, system-ui, sans-serif)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '0 4px',
          }}
        >
          {/* Permission mode chip — moved from above-input row in Phase H.
              Click cycles through default → acceptEdits → plan → permissive.
              Title carries the long label + Shift+Tab hint. */}
          <button
            type="button"
            data-testid="cm-composer-mode-chip"
            onClick={cyclePermissionMode}
            title={`${modeConfig.title} — Shift+Tab to cycle permission mode`}
            style={{
              fontFamily: 'var(--cm-prose-font, "Inter", "IBM Plex Sans", system-ui, sans-serif)',
              fontSize: 12,
              padding: '4px 12px',
              background: modeConfig.background,
              border: `1px solid ${modeConfig.color}55`,
              borderRadius: 999,
              color: modeConfig.color,
              cursor: 'pointer',
              lineHeight: 1.4,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              // Fixed slot so cycling modes (default → acceptEdits → plan
              // → permissive) doesn't shift the cwd / theme / attach
              // siblings. Width fits the longest label including the
              // symbol prefix.
              minWidth: 132,
            }}
          >
            {formatFooterModeShort(mode)}
          </button>

          {/* cwd chip — moved from above-input row in Phase H. Hover
              shows the full path. */}
          <span
            data-testid="cm-composer-cwd-chip"
            title={sessionMeta?.cwd ?? 'workspace'}
            style={{
              fontFamily: 'var(--cm-prose-font, "Inter", "IBM Plex Sans", system-ui, sans-serif)',
              fontSize: 12,
              padding: '4px 12px',
              background: 'color-mix(in srgb, var(--cm-text, #e6edf3) 5%, transparent)',
              border: '1px solid var(--cm-border, #30363d)',
              borderRadius: 999,
              color: 'var(--cm-text-muted, #6e7681)',
              lineHeight: 1.4,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ opacity: 0.7 }}>cwd</span>
            <span style={{ color: 'var(--cm-text, #e6edf3)' }}>
              {abbreviateCwd(sessionMeta?.cwd)}
            </span>
          </span>

          {/* Model pill — surfaces session.model, updates reactively when
              /model slash command fires (daemon → warmup event →
              updateSessionModel → zustand re-render). Falls back to
              "auto" when unset. Pinned by CodemodeFooterModelPill.test.tsx.
              Placed adjacent to cwd chip so the [mode][cwd][model] triplet
              forms a consistent identity row. */}
          <CodemodeFooterModelPill />

          {/* Theme picker — was lost in P11's CodeModeRunningHeader
              deletion; restored in Phase H. Writes to the same `cm-theme`
              localStorage key as the /theme slash command. */}
          <ThemeSelectorPill />

          {/* Phase 5d status bar: mode · shells · tasks · tools · hints */}
          <CodeModeStatusLine toolCount={sessionMeta?.tools?.length ?? 0} />

          {/* Attach Files button — moved to canonical motion.button + Plus
              shape (mirrors ChatInputToolbar.tsx:720-736) so the codemode
              composer matches chatmode for muscle memory. data-testid
              uses `cm-` prefix to differentiate from chatmode's
              `chat-attach-button` (some tests assert on both surfaces). */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              const i = document.createElement('input');
              i.type = 'file';
              i.multiple = true;
              i.accept = 'image/*,text/*,.md,.ts,.tsx,.js,.jsx,.json,.yaml,.yml,.py,.pdf,.xlsx';
              i.onchange = () => {
                if (i.files && i.files.length > 0) void handleAttachFiles(i.files);
              };
              i.click();
            }}
            aria-label="Attach files"
            data-testid="cm-attach-button"
            className="p-2 rounded-lg transition-colors hover:bg-theme-bg-secondary"
            style={{ color: 'var(--cm-text-muted, var(--text-secondary, #6e7681))' }}
            title="Attach files"
          >
            <Plus size={18} aria-hidden="true" />
          </motion.button>

          {/* Right edge: just ConnectionDot. The redundant model name
              chip + GitHub pill were removed 2026-05-06 — the existing
              picker button on the same toolbar already shows the live
              model, and the GitHub pill moved to the sidebar (under
              Collections) since it's a session-wide setting. */}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              data-testid="cm-composer-connection"
              style={{ display: 'inline-flex', alignItems: 'center' }}
            >
              <ConnectionDot />
            </span>
          </span>
        </div>
        </div>
      </div>
    </div>
    </PermissionsProvider>
    </DaemonRPCContext.Provider>
  );
};

/**
 * Abbreviate a cwd to its last segment for the composer's cwd chip.
 *   /workspaces/u-1234   → u-1234
 *   /home/alice/projects → projects
 *   (empty)              → workspace
 */
function abbreviateCwd(raw: string | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return 'workspace';
  const parts = raw.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts[parts.length - 1] || raw;
}

/**
 * ComposerGitHubPill — compact `[GitHub: Connect]` / `[GitHub: ✓]` pill
 * that lives in the Phase-H below-input toolbar. Reuses the existing
 * `/api/v1/github/{config,status,connect}` flow. After 2026-05-07 the
 * legacy `/settings` page was ripped — the api callback now bounces to
 * `/admin#integrations/github` (DEFAULT_LANDING in api/routes/v1/github.ts).
 * When OAuth is not configured at the server level we render a disabled
 * pill with a tooltip explaining why; clicking a connected pill is a
 * no-op (manage connection from `/admin#integrations`).
 */
export const ComposerGitHubPill: React.FC = () => {
  const { getAuthHeaders } = useAuth();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch(apiEndpoint('/api/v1/github/config'));
        if (cfg.ok) {
          const data = await cfg.json().catch(() => null);
          if (!cancelled) setConfigured(Boolean(data?.configured));
        } else if (!cancelled) {
          setConfigured(false);
        }
      } catch {
        if (!cancelled) setConfigured(false);
      }
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(apiEndpoint('/api/v1/github/status'), {
          headers,
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (!cancelled) setConnected(Boolean(data?.connected));
        } else if (!cancelled) {
          setConnected(false);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAuthHeaders]);

  const handleClick = useCallback(() => {
    if (typeof window === 'undefined') return;
    // Connected: open Settings → Integrations so the user can disconnect
    // / verify the linked GitHub account. Not connected: kick the OAuth
    // flow with a redirect that lands on Settings → Integrations on
    // success (the activeSection default is 'appearance' otherwise —
    // user feedback 2026-05-07: "wtf page is this" landed on
    // appearance, GitHub panel buried). When OAuth isn't configured at
    // all (configured === false) the button is disabled in render.
    if (configured === false) return;
    if (connected) {
      window.location.href = '/settings?tab=integrations';
      return;
    }
    const back = '/settings?github_success=true';
    window.location.href = apiEndpoint(
      '/api/v1/github/connect?redirect=' + encodeURIComponent(back),
    );
  }, [configured, connected]);

  const isConnected = connected === true;
  const disabled = configured === false;
  const label = isConnected ? 'GitHub: ✓' : 'GitHub: Connect';
  const title = configured === false
    ? 'GitHub OAuth is not configured on this server'
    : isConnected
      ? 'GitHub connected — click to manage in Settings'
      : 'Connect your GitHub account';

  return (
    <button
      type="button"
      data-testid="cm-composer-github"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5ch',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'inherit',
        color: isConnected
          ? 'var(--cm-success, #5fdd82)'
          : 'var(--cm-text-muted, #8b949e)',
        background: 'transparent',
        border: '1px solid var(--cm-border, #30363d)',
        cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        opacity: configured === false ? 0.5 : 1,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
      <span>{label}</span>
    </button>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

/**
 * Terminal-style boot splash. Replaces the old card panel with a
 * recreation of the openagentic CLI opening screen: [openagentic]
 * wordmark, v{version} + model, cwd, slash-commands row, breathing
 * block cursor on a `>` prompt line. Scanline overlay + phosphor
 * glow deliberately evoke a retro terminal — matches the visual
 * effects in the openagentic CLI itself (see screenshot 2026-04-23).
 *
 * The `[openagentic]` wordmark itself is now sourced from the shared
 * `<OpenAgenticWordmark />` component so docs / About modal share the
 * exact same per-char color chord. No new deps — Framer Motion is
 * already in codemode.
 */
// ────────────────────────────────────────────────────────────────────
// Turn boundary divider — drawn between every user-anchored turn so the
// user can visually parse where one exchange ended and the next began.
// Rendered as a thin horizontal rule with a small `Turn N` chip in the
// middle. Mirrors openagentic TUI's conversation-break separator.
// ────────────────────────────────────────────────────────────────────
const TurnDivider: React.FC<{ turnNumber: number }> = ({ turnNumber }) => (
  <div
    data-cm-turn-divider={turnNumber}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      margin: '20px 0 12px 0',
      color: 'var(--cm-text-muted, #8b949e)',
      fontFamily:
        'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
      fontSize: 10.5,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }}
  >
    <div
      style={{ flex: 1, height: 1, background: 'var(--cm-border, #30363d)' }}
    />
    <span
      style={{
        padding: '2px 8px',
        border: '1px solid var(--cm-border, #30363d)',
        borderRadius: 9999,
        background: 'var(--cm-bg-secondary, #11161e)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      Turn {turnNumber}
    </span>
    <div
      style={{ flex: 1, height: 1, background: 'var(--cm-border, #30363d)' }}
    />
  </div>
);

// ────────────────────────────────────────────────────────────────────
// Collapsed-older-turns pill — single-line "▸ Show N older turns" CTA
// that hides every turn before the active one. Click to expand, which
// flips the parent's `olderTurnsExpanded` state and rerenders. Mirrors
// openagentic TUI's compaction breadcrumb.
// ────────────────────────────────────────────────────────────────────
const CollapsedOlderTurnsPill: React.FC<{
  olderCount: number;
  onExpand: () => void;
}> = ({ olderCount, onExpand }) => (
  <button
    type="button"
    data-cm-collapse-pill="collapsed"
    onClick={onExpand}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: '100%',
      margin: '12px 0',
      padding: '8px 12px',
      border: '1px dashed var(--cm-border, #30363d)',
      borderRadius: 8,
      background: 'var(--cm-bg-secondary, #11161e)',
      color: 'var(--cm-text-muted, #8b949e)',
      fontFamily:
        'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
      fontSize: 12,
      cursor: 'pointer',
      textAlign: 'left',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.color = 'var(--cm-text, #e6edf3)';
      e.currentTarget.style.borderColor = 'var(--cm-accent, #58a6ff)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.color = 'var(--cm-text-muted, #8b949e)';
      e.currentTarget.style.borderColor = 'var(--cm-border, #30363d)';
    }}
  >
    <span aria-hidden style={{ color: 'var(--cm-accent, #58a6ff)' }}>▸</span>
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      Show {olderCount} older {olderCount === 1 ? 'turn' : 'turns'}
    </span>
    <span style={{ marginLeft: 'auto', opacity: 0.6 }}>click to expand</span>
  </button>
);

const ExpandedOlderTurnsPill: React.FC<{
  olderCount: number;
  onCollapse: () => void;
}> = ({ olderCount, onCollapse }) => (
  <button
    type="button"
    data-cm-collapse-pill="expanded"
    onClick={onCollapse}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      margin: '8px 0',
      padding: '4px 10px',
      border: '1px solid transparent',
      borderRadius: 9999,
      background: 'transparent',
      color: 'var(--cm-text-muted, #8b949e)',
      fontFamily:
        'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)',
      fontSize: 11,
      cursor: 'pointer',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.color = 'var(--cm-text, #e6edf3)';
      e.currentTarget.style.borderColor = 'var(--cm-border, #30363d)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.color = 'var(--cm-text-muted, #8b949e)';
      e.currentTarget.style.borderColor = 'transparent';
    }}
  >
    <span aria-hidden>▴</span>
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      Hide {olderCount} older {olderCount === 1 ? 'turn' : 'turns'}
    </span>
  </button>
);

const TerminalBootSplash: React.FC<{
  model?: string;
  version?: string;
  cwd?: string;
}> = ({ model, version, cwd }) => {
  const MONO = 'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
  const DIM = 'var(--cm-text-muted, #8b949e)';
  const ACCENT = 'var(--cm-accent, #5fdd82)';
  const RULE = 'var(--cm-border, #30363d)';
  const reveal = (i: number) => ({
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.22, delay: i * 0.09, ease: 'easeOut' as const },
  });
  const versionLine = version ? `v${version}` : null;
  return (
    <div
      className="cm-terminal-splash"
      style={{
        fontFamily: MONO,
        minHeight: 340,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 3px)',
          pointerEvents: 'none',
          mixBlendMode: 'overlay',
          opacity: 0.8,
        }}
      />
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--cm-text, #e6edf3)',
          position: 'relative',
        }}
      >
        <motion.div
          {...reveal(0)}
          style={{
            marginBottom: 8,
            fontFamily: MONO,
            fontWeight: 700,
            fontSize: 18,
            letterSpacing: '0.01em',
            color: ACCENT,
          }}
          aria-label="openagentic"
        >
          [<span style={{ color: 'var(--cm-text, #e6edf3)' }}>openagentic</span>]
        </motion.div>
        {versionLine && (
          <motion.div {...reveal(1)} style={{ color: DIM, fontSize: 12, marginBottom: 2 }}>
            <span style={{ opacity: 0.7 }}>version </span>
            <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{versionLine}</span>
          </motion.div>
        )}
        {model && (
          <motion.div {...reveal(2)} style={{ color: DIM, fontSize: 12, marginBottom: 2 }}>
            <span style={{ opacity: 0.7 }}>model </span>
            <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{model}</span>
          </motion.div>
        )}
        {cwd && (
          <motion.div {...reveal(3)} style={{ color: DIM, fontSize: 12, marginBottom: 14 }}>
            <span style={{ opacity: 0.7 }}>cwd </span>
            <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{cwd}</span>
          </motion.div>
        )}
        <motion.div {...reveal(4)} style={{ height: 1, background: RULE, marginBottom: 10 }} />
        <motion.div {...reveal(5)} style={{ color: DIM, fontSize: 12, marginBottom: 10 }}>
          <span style={{ color: ACCENT }}>/?</span> help
          <span style={{ margin: '0 10px' }}>&middot;</span>
          <span style={{ color: ACCENT }}>ctrl+c</span> cancel
          <span style={{ margin: '0 10px' }}>&middot;</span>
          <span style={{ color: ACCENT }}>/exit</span> quit
        </motion.div>
        <motion.div {...reveal(6)} style={{ height: 1, background: RULE, marginBottom: 14 }} />
        <motion.div {...reveal(7)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: ACCENT, fontWeight: 700 }}>&gt;</span>
          <span
            aria-hidden
            className="cm-terminal-cursor"
            style={{
              display: 'inline-block',
              width: '0.6em',
              height: '1.1em',
              background: ACCENT,
              boxShadow: `0 0 8px ${ACCENT}99`,
              animation: 'cm-cursor-blink 1.1s steps(2, end) infinite',
            }}
          />
        </motion.div>
      </div>
      <style>{`@keyframes cm-cursor-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }`}</style>
    </div>
  );
};

/** Old prop-shape preserved for call-site compat; non-terminal props drop through. */
const EmptyState: React.FC<{
  model?: string;
  version?: string;
  permissionMode?: string;
  toolCount?: number;
  mcpCount?: number;
  cwd?: string;
}> = ({ model, version, cwd }) => (
  <TerminalBootSplash model={model} version={version} cwd={cwd} />
);

export default CodeModeChatView;
