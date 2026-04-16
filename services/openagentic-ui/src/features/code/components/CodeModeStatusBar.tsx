import React, { useState, useEffect, useRef, useCallback } from 'react';

interface CodeModeStatusBarProps {
  theme?: 'light' | 'dark';
  className?: string;
  connectionState?: 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  reconnectAttempts?: number;
  /** Callback to force-close and reopen the WebSocket */
  onReconnect?: () => void;
  /** Session ID for pod metrics lookup */
  sessionId?: string;
  /** Auth token for API calls */
  token?: string;
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export const CodeModeStatusBar: React.FC<CodeModeStatusBarProps> = ({
  theme = 'dark',
  className = '',
  connectionState = 'disconnected',
  reconnectAttempts = 0,
  onReconnect,
  sessionId,
  token,
}) => {
  const isDark = theme === 'dark';
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [uptime, setUptime] = useState(0);
  const [version, setVersion] = useState<string | null>(null);
  const [podMetrics, setPodMetrics] = useState<{ cpu: number; mem: number; io: number } | null>(null);
  const connectedAtRef = useRef<number>(Date.now());

  // Uptime timer
  useEffect(() => {
    if (connectionState !== 'connected') return;
    connectedAtRef.current = Date.now();
    const timer = setInterval(() => setUptime(Date.now() - connectedAtRef.current), 1000);
    return () => clearInterval(timer);
  }, [connectionState]);

  // Latency ping (every 10s via fetch to API health)
  useEffect(() => {
    if (connectionState !== 'connected') return;
    const ping = async () => {
      try {
        const start = performance.now();
        await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
        setLatencyMs(Math.round(performance.now() - start));
      } catch { setLatencyMs(null); }
    };
    ping();
    const timer = setInterval(ping, 10000);
    return () => clearInterval(timer);
  }, [connectionState]);

  // Version — read once from API config
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const resp = await fetch('/api/openagentic/config', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (resp.ok) {
          const data = await resp.json();
          // Prefer the real pod binary version if the config endpoint
          // starts returning one; otherwise fall back to the build-time
          // platform version baked in by Vite (see vite.config.ts define).
          // A hardcoded string here would go stale on every release.
          const platformVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
          setVersion(data.version || data.cliVersion || (platformVersion ? `v${platformVersion}` : ''));
        }
      } catch {}
    })();
  }, [token]);

  // Pod metrics (every 5s) — fetched directly from the exec pod via nginx
  const [podService, setPodService] = useState<string | null>(null);
  useEffect(() => {
    if (!sessionId || connectionState !== 'connected') return;
    // Compute pod service name from userId (same sha256 hash as TerminalPanel)
    const computePodService = async () => {
      try {
        // Get userId from the token or session
        const userId = sessionId; // Fallback — actual userId would be better
        // For now try the sessionId-based pod name pattern
        // The k8s session manager uses: openagentic-{sha256(userId)[:12]}-svc
        // We can also try the direct session-based name
        setPodService(`openagentic-${sessionId.substring(0, 12).replace(/-/g, '')}-svc`);
      } catch {}
    };
    computePodService();
  }, [sessionId, connectionState]);

  useEffect(() => {
    if (!podService || connectionState !== 'connected') return;
    const fetchMetrics = async () => {
      try {
        const resp = await fetch(`/api/code/pod/${podService}/metrics`);
        if (resp.ok) {
          const data = await resp.json();
          setPodMetrics({
            cpu: data.cpu || 0,
            mem: data.mem || 0,
            io: data.io || 0,
          });
        }
      } catch {
        setPodMetrics(null);
      }
    };
    fetchMetrics();
    const timer = setInterval(fetchMetrics, 5000);
    return () => clearInterval(timer);
  }, [podService, connectionState]);

  const connDot = (() => {
    switch (connectionState) {
      case 'connected': return { color: '#22C55E', label: latencyMs ? `${latencyMs}ms` : 'Connected' };
      case 'connecting': return { color: '#58a6ff', label: 'Connecting...' };
      case 'reconnecting': return { color: '#d29922', label: `Reconnecting (${reconnectAttempts})` };
      case 'error': return { color: '#f85149', label: 'Error' };
      default: return { color: '#f85149', label: 'Disconnected' };
    }
  })();

  // Mini bar chart (3 lines for cpu/mem/io)
  const MiniBar: React.FC<{ value: number; max: number; color: string; label: string }> = ({ value, max, color, label }) => {
    const pct = Math.min(100, (value / max) * 100);
    return (
      <div className="flex items-center gap-1" title={`${label}: ${value.toFixed(1)}`}>
        <span className="text-[9px] font-mono opacity-50 w-[18px]">{label}</span>
        <div className="w-[40px] h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: isDark ? '#333' : '#ddd' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  };

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-between px-3 gap-3 border-t select-none ${isDark ? 'bg-[#0d1117] border-[#30363d]' : 'bg-gray-50 border-gray-200'} ${className}`}
      style={{ minHeight: '26px', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}
    >
      {/* Left: connection dot + latency + reconnect */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5" title={`Connection: ${connDot.label}`}>
          <span style={{ color: connDot.color, fontSize: '8px' }}>●</span>
          <span className="opacity-70" style={{ color: connDot.color }}>{connDot.label}</span>
        </div>

        {connectionState !== 'connected' && onReconnect && (
          <button
            onClick={onReconnect}
            className="text-[10px] px-1.5 py-0.5 rounded border opacity-70 hover:opacity-100 transition-opacity"
            style={{ borderColor: '#58a6ff', color: '#58a6ff' }}
          >
            Reconnect
          </button>
        )}

        {version && (
          <span className="opacity-40" title={`OpenAgentic ${version}`}>
            {version}
          </span>
        )}

        {connectionState === 'connected' && (
          <span className="opacity-30" title="Session uptime">
            ↑{formatUptime(uptime)}
          </span>
        )}
      </div>

      {/* Right: pod metrics */}
      <div className="flex items-center gap-3">
        {podMetrics ? (
          <div className="flex items-center gap-2">
            <MiniBar value={podMetrics.cpu} max={100} color="#58a6ff" label="cpu" />
            <MiniBar value={podMetrics.mem} max={2048} color="#22C55E" label="mem" />
            <MiniBar value={podMetrics.io} max={1000} color="#d29922" label="io" />
          </div>
        ) : (
          connectionState === 'connected' && (
            <span className="opacity-20">metrics unavailable</span>
          )
        )}
      </div>
    </div>
  );
};

export default CodeModeStatusBar;
