import React, { useEffect, useRef, useCallback } from 'react';
import { init as initGhostty, Terminal, FitAddon } from 'ghostty-web';
import { useCodeModeStore } from '@/stores/useCodeModeStore';

interface TerminalPanelProps {
  /** WebSocket URL for the terminal connection (e.g., wss://host/ws/terminal) */
  wsUrl: string;
  /** Session ID for the CodeMode session */
  sessionId: string;
  /** Auth token for WebSocket connection */
  token: string;
  /** User ID */
  userId: string;
  /** Theme */
  theme?: 'light' | 'dark';
  /** Callback when terminal is ready */
  onReady?: () => void;
  /** Callback when connection state changes */
  onConnectionChange?: (connected: boolean) => void;
}

// Default dark theme — used when no --cm-* CSS variables are set
const DARK_THEME = {
  background: '#1a1a2e',
  foreground: '#e0e0e0',
  cursor: '#e67e22',
  cursorAccent: '#1a1a2e',
  selectionBackground: '#3d3d6b',
  selectionForeground: '#ffffff',
  black: '#1a1a2e',
  red: '#e74c3c',
  green: '#2ecc71',
  yellow: '#f1c40f',
  blue: '#3498db',
  magenta: '#9b59b6',
  cyan: '#1abc9c',
  white: '#ecf0f1',
  brightBlack: '#8b8da8',
  brightRed: '#ff6b6b',
  brightGreen: '#69db7c',
  brightYellow: '#ffd43b',
  brightBlue: '#74b9ff',
  brightMagenta: '#c084fc',
  brightCyan: '#63e6be',
  brightWhite: '#ffffff',
};

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1a1a2e',
  cursor: '#e67e22',
  cursorAccent: '#ffffff',
  selectionBackground: '#b8c9e8',
  selectionForeground: '#000000',
  black: '#000000',
  red: '#c0392b',
  green: '#27ae60',
  yellow: '#f39c12',
  blue: '#2980b9',
  magenta: '#8e44ad',
  cyan: '#16a085',
  white: '#ecf0f1',
  brightBlack: '#7f8c8d',
  brightRed: '#e74c3c',
  brightGreen: '#2ecc71',
  brightYellow: '#f1c40f',
  brightBlue: '#3498db',
  brightMagenta: '#9b59b6',
  brightCyan: '#1abc9c',
  brightWhite: '#ffffff',
};

/**
 * Strip DECTCEM cursor show/hide escapes (\x1b[?25h and \x1b[?25l) from
 * PTY output. Ink toggles these every render frame, causing ghostty-web's
 * cursor to flash. Ink draws its own cursor as inverse-video character
 * cells, so the terminal-level cursor is unwanted decoration.
 */
function stripCursorEscapes(s: string): string {
  return s.replace(/\x1b\[\?25[hl]/g, '');
}

/**
 * Build xterm theme from --cm-* CSS variables (set by CodeModeLayoutV2 theme dots).
 * Falls back to DARK_THEME/LIGHT_THEME when no variables are set.
 */
function getThemeFromCSSVars(el: HTMLElement, baseTheme: string): Record<string, string> {
  const base = baseTheme === 'dark' ? DARK_THEME : LIGHT_THEME;
  const get = (name: string) => getComputedStyle(el).getPropertyValue(name).trim();

  const bg = get('--cm-bg') || base.background;
  const fg = get('--cm-text') || base.foreground;
  const accent = get('--cm-accent') || base.cursor;
  const success = get('--cm-success') || base.green;
  const warning = get('--cm-warning') || base.yellow;
  const error = get('--cm-error') || base.red;
  const info = get('--cm-info') || base.blue;
  const muted = get('--cm-muted') || base.brightBlack;
  const textSecondary = get('--cm-text-secondary') || base.white;
  const surface = get('--cm-surface') || base.selectionBackground;

  return {
    ...base,
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: surface,
    green: success,
    brightGreen: success,
    yellow: warning,
    brightYellow: warning,
    red: error,
    brightRed: error,
    blue: info,
    brightBlue: info,
    // Use text-secondary (brighter) for brightBlack so user messages are
    // readable. The raw --cm-muted is too dark for terminal ANSI color 8.
    brightBlack: textSecondary || muted,
  };
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  wsUrl,
  sessionId,
  token,
  userId,
  theme = 'dark',
  onReady,
  onConnectionChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isOpenedRef = useRef(false);
  // Stable refs for callbacks — prevents useEffect remount loop
  const onReadyRef = useRef(onReady);
  const onConnectionChangeRef = useRef(onConnectionChange);
  onReadyRef.current = onReady;
  onConnectionChangeRef.current = onConnectionChange;
  // Settling lock: when true, suppress new fit() calls. Set immediately
  // after applyFontSizeAndFit() schedules the Ctrl+L safety redraw, and
  // cleared when that redraw lands. Without this, a parent ResizeObserver
  // burst that arrives during the 200ms post-resize window can trigger a
  // second fit() before Ink finishes processing the first SIGWINCH,
  // corrupting the frame buffer (doubled prompts, misaligned wraps).
  const settlingRef = useRef(false);
  // Set of elements currently observed by the ResizeObserver. Used so we
  // can re-detect a changed parent on each fire (panel toggle, layout
  // restructure) and observe the new parent without double-observing the
  // unchanged container.
  const observedElementsRef = useRef<Set<Element>>(new Set());
  // User zoom delta (in font-size steps). Applied on top of the auto-picked
  // font size so the terminal still responds to container resizes while
  // honoring the user's density preference. Ctrl+= / Ctrl+- bump this by
  // ±1; Ctrl+0 resets to 0. Persisted across reconnects by living on the
  // ref; reset on unmount.
  const zoomDeltaRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 10;

  // Auto-scale tunables. The terminal picks a font size each resize tick
  // so the container width is split into roughly TARGET_COLS columns at
  // the natural cell width of the font. The cell-width ratio is a
  // monospace approximation (cellWidth ≈ fontSize × 0.6 for JetBrains
  // Mono / Fira Code / Cascadia Code at lineHeight 1.2); close enough
  // for layout math, and we let xterm measure the real cells afterwards.
  //
  // 2026-04-08: bumped TARGET_COLS from 110 → 140 and lowered
  // MAX_FONT_SIZE from 18 → 14 because the default size was too big
  // on typical CodeMode panel widths (1000-1400px): at 1200px the old
  // math picked fontSize 18, which made openagentic's prompt and
  // output feel oversized next to the surrounding React chrome.
  // At 1200px the new math picks ~14px, which matches the chrome
  // typography. Users who want bigger can still zoom with Ctrl+=.
  const TARGET_COLS = 140;
  const MIN_FONT_SIZE = 9;
  const MAX_FONT_SIZE = 16;
  const CELL_WIDTH_RATIO = 0.6;

  // Pick the font size that gives roughly TARGET_COLS at the current
  // container width, then apply the user's zoom delta, then clamp to the
  // floor/ceiling. Integer result so xterm's cell metrics stay sharp.
  const pickFontSize = useCallback((containerWidth: number): number => {
    if (containerWidth <= 0) return MIN_FONT_SIZE;
    const ideal = containerWidth / (TARGET_COLS * CELL_WIDTH_RATIO);
    const withZoom = ideal + zoomDeltaRef.current;
    return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(withZoom)));
  }, []);

  // Send the current xterm dimensions to the PTY as a resize message.
  // Floors at cols/rows >= 1 so a transient 0×0 layout never poisons the
  // PTY with garbage dims. Returns the cols/rows actually sent so callers
  // can decide whether to follow up with a Ctrl+L redraw.
  //
  // The bounce trick: we send (cols-1, rows) immediately followed by
  // (cols, rows) so the PTY signals SIGWINCH twice with two distinct
  // dimensions. Ink's resize detection bails out if width hasn't actually
  // changed since the last SIGWINCH; the bounce guarantees a different
  // value lands first, so the second one always triggers a real redraw.
  // Without this, identical-width re-fits (very common when the user
  // drags the splitter back to where it was) get silently dropped by Ink.
  const sendCurrentResize = useCallback((): { cols: number; rows: number } | null => {
    const term = terminalRef.current;
    const ws = wsRef.current;
    if (!term || !ws || ws.readyState !== WebSocket.OPEN) return null;
    const cols = Math.max(1, term.cols);
    const rows = Math.max(1, term.rows);
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    return { cols, rows };
  }, []);

  // Connect WebSocket to PTY
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const params = new URLSearchParams({
      userId,
      sessionId,
      token,
    });
    const url = `${wsUrl}?${params.toString()}`;

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
      onConnectionChangeRef.current?.(true);

      // Focus the terminal container so ghostty-web's InputHandler receives
      // keydown events. Must focus the element (container), not the textarea.
      terminalRef.current?.focus();

      // Hide the terminal-level cursor. Ink draws its own cursor as inverse
      // character cells; without this, ghostty-web's cursor flashes on top.
      terminalRef.current?.write('\x1b[?25l');

      // Register terminal command bridge so UI components (header model
      // selector, etc.) can send slash commands into the PTY.
      useCodeModeStore.getState().setSendTerminalCommand((cmd: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(cmd);
        }
      });

      // First-frame contract: the openagentic-exec PTY spawns at a hardcoded
      // 120×40, so without an immediate resize, openagentic boots and paints
      // its first banner+prompt frame at 120×40 — the user sees a flash of
      // wrongly-wrapped output, then a re-flow once the real dims arrive.
      //
      // Send the resize as the very first WS message, before any keepalive,
      // before any user input. The PTY's pty.resize() call signals SIGWINCH
      // synchronously, and if the message lands before openagentic finishes
      // its Ink mount, the first frame is drawn at the right dimensions.
      //
      // We then send a Ctrl+L ~150ms later as a redraw safety net for the
      // case where openagentic had already painted at 120×40 by the time
      // SIGWINCH arrived — Ink treats Ctrl+L as a clear-and-redraw of the
      // entire viewport, which cleans up any visual residue.
      // Aggressive resize sequence: send resize immediately, again at 100ms
      // (busts through the server-side 50ms debounce), then Ctrl+L at 300ms
      // to force Ink to repaint at the correct dimensions. This ensures
      // --continue sessions get the right viewport height.
      sendCurrentResize();
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) sendCurrentResize();
      }, 100);
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('\x0c');
      }, 300);
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('\x0c');
      }, 600);

      // Keepalive: send ping every 30s to prevent proxy idle timeout
      const keepalive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'keepalive' }));
        } else {
          clearInterval(keepalive);
        }
      }, 30000);
      // Store for cleanup
      (ws as any)._keepalive = keepalive;
    };

    // Session-ready gate signal. We flip terminalContentReady in the
    // store the first time ANY real visible character lands in the
    // wasmTerm buffer — not on alt-screen / clear / mouse-tracking
    // setup escapes, which openagentic emits within the first ~100ms
    // regardless of whether Ink ever actually mounts. A quick peek at
    // row 0 after each write is enough — Ink's initial banner fills
    // row 0 as soon as the first React commit lands.
    const markReadyIfContent = () => {
      if (useCodeModeStore.getState().terminalContentReady) return;
      const term = terminalRef.current;
      const wasm = (term as any)?.wasmTerm;
      if (!term || !wasm || typeof wasm.getLine !== 'function') return;
      try {
        const maxRows = Math.min((term as any).rows ?? 0, 6);
        for (let r = 0; r < maxRows; r++) {
          const line = wasm.getLine(r);
          if (!line) continue;
          const cells: Array<{ codepoint: number }> =
            typeof line === 'string' ? JSON.parse(line) : line;
          if (cells && cells.some?.((c) => c && c.codepoint > 32)) {
            useCodeModeStore.getState().setTerminalContentReady(true);
            return;
          }
        }
      } catch {
        // Defensive — wasmTerm shape may evolve; don't crash the ws path
      }
    };

    ws.onmessage = (event) => {
      if (!terminalRef.current) return;

      if (typeof event.data === 'string') {
        // JSON control messages from manager
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'session_started') {
            onReadyRef.current?.();
          }
          // Other control messages can be handled here
        } catch {
          // Plain text — strip cursor show/hide escapes so ghostty-web's
          // cursor stays hidden. Ink renders its own cursor as an inverse
          // character cell in the prompt content; the terminal-level cursor
          // would just flash on top.
          terminalRef.current.write(stripCursorEscapes(event.data));
          markReadyIfContent();
        }
      } else {
        // Binary data — raw PTY output
        const text = new TextDecoder().decode(new Uint8Array(event.data));
        terminalRef.current.write(stripCursorEscapes(text));
        markReadyIfContent();
      }
    };

    ws.onclose = () => {
      onConnectionChangeRef.current?.(false);
      clearInterval((ws as any)._keepalive);
      useCodeModeStore.getState().setSendTerminalCommand(null);

      // Reconnect with exponential backoff
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
        reconnectAttemptsRef.current++;
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, [wsUrl, sessionId, token, userId, sendCurrentResize]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;
    let cleanupFn: (() => void) | null = null;

    (async () => {
    await initGhostty();
    if (disposed) return;

    // Read --cm-* CSS vars from the nearest .code-mode ancestor (set by theme dots)
    const codeModeScopeEl = containerRef.current!.closest('.code-mode') as HTMLElement || containerRef.current!;
    const initialTheme = getThemeFromCSSVars(codeModeScopeEl, theme);

    const terminal = new Terminal({
      cursorBlink: false,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      letterSpacing: 0,
      theme: initialTheme,
      ...({ lineHeight: 1.2 } as any),
      // Zero scrollback — Ink TUI manages its own viewport and prompt position.
      // With scrollback, old output pushes the TUI down creating empty space above
      // the prompt. Zero scrollback keeps the prompt locked at the bottom row.
      scrollback: 0,
      allowTransparency: false,
      convertEol: false,
      // Enable mouse tracking for Ink's SGR mouse support
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Forward user input to WebSocket → PTY stdin
    terminal.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    // Single source of truth for sizing: pick fontSize for the current
    // container width, compute (cols, rows) from the renderer's actual cell
    // metrics, call term.resize() ONCE, send the PTY resize message, and
    // lock settlingRef for 500ms so no ResizeObserver / debouncedFit burst
    // can slam another resize through while Ink is still processing the
    // SIGWINCH.
    //
    // We do NOT call fitAddon.fit() — it reserves a phantom 15px scrollbar
    // and its _lastCols cache fights our custom math. Since scrollback is 0
    // and we own the cell-count computation, the addon is dead weight here.
    //
    // We do NOT subscribe to terminal.onResize — term.resize() below is the
    // only caller, and we send the PTY update inline, so the onResize
    // callback would just re-trigger an already-sent message.
    const applyFontSizeAndFit = () => {
      const term = terminalRef.current;
      const container = containerRef.current;
      if (!term || !container) return;
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
      if (settlingRef.current) return;

      // Re-pick font size every settle so the terminal scales natively to
      // the current container width. Earlier versions froze the fontSize
      // at the initial pickFontSize() call, so a panel that mounted narrow
      // and then grew wide kept tiny cells forever.
      const newFontSize = pickFontSize(container.clientWidth);
      if (term.options.fontSize !== newFontSize) {
        term.options.fontSize = newFontSize;
        const rend: any = (term as any).renderer;
        if (rend && typeof rend.remeasureFont === 'function') {
          rend.remeasureFont();
        }
      }

      const renderer = (term as any).renderer;
      if (!renderer || typeof renderer.getMetrics !== 'function') return;
      const metrics = renderer.getMetrics();
      if (!metrics || metrics.width <= 0 || metrics.height <= 0) return;

      const el = term.element!;
      const cs = window.getComputedStyle(el);
      const pw = (parseInt(cs.paddingLeft) || 0) + (parseInt(cs.paddingRight) || 0);
      const ph = (parseInt(cs.paddingTop) || 0) + (parseInt(cs.paddingBottom) || 0);
      const cols = Math.max(2, Math.floor((el.clientWidth - pw) / metrics.width));
      const rows = Math.max(1, Math.floor((el.clientHeight - ph) / metrics.height));

      if (cols === term.cols && rows === term.rows) return;

      // Lock BEFORE resizing so any ResizeObserver callback that fires
      // during the settling window (splitter bounce, layout settling) is
      // a no-op.
      //
      // After resize we fire Ink's Ctrl+L forceRedraw twice with
      // increasing delays:
      //   - the first Ctrl+L at +300ms bridges the SIGWINCH → React tick →
      //     Ink diff window. Ink's forceRedraw sends ERASE_SCREEN +
      //     CURSOR_HOME then repaints the full viewport at the new dims.
      //     That's a hard clear on the terminal side — we don't call
      //     term.clear() from JS because it desyncs Ink's virtual screen
      //     from the real buffer and mid-stream output lands on mixed
      //     cells, producing the classic "doubled text" corruption.
      //   - the second Ctrl+L at +600ms is the safety net for sessions
      //     that take longer than one React tick to re-layout (big
      //     transcripts, slow provider streams).
      // The lock clears at +700ms so the next splitter drag can't land
      // on top of a still-unfinished redraw.
      settlingRef.current = true;
      term.resize(cols, rows);

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send('\x0c');
          }
        }, 300);
        setTimeout(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send('\x0c');
          }
        }, 600);
      }
      setTimeout(() => {
        settlingRef.current = false;
      }, 700);
    };

    // Register the force-refit bridge so the header "Fit" button can
    // trigger a clean resize + repaint cycle. Bypasses the settling lock
    // (user-initiated = highest priority) and runs the same recipe as the
    // automatic ResizeObserver path.
    useCodeModeStore.getState().setForceTerminalRefit(() => {
      settlingRef.current = false;
      applyFontSizeAndFit();
    });

    // First-paint guard: terminal.open() and the initial fit() must NOT
    // run until the container actually has non-zero dimensions. Otherwise
    // FitAddon falls back to xterm's default 80×24, the terminal renders
    // at that size, and then snaps to the real size when ResizeObserver
    // fires its first callback ~50-150ms later — the user sees a flash
    // of a tiny terminal followed by an abrupt jump.
    //
    // We use ResizeObserver as the single source of truth for "container
    // is laid out": its first fired callback is guaranteed to happen
    // after the browser has computed initial layout, and only after the
    // container actually has dimensions does it call observer.callback.
    // We open + fit + connect from inside that first callback.
    //
    // 400ms debounce: matches the user-visible "release mouse → reflow"
    // budget. The settling guard below drops any RO fire that arrives
    // during the post-send Ctrl+L window so we never re-fit on top of an
    // unfinished SIGWINCH.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFit = () => {
      if (settlingRef.current) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyFontSizeAndFit, 400);
    };

    const openTerminalIfReady = () => {
      if (isOpenedRef.current) return;
      const container = containerRef.current;
      if (!container) return;
      if (container.clientWidth <= 0 || container.clientHeight <= 0) return;

      // Pick the initial font size BEFORE opening so the first frame
      // xterm paints already has the right cell metrics for this container.
      terminal.options.fontSize = pickFontSize(container.clientWidth);

      isOpenedRef.current = true;
      terminal.open(container);

      // CRITICAL: ghostty-web's open() wires canvas mousedown → textarea.focus(),
      // but InputHandler listens for keydown on the container element. When the
      // user clicks the terminal, focus goes to textarea and keydown events never
      // reach InputHandler. Fix by adding a capture-phase listener that refocuses
      // the container after ghostty-web's handler fires.
      const canvas = container.querySelector('canvas');
      if (canvas) {
        canvas.addEventListener('mousedown', () => {
          // Defer to next microtask so ghostty-web's handler runs first
          setTimeout(() => container.focus(), 0);
        });
      }
      // Also handle clicks on the container itself
      container.addEventListener('click', () => container.focus());

      // Fill terminal element background to match theme (covers canvas edge gap)
      if (terminal.element) {
        terminal.element.style.width = '100%';
        terminal.element.style.height = '100%';
        terminal.element.style.overflow = 'hidden';
        const bg = terminal.options.theme?.background || '';
        if (bg) terminal.element.style.backgroundColor = bg;
      }

      // Initial metrics-based sizing. WS is not open yet so the PTY send
      // is skipped here — connect() below will trigger WS onopen which
      // reads term.cols/rows and sends the first resize message.
      applyFontSizeAndFit();
      connect();
    };

    // Keyboard zoom — Ctrl+= / Ctrl++ zoom in, Ctrl+- zoom out, Ctrl+0
    // reset. We intercept BEFORE xterm forwards keys to the PTY: returning
    // false from attachCustomKeyEventHandler swallows the key so it never
    // reaches openagentic. Only keydown events change the zoom — keyup /
    // keypress still fall through normally.
    //
    // Note: Ctrl+= is how "zoom in" is typed on US keyboards (Shift+=
    // gives + ), but browsers deliver it as e.key === '=' with
    // ctrlKey=true. We accept both '=' and '+' to cover both cases.
    // Wheel → SGR mouse wheel escape sequences. ghostty-web's default wheel
    // handler does internal scroll (no-op with scrollback:0) on main screen
    // and sends arrow keys on alt screen — neither is what Ink wants. Ink
    // uses SGR mouse tracking (mode 1006) and expects standard mouse wheel
    // escape sequences: \x1b[<64;col;rowM (up) / \x1b[<65;col;rowM (down).
    // Forward them directly to the PTY so Ink's virtual scroll works.
    terminal.attachCustomWheelEventHandler((e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      // Compute cell position from pixel coords relative to canvas
      const canvas = containerRef.current?.querySelector('canvas');
      const rect = canvas?.getBoundingClientRect();
      const renderer = (terminal as any).renderer;
      const metrics = renderer?.getMetrics?.();
      let col = 1, row = 1;
      if (rect && metrics && metrics.width > 0 && metrics.height > 0) {
        col = Math.max(1, Math.floor((e.clientX - rect.left) / metrics.width) + 1);
        row = Math.max(1, Math.floor((e.clientY - rect.top) / metrics.height) + 1);
      }
      // Convert deltaY to line count. Typical wheel notch is ~100px/line in
      // DOM_DELTA_PIXEL mode; cap at a few lines per event for smooth scrolling.
      let lines: number;
      if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        lines = Math.max(1, Math.min(5, Math.round(Math.abs(e.deltaY) / 40)));
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        lines = Math.max(1, Math.min(5, Math.round(Math.abs(e.deltaY))));
      } else {
        lines = 3;
      }
      const btn = e.deltaY < 0 ? 64 : 65; // 64 = wheel up, 65 = wheel down
      for (let i = 0; i < lines; i++) {
        ws.send(`\x1b[<${btn};${col};${row}M`);
      }
      return true; // tell ghostty-web we handled it
    });

    // ResizeObserver on container AND its current parent. Parent can
    // change between callbacks (panel toggles, layout restructures); we
    // re-detect on every fire and observe the new parent without
    // double-observing the unchanged container. Old elements drop off
    // the set; ResizeObserver doesn't notify on already-observed nodes.
    const ensureObserved = (el: Element | null) => {
      if (!el) return;
      if (observedElementsRef.current.has(el)) return;
      resizeObserver.observe(el);
      observedElementsRef.current.add(el);
    };
    const resizeObserver = new ResizeObserver(() => {
      openTerminalIfReady();
      // Re-check parent on every callback so a layout restructure picks
      // up the new parent immediately. The container itself only needs
      // observing once (it never changes identity), but ensureObserved
      // is idempotent so we can call it unconditionally.
      ensureObserved(containerRef.current);
      ensureObserved(containerRef.current?.parentElement ?? null);
      if (isOpenedRef.current) debouncedFit();
    });
    ensureObserved(containerRef.current);
    ensureObserved(containerRef.current?.parentElement ?? null);

    // Belt-and-suspenders: in case ResizeObserver hasn't fired by the time
    // a frame paints (rare, but happens on slow first paints), try to
    // open after a rAF tick. openTerminalIfReady is idempotent.
    requestAnimationFrame(() => {
      openTerminalIfReady();
    });

    // Additional retry: on initial tab navigation the container may report
    // dimensions in the ResizeObserver callback but xterm.js renders at
    // 0 height because the CSS layout hasn't fully settled (the parent
    // flex-1 height resolves asynchronously). Re-attempt at 200ms and
    // 500ms covers the typical layout settling window.
    const retryTimers = [
      setTimeout(() => { if (!isOpenedRef.current) openTerminalIfReady(); }, 200),
      setTimeout(() => { if (!isOpenedRef.current) openTerminalIfReady(); }, 500),
      setTimeout(() => {
        // Final retry: if terminal opened but has 0 canvas, force re-fit
        if (isOpenedRef.current && terminalRef.current && fitAddonRef.current) {
          const canvasEl = containerRef.current?.querySelector('canvas');
          if (canvasEl && canvasEl.clientHeight === 0) {
            applyFontSizeAndFit();
          }
        }
      }, 800),
    ];

    // Window resize handler
    window.addEventListener('resize', debouncedFit);

    cleanupFn = () => {
      window.removeEventListener('resize', debouncedFit);
      resizeObserver.disconnect();
      retryTimers.forEach(clearTimeout);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      terminal.dispose();
      isOpenedRef.current = false;
      useCodeModeStore.getState().setForceTerminalRefit(null);
    };
    })(); // end async IIFE

    return () => {
      disposed = true;
      cleanupFn?.();
    };
  }, []); // mount once — callbacks via refs

  // Update theme dynamically — watches CSS variable changes from theme dots
  useEffect(() => {
    if (!containerRef.current) return;
    const codeModeScopeEl = containerRef.current.closest('.code-mode') as HTMLElement || containerRef.current;

    // Map CodeMode theme IDs to openagentic's internal ThemeSetting. Openagentic
    // outputs truecolor RGB for every cell (not ANSI palette indices), so
    // changing only ghostty-web's theme has zero visual effect on content
    // openagentic already painted. The only way to theme the TUI content is
    // to tell openagentic to switch its own theme, then re-render. We bridge
    // that via the existing /theme slash command (patched to accept a direct
    // arg in openagentic v0.6.3).
    //
    // We only need the dark↔light split here — openagentic has 6 internal
    // themes, and the CodeMode theme list is ~7. Any CM theme whose base
    // background is dark maps to 'dark'; Latte (the only light one) maps
    // to 'light'. Keeping this mapping in TerminalPanel rather than in the
    // theme pill means we don't have to plumb state down — we infer it
    // from the active data-cm-theme attribute.
    const cmThemeToOpenagentic = (cmThemeId: string | null): string => {
      if (!cmThemeId || cmThemeId === 'default') return 'dark';
      if (cmThemeId === 'catppuccin-latte') return 'light';
      return 'dark';
    };
    // Seed `lastSentOpenagenticTheme` with the CURRENT CM theme so the
    // initial applyTheme() call (which fires during mount, while
    // openagentic is still loading --continue history) doesn't inject
    // a /theme slash command into Ink's input stream mid-bootstrap.
    // The command handler would open the theme picker in the middle
    // of transcript replay, and the picker's render stomps the partially
    // drawn transcript. We only send /theme on REAL theme switches after
    // the first apply.
    const initialCmTheme = (containerRef.current?.closest('.code-mode') as HTMLElement | null)?.getAttribute('data-cm-theme') ?? null;
    let lastSentOpenagenticTheme: string | null = cmThemeToOpenagentic(initialCmTheme);
    const sendOpenagenticTheme = (cmThemeId: string | null) => {
      const next = cmThemeToOpenagentic(cmThemeId);
      if (next === lastSentOpenagenticTheme) return;
      lastSentOpenagenticTheme = next;
      const send = useCodeModeStore.getState().sendTerminalCommand;
      // The /theme <name> command is routed to openagentic's stdin via the
      // same WS command bridge the model selector already uses. If the
      // bridge isn't wired yet (WS still connecting), we'll get another
      // call from the mutation observer once things settle.
      if (send) {
        send(`/theme ${next}\n`);
      }
    };

    const applyTheme = () => {
      const term = terminalRef.current;
      const container = containerRef.current;
      if (!term || !container) return;

      const scopeEl = container.closest('.code-mode') as HTMLElement || container;
      const newTheme = getThemeFromCSSVars(scopeEl, theme);

      // ghostty-web's Terminal.handleOptionChange() for 'theme' is a no-op
      // after open() — it just console.warn's and bails. The palette actually
      // lives on the renderer, so we update it directly and then force a
      // full re-render so every cell repaints with the new palette.
      // This only affects cells that use "default bg/fg" (no explicit ANSI
      // color). Openagentic's Ink TUI emits explicit truecolor RGB on every
      // cell, so this is mostly a no-op visually — it still keeps the
      // ghostty-web canvas clear-bg in sync for the brief windows where
      // openagentic hasn't yet painted every cell.
      const rend: any = (term as any).renderer;
      const wasmTerm: any = (term as any).wasmTerm;
      term.options.theme = newTheme;
      if (rend && typeof rend.setTheme === 'function') {
        rend.setTheme(newTheme);
      }
      if (rend && wasmTerm && typeof rend.render === 'function') {
        const vy = (term as any).viewportY || 0;
        rend.render(wasmTerm, true, vy, term);
      }

      const bg = newTheme.background || '';
      container.style.backgroundColor = bg;
      if (term.element) {
        term.element.style.backgroundColor = bg;
      }

      // Tell openagentic to switch its own theme to match. This is the
      // only thing that actually recolors the content inside the TUI.
      sendOpenagenticTheme(scopeEl.getAttribute('data-cm-theme'));
    };
    // Apply now if terminal exists, otherwise it'll apply on next mutation
    applyTheme();

    // Watch for data-cm-theme attribute changes (set by theme dot selector)
    // Also delayed re-apply to catch getComputedStyle timing issues
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && (m.attributeName === 'data-cm-theme' || m.attributeName === 'style')) {
          // Apply immediately, after a rAF, and after 100ms (computed styles may lag)
          applyTheme();
          requestAnimationFrame(applyTheme);
          setTimeout(applyTheme, 100);
          break;
        }
      }
    });
    observer.observe(codeModeScopeEl, { attributes: true, attributeFilter: ['data-cm-theme', 'style'] });
    return () => observer.disconnect();
  }, [theme]);

  return (
    <div
      ref={containerRef}
      className="terminal-panel"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        backgroundColor: 'var(--cm-bg, ' + (theme === 'dark' ? '#1a1a2e' : '#ffffff') + ')',
      }}
    />
  );
};

export default TerminalPanel;
