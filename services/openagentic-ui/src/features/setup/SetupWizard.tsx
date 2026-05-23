/**
 * First-run Setup wizard. Lives at /setup. App.tsx redirects here when
 *   GET /api/setup/status → { needsSetup: true }
 *
 * Single-card form (no multi-step) — the whole pitch is "5 minutes to
 * first chat", so we collect the minimum: admin email/password + Ollama
 * host + chat model + embedding model. Cloud-mgmt creds are handled
 * out-of-band (host-CLI mounts in mcp-proxy), so we don't ask here.
 *
 * On submit:
 *   - POST /api/setup/probe-ollama to populate the model dropdowns
 *   - POST /api/setup/complete → { token }
 *   - localStorage.setItem('auth_token', token)
 *   - window.location.replace('/chat')
 *
 * Mirrors MagicLinkHandler's JWT-storage + hard-redirect pattern so
 * AuthContext picks the session up cleanly.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiEndpoint } from '@/utils/api';
import { Input } from '@/shared/ui/Input';
import { Button } from '@/shared/ui/Button';

type Phase = 'form' | 'probing' | 'submitting' | 'done';

interface ProbeResult {
  ok: boolean;
  chat: string[];
  embed: string[];
}

// install.sh writes MAGIC_BOOT_TOKEN to .env and opens
// /auth/magic?token=<token>. MagicLinkHandler exchanges it for a JWT and
// hard-redirects to /. If the *first* destination after that redirect is
// /setup (because nothing exists yet), we no longer have the magic token.
// Workaround: stash it in sessionStorage before the magic exchange so we
// can replay it here to satisfy the setup-already-done overwrite guard.
const stashedMagic = (): string | undefined => {
  try { return window.sessionStorage.getItem('mb_token') || undefined; }
  catch { return undefined; }
};

export const SetupWizard: React.FC = () => {
  const nav = useNavigate();

  const [email, setEmail] = useState('admin@openagentic.local');
  const [password, setPassword] = useState('');
  const [ollamaHost, setOllamaHost] = useState('http://host.docker.internal:11434');
  const [chatModel, setChatModel] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);

  // Auto-probe on first mount so the dropdowns are pre-populated if Ollama
  // is reachable. Silently no-ops on failure — user can hit "Probe" to retry.
  useEffect(() => {
    void runProbe(ollamaHost, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runProbe = async (host: string, silent = false) => {
    setPhase('probing'); setError(null);
    try {
      const r = await fetch(apiEndpoint('/setup/probe-ollama'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `probe failed (HTTP ${r.status})`);
      setProbe(data);
      // Auto-pick sensible defaults so the user can just hit Start.
      if (data.chat?.length && !chatModel) {
        const pref = data.chat.find((m: string) => /gpt-oss|llama|mistral|qwen/.test(m)) || data.chat[0];
        setChatModel(pref);
      }
      if (data.embed?.length && !embedModel) {
        const pref = data.embed.find((m: string) => /nomic-embed|mxbai/.test(m)) || data.embed[0];
        setEmbedModel(pref);
      }
    } catch (e: any) {
      if (!silent) setError(e?.message || 'probe failed');
      setProbe(null);
    } finally {
      setPhase('form');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!chatModel) {
      setError('Pick a chat model. Click Probe to discover what Ollama has.');
      return;
    }
    setPhase('submitting');
    try {
      const r = await fetch(apiEndpoint('/setup/complete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminEmail: email,
          adminPassword: password,
          ollamaHost,
          chatModel,
          embedModel: embedModel || undefined,
          magicToken: stashedMagic(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `setup failed (HTTP ${r.status})`);
      if (!data?.token) throw new Error('setup response missing token');
      // Mirror MagicLinkHandler — store JWT, hard-redirect so AuthContext
      // re-initializes against the freshly-seeded admin user.
      localStorage.setItem('auth_token', data.token);
      try { window.sessionStorage.removeItem('mb_token'); } catch { /* ignore */ }
      setPhase('done');
      window.location.replace('/chat');
    } catch (e: any) {
      setError(e?.message || 'setup failed');
      setPhase('form');
    }
  };

  const probing = phase === 'probing';
  const submitting = phase === 'submitting';

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <form
        onSubmit={submit}
        className="w-full max-w-xl glass-card"
        style={{ padding: 32 }}
      >
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-text-primary">Welcome to openagentic</h1>
          <p className="text-sm text-text-secondary mt-1">
            Pick an admin password and a model. You'll be chatting in 30 seconds.
          </p>
        </header>

        <section className="space-y-4">
          <Input
            label="Admin email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <Input
            label="Admin password (≥ 8 chars)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />

          <div className="space-y-2">
            <Input
              label="Ollama host"
              type="url"
              value={ollamaHost}
              onChange={(e) => setOllamaHost(e.target.value)}
              placeholder="http://host.docker.internal:11434"
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => runProbe(ollamaHost)}
                disabled={probing}
              >
                {probing ? 'Probing…' : 'Probe Ollama'}
              </Button>
              {probe && (
                <span className="text-xs text-text-secondary">
                  found {probe.chat.length} chat + {probe.embed.length} embedding models
                </span>
              )}
            </div>
          </div>

          <ModelSelect
            label="Chat model"
            value={chatModel}
            onChange={setChatModel}
            options={probe?.chat || []}
            placeholder="e.g. gpt-oss:20b"
          />
          <ModelSelect
            label="Embedding model (optional)"
            value={embedModel}
            onChange={setEmbedModel}
            options={probe?.embed || []}
            placeholder="e.g. nomic-embed-text"
            optional
          />
        </section>

        {error && (
          <div className="mt-4 text-sm" style={{ color: 'var(--color-error, #f87171)' }}>
            {error}
          </div>
        )}

        <footer className="mt-6 flex items-center justify-between">
          <span className="text-xs text-text-secondary">
            Configure providers, MCPs, and more later from the admin panel.
          </span>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Start'}
          </Button>
        </footer>
      </form>
    </div>
  );
};

interface ModelSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  optional?: boolean;
}

const ModelSelect: React.FC<ModelSelectProps> = ({
  label, value, onChange, options, placeholder, optional,
}) => {
  // If the probe came back with options, render a select. Otherwise allow
  // free-text so the user can type a model name they intend to install.
  if (options.length > 0) {
    return (
      <div>
        <label className="block text-sm text-text-primary mb-1">{label}</label>
        <select
          className="block w-full rounded-input-sm px-4 py-2.5 text-sm bg-surface-1 text-text-primary border border-border-primary focus:outline-none focus:shadow-focus-ring focus:border-accent-primary"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {optional && <option value="">— none —</option>}
          {options.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <Input
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={!optional}
    />
  );
};

export default SetupWizard;
