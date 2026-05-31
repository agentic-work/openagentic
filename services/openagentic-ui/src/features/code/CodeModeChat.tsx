/**
 * CodeModeChat — the stream-json codemode UI (NO xterm).
 *
 * Connects to /api/code/ws/chat (api → exec → `claude --output-format
 * stream-json`) and renders Claude Code's structured NDJSON events as native
 * React components — thinking blocks, tool cards, text, and a result footer —
 * instead of writing raw terminal bytes into an xterm. The browser sends a user
 * turn as `{ text }`; exec wraps it into claude's stream-json user message.
 *
 * This is the "simple way without xterm" — proven against a live `claude`
 * process and ported here. Selected via CodeModePanel when the session was
 * created with mode:'chat'.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';

export function buildChatWsUrl(host: string, proto: string, sessionId: string, token: string): string {
  return `${proto}://${host}/api/code/ws/chat?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
}

type Block =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; result?: string; done?: boolean };

interface Turn { role: 'user' | 'assistant'; model?: string; blocks: Block[] }

interface CodeModeChatProps { sessionId: string }

export const CodeModeChat: React.FC<CodeModeChatProps> = ({ sessionId }) => {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [session, setSession] = useState<{ model?: string; cwd?: string; tools?: number } | null>(null);
  const [state, setState] = useState<'connecting' | 'ready' | 'running' | 'done'>('connecting');
  const [draft, setDraft] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const toolIndex = useRef<Record<string, [number, number]>>({}); // tool_use_id → [turnIdx, blockIdx]
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; });
  }, []);

  const handleEvent = useCallback((e: any) => {
    if (e.type === 'system' && e.subtype === 'init') {
      setSession({ model: e.model, cwd: e.cwd, tools: Array.isArray(e.tools) ? e.tools.length : undefined });
      setState('ready');
      return;
    }
    if (e.type === 'assistant' && e.message) {
      const blocks: Block[] = [];
      for (const b of e.message.content || []) {
        if (b.type === 'thinking') blocks.push({ kind: 'thinking', text: b.thinking || '' });
        else if (b.type === 'text') blocks.push({ kind: 'text', text: b.text || '' });
        else if (b.type === 'tool_use') blocks.push({ kind: 'tool', id: b.id, name: b.name, input: b.input });
      }
      setState('running');
      setTurns(prev => {
        const next = [...prev, { role: 'assistant' as const, model: e.message.model, blocks }];
        const ti = next.length - 1;
        blocks.forEach((b, bi) => { if (b.kind === 'tool') toolIndex.current[(b as any).id] = [ti, bi]; });
        return next;
      });
      scrollToEnd();
      return;
    }
    if (e.type === 'user' && e.message) {
      for (const b of e.message.content || []) {
        if (b.type === 'tool_result') {
          const loc = toolIndex.current[b.tool_use_id];
          if (loc) {
            let r = b.content;
            if (Array.isArray(r)) r = r.map((x: any) => x.text || JSON.stringify(x)).join('\n');
            if (typeof r !== 'string') r = JSON.stringify(r);
            setTurns(prev => {
              const next = prev.map(t => ({ ...t, blocks: [...t.blocks] }));
              const [ti, bi] = loc;
              const blk = next[ti]?.blocks[bi];
              if (blk && blk.kind === 'tool') next[ti].blocks[bi] = { ...blk, result: (r as string).slice(0, 4000), done: true };
              return next;
            });
          }
        }
      }
      scrollToEnd();
      return;
    }
    if (e.type === 'result') {
      setState('done');
      scrollToEnd();
    }
  }, [scrollToEnd]);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const token = localStorage.getItem('auth_token') || '';
    const ws = new WebSocket(buildChatWsUrl(location.host, proto, sessionId, token));
    wsRef.current = ws;
    let buf = '';
    ws.onmessage = (ev) => {
      buf += typeof ev.data === 'string' ? ev.data : '';
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) { const s = line.trim(); if (!s) continue; try { handleEvent(JSON.parse(s)); } catch { /* skip */ } }
    };
    ws.onclose = () => setState(s => (s === 'connecting' ? 'connecting' : s));
    return () => { try { ws.close(); } catch { /* ignore */ } };
  }, [sessionId, handleEvent]);

  const send = () => {
    const text = draft.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    setTurns(prev => [...prev, { role: 'user', blocks: [{ kind: 'text', text }] }]);
    wsRef.current.send(JSON.stringify({ text }));
    setDraft(''); setState('running'); scrollToEnd();
  };

  return (
    <div className="cm-chat" style={S.root}>
      <div style={S.statusBar}>
        <span style={{ color: 'var(--signal,#FF5722)' }}>⌥</span>
        <span style={S.dim}>codemode · stream-json</span>
        {session?.model && <span style={S.pill}>{String(session.model).split('.').pop()}</span>}
        {session?.tools != null && <span style={S.dim}>{session.tools} tools</span>}
        <span style={{ marginLeft: 'auto', ...S.dim }}>{state}</span>
      </div>
      <div ref={scrollRef} style={S.transcript}>
        {turns.map((t, i) => (
          <div key={i} style={S.turn}>
            <div style={S.role}>{t.role === 'user' ? 'you' : `claude code${t.model ? ' · ' + String(t.model).split('.').pop() : ''}`}</div>
            {t.role === 'user'
              ? <div style={S.userBubble}>{t.blocks.map(b => (b as any).text).join('')}</div>
              : t.blocks.map((b, j) => <BlockView key={j} b={b} />)}
          </div>
        ))}
      </div>
      <div style={S.composer}>
        <textarea
          style={S.input} value={draft} placeholder="Ask codemode…  (Claude Code via stream-json, rendered as React)"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button style={S.send} onClick={send}>Send</button>
      </div>
    </div>
  );
};

const BlockView: React.FC<{ b: Block }> = ({ b }) => {
  if (b.kind === 'thinking') {
    return <details style={S.think}><summary style={S.thinkSum}>◇ thought</summary><div style={S.thinkBody}>{b.text}</div></details>;
  }
  if (b.kind === 'text') {
    return <div style={S.text}>{b.text}</div>;
  }
  return (
    <div style={S.tool}>
      <div style={S.toolHd}><span style={{ color: 'var(--signal,#FF5722)' }}>⚙</span><b>{b.name}</b>
        <span style={{ ...S.toolSt, color: b.done ? 'var(--ok,#22C55E)' : 'var(--warn,#F59E0B)' }}>{b.done ? 'done' : 'running'}</span></div>
      <div style={S.io}><b style={{ color: 'var(--signal-2,#FFB87E)' }}>input</b>{'\n'}{JSON.stringify(b.input, null, 2).slice(0, 600)}</div>
      {b.result != null && <div style={S.io}><b style={{ color: 'var(--signal-2,#FFB87E)' }}>result</b>{'\n'}{b.result}</div>}
    </div>
  );
};

const mono = "var(--font-mono,'JetBrains Mono',monospace)";
const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--color-background,#18130C)', color: 'var(--color-text,#F4EFE6)' },
  statusBar: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', fontFamily: mono, fontSize: 12, borderBottom: '1px solid var(--color-border,rgba(244,239,230,.1))' },
  dim: { color: 'var(--color-text-muted,#968B76)', fontSize: 11 },
  pill: { fontFamily: mono, fontSize: 10, color: 'var(--signal,#FF5722)', border: '1px solid rgba(255,87,34,.4)', borderRadius: 5, padding: '1px 7px' },
  transcript: { flex: 1, overflow: 'auto', padding: '16px 18px' },
  turn: { maxWidth: 860, margin: '0 auto 14px' },
  role: { fontFamily: mono, fontSize: 11, color: 'var(--color-text-muted,#968B76)', marginBottom: 5 },
  userBubble: { background: 'var(--surface-2,#2C2418)', border: '1px solid var(--color-border,rgba(244,239,230,.1))', borderRadius: 10, padding: '9px 13px', fontSize: 14.5, whiteSpace: 'pre-wrap' },
  text: { fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: '4px 0' },
  think: { margin: '6px 0', border: '1px solid var(--color-border,rgba(244,239,230,.1))', borderRadius: 8, background: 'rgba(255,184,126,.04)' },
  thinkSum: { cursor: 'pointer', padding: '6px 11px', fontFamily: mono, fontSize: 12, color: 'var(--signal-2,#FFB87E)' },
  thinkBody: { padding: '0 11px 9px', fontFamily: mono, fontSize: 12, color: 'var(--color-text-muted,#968B76)', whiteSpace: 'pre-wrap', lineHeight: 1.5 },
  tool: { margin: '7px 0', border: '1px solid var(--color-border,rgba(244,239,230,.1))', borderRadius: 9, overflow: 'hidden', background: 'var(--surface-1,#211A11)' },
  toolHd: { display: 'flex', gap: 8, alignItems: 'center', padding: '7px 11px', fontFamily: mono, fontSize: 13 },
  toolSt: { marginLeft: 'auto', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em' },
  io: { borderTop: '1px solid var(--color-border,rgba(244,239,230,.1))', padding: '8px 11px', fontFamily: mono, fontSize: 12, color: 'var(--color-text-muted,#968B76)', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' },
  composer: { display: 'flex', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--color-border,rgba(244,239,230,.1))', background: 'var(--surface-1,#211A11)' },
  input: { flex: 1, resize: 'none', minHeight: 44, maxHeight: 160, background: 'var(--surface-2,#2C2418)', border: '1px solid var(--color-border,rgba(244,239,230,.1))', borderRadius: 10, color: 'var(--color-text,#F4EFE6)', fontFamily: 'var(--font-sans,Inter,sans-serif)', fontSize: 14, padding: '10px 13px', outline: 'none' },
  send: { fontFamily: mono, fontWeight: 600, color: 'var(--color-background,#18130C)', background: 'linear-gradient(135deg,#FF5722,#E64A19)', border: 'none', borderRadius: 10, padding: '10px 18px', cursor: 'pointer' },
};

export default CodeModeChat;
