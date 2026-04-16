import React, { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Sparkles } from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { useCodeModeChat } from '../hooks/useCodeModeChat';
import { usePermissionMode } from '../hooks/usePermissionMode';
import { usePromptHistory } from '../hooks/usePromptHistory';
import {
  useTurnCompleteSound,
  getSoundsEnabled,
  setSoundsEnabled,
} from '../hooks/useTurnCompleteSound';
import { formatFooterModeLine } from '../permissionMode';
import { MessageRow } from './chat-messages/MessageTree';
import { CodeModeHeaderStrip } from './chat-messages/CodeModeHeaderStrip';
import {
  SlashCommandPalette,
  type SlashCommandPaletteHandle,
} from './chat-messages/SlashCommandPalette';
import { ThemePicker } from './chat-messages/ThemePicker';
import { ModelPicker } from './chat-messages/ModelPicker';
import { PermissionDialog } from './chat-messages/PermissionDialog';
import { SessionInfoModal, type ListItem } from './chat-messages/SessionInfoModal';
import {
  CompactModal,
  DebugModal,
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
  } = useCodeModeChat({
    sessionId,
    authToken,
  });
  const { mode, config: modeConfig, cycle: cyclePermissionMode } = usePermissionMode(sessionId);
  const history = usePromptHistory(sessionId);
  // Play a chime when a turn completes. Toggled via localStorage —
  // hidden toggle for now, exposed via /sounds slash command below.
  useTurnCompleteSound(isStreaming);

  const { user } = useAuth();
  const displayName = user?.name || user?.email?.split('@')[0] || 'user';
  const [soundsOn, setSoundsOn] = useState<boolean>(getSoundsEnabled);

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
  type ModalId = 'theme' | 'model' | 'tools' | 'mcp' | 'agents' | 'skills' | 'plugins' | 'permissions' | 'config' | 'compact' | 'debug' | 'hooks' | 'memory' | 'plan' | 'resume' | 'save' | 'system' | 'task' | 'version' | 'status' | 'stats' | null;
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
    const modalMap: Record<string, ModalId> = {
      '/plugins': 'plugins', '/plugin': 'plugins', '/marketplace': 'plugins',
      '/mcp': 'mcp', '/tools': 'tools', '/skills': 'skills',
      '/agents': 'agents', '/config': 'config', '/permissions': 'permissions',
      '/model': 'model',
    };
    const baseCmd = cmd.split(/\s/)[0];
    if (baseCmd && modalMap[baseCmd] && cmd.trim() === baseCmd) {
      setOpenModal(modalMap[baseCmd]);
      return;
    }
    // Everything else: send as regular message through the bridge
    void sendMessage(cmd, { permissionMode: mode });
  }, [sendControl, sendMessage, mode, setOpenModal]);

  /**
   * User-selected model override. Once chosen via /model, this is
   * sent on every subsequent turn via sendMessage({model}). Null =
   * use session default (configured by the backend).
   */
  const [modelOverride, setModelOverride] = useState<string | null>(() => {
    try { return localStorage.getItem('codemode:model') || null; } catch { return null; }
  });
  // Persist model selection to localStorage so it survives across sessions.
  useEffect(() => {
    try {
      if (modelOverride) localStorage.setItem('codemode:model', modelOverride);
      else localStorage.removeItem('codemode:model');
    } catch {}
  }, [modelOverride]);
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
    // Try to dispatch immediately first — if dispatch handles it,
    // clear the input and we're done. Otherwise fall through to the
    // insert-placeholder path.
    const full = `/${name}`;
    if (dispatchSlashCommand(full)) {
      history.push(full);
      setInput('');
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    // Insert `/<name> ` for arg-taking commands.
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

  // Auto-scroll to bottom when new messages arrive, unless the user
  // has scrolled up manually (we detect that via scrollTop relative
  // to scrollHeight minus viewport).
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      atBottomRef.current = distFromBottom < 40;
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!atBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

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
        // Openagentic's /exit closes the REPL. In browser context,
        // clearing + dropping focus is the closest no-op equivalent.
        clear();
        return true;

      case 'help': {
        // Inject a synthetic system message showing the command list —
        // the real /help command in the TUI renders a static lookup.
        const helpText =
          'Available slash commands — type / to open the palette. Press ↑/↓ to navigate prior prompts. Shift+Tab to cycle permission mode.';
        // Use the error channel as a system banner for now. Future:
        // inject a proper SystemChatMessage into state.
        // eslint-disable-next-line no-console
        console.log('[CodeMode] /help requested');
        setInput('');
        history.push(text);
        // Fall back to LLM so the user gets openagentic's full help text.
        void sendMessage(`${helpText}\n\nPlease show me all available slash commands and their usage.`, { permissionMode: mode });
        return true;
      }

      case 'cost':
        // Cost is already visible in the footer — nothing to send.
        // Just push history and clear input.
        return true;

      case 'context':
        // Context usage is rendered in the header gauge. No-op send.
        return true;

      case 'theme':
        // /theme — open the local theme picker modal (lives in
        // chat-messages/ThemePicker.tsx). Applies immediately via
        // the shared cm-theme localStorage key.
        setOpenModal('theme');
        return true;

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

      case 'status':
        setOpenModal('status');
        return true;

      case 'version':
        // /version — show the product version. Pulled from a build-
        // time constant or static string. Falls through to the LLM
        // which will look up the running openagentic version.
        return false;

      case 'session': {
        // /session — show current session identity (user, pod, cwd).
        // Data already lives in the header strip, but this is the
        // openagentic convention of printing a summary block.
        const lines = [
          `**Session**`,
          `- session id: ${sessionId ?? '(none)'}`,
          `- sandbox user: aw_${sessionId?.slice(0, 8) ?? '--------'}`,
          `- pod: openagentic-${sessionId?.slice(0, 8) ?? '--------'}`,
          `- workspace: /workspaces/${sessionId?.slice(0, 8) ?? '--------'}`,
          `- model: ${model ?? '(unknown)'}`,
        ];
        void sendMessage(
          `Respond with EXACTLY this text, unmodified, no commentary:\n\n${lines.join('\n')}`,
          { permissionMode: mode },
        );
        return true;
      }

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

      case 'model':
        setOpenModal('model');
        return true;

      // These commands are handled by openagentic server-side which
      // renders full interactive output (MCP server status, plugin
      // marketplace browser, skill list with token counts, etc.).
      // Our basic SessionInfoModal can't match that fidelity, so
      // we pass through and let openagentic handle them natively.
      case 'tools':
        setOpenModal('tools');
        return true;
      case 'mcp':
        setOpenModal('mcp');
        return true;
      case 'agents':
        setOpenModal('agents');
        return true;
      case 'skills':
        setOpenModal('skills');
        return true;
      case 'plugin':
      case 'plugins':
        setOpenModal('plugins');
        return true;
      case 'permissions':
      case 'allowed-tools':
        setOpenModal('permissions');
        return true;
      case 'config':
      case 'settings':
        setOpenModal('config');
        return true;

      case 'compact':
        setOpenModal('compact');
        return true;

      case 'debug':
        setOpenModal('debug');
        return true;

      case 'hooks':
        setOpenModal('hooks');
        return true;

      case 'memory':
        setOpenModal('memory');
        return true;

      case 'plan':
        setOpenModal('plan');
        return true;

      case 'resume':
      case 'continue':
        setOpenModal('resume');
        return true;

      case 'save':
        setOpenModal('save');
        return true;

      case 'system':
        setOpenModal('system');
        return true;

      case 'task':
      case 'tasks':
        setOpenModal('task');
        return true;

      case 'version':
        setOpenModal('version');
        return true;

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
    void sendMessage(text, {
      permissionMode: mode,
      ...(modelOverride ? { model: modelOverride } : {}),
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
      {/* Permission dialog — renders when openagentic emits a
          can_use_tool control_request. Blocks the chat until the user
          allows or denies. Responses go back via sendControl →
          /api/code/sessions/:id/chat/control. See #40. */}
      {pendingPermission && (
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

      {/* Slash command modals — overlays rendered on top of the chat.
          Esc/backdrop-click dismisses; see SlashCommandModal. */}
      {openModal === 'theme' && <ThemePicker onClose={() => setOpenModal(null)} />}
      {openModal === 'model' && (
        <ModelPicker
          sessionId={sessionId}
          currentModel={modelOverride ?? model}
          onSelect={(id) => setModelOverride(id)}
          onClose={() => setOpenModal(null)}
        />
      )}
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

      {/* Header = theme picker only */}
      <CodeModeHeaderStrip sessionId={sessionId} />

      {/* Message list — monospace transcript styled to match the
          openagentic TUI (gutter symbols, markdown text, dim thinking,
          tool-specific summaries). See chat-messages/MessageTree.tsx. */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4"
        style={{ backgroundColor: 'var(--cm-bg, #0d1117)' }}
      >
        {messages.length === 0 && !isStreaming && (
          <EmptyState
            model={model}
            version={sessionMeta?.openagenticVersion}
            permissionMode={mode}
            toolCount={sessionMeta?.tools.length}
            mcpCount={sessionMeta?.mcpServers.length}
          />
        )}
        {messages.map((msg) => (
          <MessageRow key={msg.id} message={msg} />
        ))}
      </div>

      {/* Input bar — openagentic-style prompt: monospace, leading `>`
          caret, send button is borderless and only shows on hover/enter.
          Matches the visual grammar of the TUI prompt. */}
      <div
        className="shrink-0 border-t px-4 py-3"
        style={{
          borderColor: 'var(--cm-border, #30363d)',
          backgroundColor: 'var(--cm-bg-secondary, #161b22)',
          fontFamily:
            'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)',
        }}
      >
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
        {/* Slash command palette — opens above the input when the user
            types `/`. Arrow keys navigate, Enter commits. See
            chat-messages/SlashCommandPalette.tsx. */}
        <SlashCommandPalette
          ref={paletteRef}
          input={input}
          onSelect={handleSlashSelect}
          onDismiss={() => setInput('')}
        />

        {/* Input mode pill — shows when a prefix (!, #, /) is typed so
            the user knows their intent is recognized. Matches the
            openagentic TUI's bash-mode indicator behavior (1:1). */}
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
        {/* Input box — matches openagentic TUI's rounded box (╭─╮│╰─╯).
            No send button — Enter submits, Shift+Enter adds a newline.
            The bordered box wraps caret + textarea only, so the layout
            is identical to the TUI frame. */}
        <div
          className="flex items-start gap-2 rounded-md px-3 py-2"
          style={{
            backgroundColor: 'var(--cm-bg, #0d1117)',
            border: `1px solid var(--cm-border, #30363d)`,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              color: 'var(--cm-text-muted, #6e7681)',
              userSelect: 'none',
              fontSize: 14,
              lineHeight: '1.55',
              paddingTop: 1,
              fontFamily: 'inherit',
              // ❯ (U+276F) — exact caret glyph openagentic's TUI uses
              // (verified in /tmp/openagentic-ref/boot3.raw).
            }}
          >
            ❯
          </span>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              !sessionId
                ? 'waiting for session…'
                : isStreaming
                  ? 'agent is working…'
                  : 'Try "explain this codebase"'
            }
            disabled={!sessionId}
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none placeholder:text-[var(--cm-text-muted,#6e7681)]"
            style={{
              color: 'var(--cm-text, #e6edf3)',
              maxHeight: '180px',
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: '1.55',
            }}
          />
          {/* All streaming activity shown inline in transcript — no
              spinner here. The thinking glow + tool spinners in
              MessageTree are the visual indicators. */}
        </div>
        {/* ── Consolidated footer: all status in one glanceable bar ── */}
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--cm-text-muted, #6e7681)',
            fontFamily: 'inherit',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {/* Row 1: permission (clickable) | model (clickable) | username */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={cyclePermissionMode}
              title="Click or Shift+Tab to cycle permission mode"
              style={{
                fontFamily: 'inherit',
                fontSize: 11,
                padding: '1px 8px',
                background: 'none',
                border: `1px solid ${modeConfig.color}40`,
                borderRadius: 3,
                color: modeConfig.color,
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
            >
              {formatFooterModeLine(mode)}
            </button>
            <button
              type="button"
              onClick={() => setOpenModal('model')}
              title="Click to change model"
              style={{
                fontFamily: 'inherit',
                fontSize: 11,
                padding: '1px 8px',
                background: 'rgba(88, 166, 255, 0.1)',
                border: '1px solid rgba(88, 166, 255, 0.3)',
                borderRadius: 3,
                color: 'var(--cm-accent, #58a6ff)',
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
            >
              {model ?? 'model'} &#9660;
            </button>
            <span style={{ color: 'var(--cm-text-muted, #6e7681)' }}>|</span>
            <span style={{ color: 'var(--cm-text, #e6edf3)' }}>{displayName}</span>
          </div>
          {/* Row 2: context gauge | metrics | latency | version | uptime | tools | mcp */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              className={compactionFlash ? 'cm-ctx-gauge-flash' : ''}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              title={contextTokens != null ? `${contextTokens} / 131072 tokens` : 'waiting for first turn'}
            >
              <span
                style={{
                  width: 56,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: 'var(--cm-border, #30363d)',
                  overflow: 'hidden',
                  display: 'inline-block',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: contextTokens != null ? `${Math.min(100, (contextTokens / 131072) * 100)}%` : '0%',
                    backgroundColor: contextTokens != null
                      ? (contextTokens / 131072) < 0.5 ? 'var(--cm-success, #3fb950)'
                        : (contextTokens / 131072) < 0.8 ? '#d29922'
                          : 'var(--cm-error, #f85149)'
                      : 'var(--cm-success)',
                    borderRadius: 3,
                    transition: 'width 400ms ease-out',
                  }}
                />
              </span>
              <span>{contextTokens != null ? `${contextTokens >= 1000 ? (contextTokens / 1000).toFixed(1) + 'k' : contextTokens} ctx` : '-- ctx'}</span>
            </span>
            <span style={{ color: 'var(--cm-text-muted, #484f58)' }}>|</span>
            <span style={{ opacity: 0.6 }}>cpu</span> <span style={{ color: 'var(--cm-success, #3fb950)' }}>--</span>
            <span style={{ opacity: 0.6 }}>mem</span> <span style={{ color: 'var(--cm-accent, #58a6ff)' }}>--</span>
            <span style={{ opacity: 0.6 }}>io</span> <span style={{ color: '#a371f7' }}>--</span>
            <span style={{ color: 'var(--cm-text-muted, #484f58)' }}>|</span>
            <span>{sessionMeta?.openagenticVersion ? `v${sessionMeta.openagenticVersion}` : 'v--'}</span>
            <span style={{ color: 'var(--cm-text-muted, #484f58)' }}>|</span>
            <span>{sessionMeta?.tools.length ?? 0} tools</span>
            <span style={{ color: 'var(--cm-text-muted, #484f58)' }}>|</span>
            <span>{sessionMeta?.mcpServers.length ?? 0} mcp</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ───────────────────────────────────────────────────────────────────────────
// Subcomponents
// ───────────────────────────────────────────────────────────────────────────

const EmptyState: React.FC<{
  model?: string;
  version?: string;
  permissionMode?: string;
  toolCount?: number;
  mcpCount?: number;
}> = ({ model, version, permissionMode, toolCount, mcpCount }) => {
  const MONO = 'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace)';
  return (
    <div
      className="h-full min-h-[300px] flex items-center justify-center px-6"
      style={{ fontFamily: MONO }}
    >
      <div
        style={{
          border: '1px solid var(--cm-border, #30363d)',
          borderRadius: 8,
          padding: '20px 28px',
          maxWidth: 420,
          width: '100%',
          backgroundColor: 'var(--cm-bg-secondary, #161b22)',
        }}
      >
        {/* Logo line — animated rainbow gradient like claude code TUI */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <span
            className="cm-splash-gradient"
            style={{ fontSize: 20, fontWeight: 700 }}
          >
            &#9670;
          </span>
          <span
            className="cm-splash-gradient"
            style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}
          >
            OpenAgentic
          </span>
          {version && (
            <span style={{ color: 'var(--cm-text-muted, #8b949e)', fontSize: 11 }}>
              v{version}
            </span>
          )}
        </div>

        {/* Session info lines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          {model && (
            <div style={{ display: 'flex', gap: '1ch' }}>
              <span style={{ color: 'var(--cm-text-muted, #8b949e)', width: '8ch' }}>model</span>
              <span style={{ color: 'var(--cm-accent, #58a6ff)' }}>{model}</span>
            </div>
          )}
          {permissionMode && (
            <div style={{ display: 'flex', gap: '1ch' }}>
              <span style={{ color: 'var(--cm-text-muted, #8b949e)', width: '8ch' }}>mode</span>
              <span style={{
                color: permissionMode === 'bypassPermissions' ? 'var(--cm-success, #3fb950)'
                  : permissionMode === 'plan' ? '#5faec1'
                    : 'var(--cm-text, #e6edf3)',
              }}>
                {permissionMode === 'bypassPermissions' ? 'permissive' : permissionMode}
              </span>
            </div>
          )}
          {(toolCount != null || mcpCount != null) && (
            <div style={{ display: 'flex', gap: '1ch' }}>
              <span style={{ color: 'var(--cm-text-muted, #8b949e)', width: '8ch' }}>tools</span>
              <span style={{ color: 'var(--cm-text, #e6edf3)' }}>
                {toolCount ?? 0} available{mcpCount ? ' \u00b7 ' + mcpCount + ' mcp' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Help hint */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: '1px solid var(--cm-border, #30363d)',
            color: 'var(--cm-text-muted, #8b949e)',
            fontSize: 11,
          }}
        >
          Type a prompt below &middot; / for commands &middot; ? for shortcuts
        </div>
      </div>
    </div>
  );
};

export default CodeModeChatView;
