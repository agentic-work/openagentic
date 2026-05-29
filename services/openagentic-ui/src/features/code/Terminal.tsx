/**
 * Terminal — xterm.js terminal bound to the api WebSocket terminal proxy.
 *
 * Props:
 *   sessionId  — the active Code Mode session ID
 *
 * The component opens a WebSocket to /api/code/ws/terminal, forwards
 * keystrokes from xterm to the WS, and writes WS messages back into the
 * terminal.  ResizeObserver + window resize trigger fitAddon.fit() and
 * notify the API of the new dimensions via POST /api/code/sessions/:id/resize.
 *
 * Pure helper exported for unit-testing:
 *   buildTerminalWsUrl(host, proto, sessionId, token) → string
 */
import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { apiRequest } from '@/utils/api';

// ---------------------------------------------------------------------------
// Pure helper — exported so tests can assert URL correctness without needing
// a real DOM / WebSocket.
// ---------------------------------------------------------------------------

export function buildTerminalWsUrl(
  host: string,
  proto: string,
  sessionId: string,
  token: string
): string {
  return `${proto}://${host}/api/code/ws/terminal?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TerminalProps {
  sessionId: string;
}

export const Terminal: React.FC<TerminalProps> = ({ sessionId }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- xterm setup ---
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: 'var(--font-mono, "Cascadia Code", "Fira Code", monospace)',
      fontSize: 13,
      theme: {
        background: 'var(--ap-bg-0, #0d0d0d)',
        foreground: 'var(--ap-fg-1, #e0e0e0)',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // --- WebSocket ---
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('auth_token');
    const wsUrl = buildTerminalWsUrl(location.host, proto, sessionId, token || '');
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // Send initial size once the connection is established
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    // Keyboard input → WebSocket
    const termDataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // WebSocket data → terminal
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        term.write(ev.data);
      } else {
        term.write(new Uint8Array(ev.data as ArrayBuffer));
      }
    };

    ws.onerror = (err) => {
      console.warn('[Terminal] WebSocket error', err);
    };

    // --- Resize handling ---
    const sendResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        void apiRequest(`/api/code/sessions/${sessionId}/resize`, {
          method: 'POST',
          body: JSON.stringify({ cols: term.cols, rows: term.rows }),
        });
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      sendResize();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener('resize', sendResize);

    // --- Cleanup ---
    return () => {
      termDataDisposable.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('resize', sendResize);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--ap-bg-0, #0d0d0d)',
        overflow: 'hidden',
      }}
    />
  );
};

export default Terminal;
