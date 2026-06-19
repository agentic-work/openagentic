/**
 * CodemodeDownloadPage — the OSS "Code Mode" view.
 *
 * OSS does NOT ship the codemode IDE (enterprise). Instead, Code Mode is a
 * download page for the **agenticode** desktop app (a local coding agent). The
 * two platform builds are served BY this openagentic instance, and the app is
 * bound to THIS instance as its model provider: the "Connect" action fires the
 * `agenticode://connect?base_url=<this-origin>` deep link (optionally carrying a
 * freshly-minted API key) so the installed app talks only to the endpoint it
 * was downloaded from — its `{base_url}/api/agenticode/v1/messages` provider.
 *
 * CSS-variable design system only (no hardcoded hex) — matches the admin chrome.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Download, Check, Monitor, Terminal, Link2, Copy } from '@/shared/icons';

interface PlatformBuild {
  available: boolean;
  version?: string;
  size?: string;
  filename?: string;
}
interface DownloadsManifest {
  windows: PlatformBuild;
  macos: PlatformBuild;
}

// The instance origin the downloaded app must bind to (the provider endpoint).
const INSTANCE_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';

export const CodemodeDownloadPage: React.FC = () => {
  const [manifest, setManifest] = useState<DownloadsManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectStatus, setConnectStatus] = useState<'idle' | 'minting' | 'launched' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  const fetchManifest = useCallback(async () => {
    try {
      const r = await fetch('/api/agenticode/downloads', { credentials: 'include' });
      if (r.ok) setManifest(await r.json());
      else setManifest({ windows: { available: false }, macos: { available: false } });
    } catch {
      setManifest({ windows: { available: false }, macos: { available: false } });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { fetchManifest(); }, [fetchManifest]);

  // Connect: mint a scoped API key (best-effort) and deep-link the installed app
  // to THIS instance so it provisions base_url (+ key) automatically.
  const handleConnect = useCallback(async () => {
    setConnectStatus('minting');
    let key = '';
    try {
      const r = await fetch('/api/admin/tokens', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'agenticode-desktop', scopes: ['chat'] }),
      });
      if (r.ok) { const d = await r.json(); key = d.token || d.key || d.apiKey || ''; }
    } catch { /* minting is best-effort — fall back to base_url-only binding */ }
    const params = new URLSearchParams({ base_url: INSTANCE_ORIGIN });
    if (key) params.set('key', key);
    try {
      window.location.href = `agenticode://connect?${params.toString()}`;
      setConnectStatus('launched');
    } catch {
      setConnectStatus('error');
    }
  }, []);

  const copyOrigin = useCallback(() => {
    navigator.clipboard?.writeText(INSTANCE_ORIGIN).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, []);

  const card = (
    os: 'windows' | 'macos',
    label: string,
    Icon: React.FC<any>,
    ext: string,
    build: PlatformBuild | undefined,
  ) => {
    const available = !!build?.available;
    return (
      <div
        className="flex-1 rounded-xl p-6 flex flex-col items-center text-center transition-colors"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-accent, var(--color-primary))')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
      >
        <Icon size={44} style={{ color: 'var(--text-primary)' }} />
        <div className="mt-3 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>agenticode for {label}</div>
        <div className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-code)' }}>
          {available ? `${build?.version || ''} ${build?.size ? '· ' + build.size : ''}` : 'build pending'}
        </div>
        {available ? (
          <a
            href={`/api/agenticode/download/${os}`}
            className="mt-4 flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: 'var(--color-accent, var(--color-primary))', color: 'var(--ap-fg-0)' }}
          >
            <Download size={14} /> Download {ext}
          </a>
        ) : (
          <div
            className="mt-4 px-4 py-2 rounded-md text-xs font-semibold cursor-not-allowed"
            style={{ border: '1px dashed var(--color-border)', color: 'var(--text-tertiary)' }}
            title="No build published yet"
          >
            Coming soon
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Code Mode</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <strong>agenticode</strong> is a local coding agent that runs on your machine and uses
          <strong> this openagentic instance</strong> as its model provider — your code never leaves your box,
          and inference runs through the endpoint you downloaded it from.
        </p>
      </div>

      {loading ? (
        <div className="text-center text-sm py-10" style={{ color: 'var(--text-tertiary)' }}>Loading downloads…</div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {card('windows', 'Windows', Monitor, '(.exe)', manifest?.windows)}
          {card('macos', 'macOS', Terminal, '(.dmg)', manifest?.macos)}
        </div>
      )}

      {/* Bind-to-instance */}
      <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--color-surfaceSecondary, color-mix(in srgb, var(--color-border) 18%, transparent))', border: '1px solid var(--color-border)' }}>
        <div className="text-[11px] font-bold uppercase mb-2" style={{ color: 'var(--text-tertiary)', letterSpacing: '1px' }}>
          After install — bind to this instance
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Provider endpoint:&nbsp;
            <code style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-code)' }}>{INSTANCE_ORIGIN}</code>
            <button onClick={copyOrigin} className="ml-2 inline-flex items-center align-middle hover:opacity-70" style={{ color: 'var(--text-tertiary)' }} title="Copy">
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
          <button
            onClick={handleConnect}
            disabled={connectStatus === 'minting'}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent, var(--color-primary))', color: 'var(--ap-fg-0)' }}
          >
            <Link2 size={14} />
            {connectStatus === 'minting' ? 'Provisioning…' : connectStatus === 'launched' ? 'Opening agenticode…' : 'Connect agenticode'}
          </button>
        </div>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          Connect opens the installed app via <code style={{ fontFamily: 'var(--font-code)' }}>agenticode://</code> and points it at this
          instance. The app will <strong>only</strong> use this endpoint as its provider.
        </p>
      </div>
    </div>
  );
};

export default CodemodeDownloadPage;
