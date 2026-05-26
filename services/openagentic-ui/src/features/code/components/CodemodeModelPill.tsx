import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface CodemodeModelPillProps {
  sessionId: string | null;
  authToken?: string;
  /** Called with the error message when override fails (toast hook). */
  onError?: (msg: string) => void;
}

interface ModelRow {
  id: string;
  label: string;
  provider?: string;
  isDefault?: boolean;
}

export interface ModelsResponse {
  models?: ModelRow[];
  currentEffective?: string;
  defaultFromAdmin?: string;
  hasSessionOverride?: boolean;
}

/**
 * Test seam — RTL tests swap a deterministic fetch; production uses `globalThis.fetch`.
 */
export function __fetchImpl(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input as any, init);
}

export const CodemodeModelPill: React.FC<CodemodeModelPillProps> = ({
  sessionId,
  authToken,
  onError,
}) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [effective, setEffective] = useState<string>('');
  const [adminDefault, setAdminDefault] = useState<string>('');
  const [hasOverride, setHasOverride] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (authToken) h.Authorization = `Bearer ${authToken}`;
    return h;
  }, [authToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
      const res = await __fetchImpl(`/api/openagentic/v1/models${qs}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ModelsResponse;
      setRows(Array.isArray(data.models) ? data.models : []);
      setEffective(typeof data.currentEffective === 'string' ? data.currentEffective : '');
      setAdminDefault(typeof data.defaultFromAdmin === 'string' ? data.defaultFromAdmin : '');
      setHasOverride(Boolean(data.hasSessionOverride));
    } catch (err: any) {
      onError?.(`Could not load models: ${err?.message ?? String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [sessionId, authHeaders, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selectModel = useCallback(
    async (modelId: string) => {
      if (!sessionId) return;
      try {
        const res = await __fetchImpl(
          `/api/openagentic/v1/session/${encodeURIComponent(sessionId)}/model-override`,
          {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ model: modelId }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
          onError?.(msg);
          return;
        }
        const body = (await res.json()) as { effectiveModel?: string };
        if (body.effectiveModel) {
          setEffective(body.effectiveModel);
          setHasOverride(true);
        }
        setOpen(false);
      } catch (err: any) {
        onError?.(err?.message ?? String(err));
      }
    },
    [sessionId, authHeaders, onError],
  );

  const resetToDefault = useCallback(async () => {
    if (!sessionId) return;
    try {
      await __fetchImpl(
        `/api/openagentic/v1/session/${encodeURIComponent(sessionId)}/model-override`,
        { method: 'DELETE', headers: authHeaders() },
      );
      setEffective(adminDefault);
      setHasOverride(false);
      setOpen(false);
    } catch (err: any) {
      onError?.(err?.message ?? String(err));
    }
  }, [sessionId, authHeaders, adminDefault, onError]);

  const displayLabel = effective || adminDefault || '—';

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label="Codemode model picker"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid="codemode-model-pill"
        onClick={() => setOpen((o) => !o)}
        title={
          hasOverride
            ? `Session override active — click to swap or reset. Admin default: ${adminDefault}`
            : `Using admin-configured codemode model. Click to override for this session.`
        }
        style={{
          fontFamily: 'inherit',
          fontSize: 11.5,
          padding: '2px 10px',
          background: 'color-mix(in srgb, var(--cm-accent, #58a6ff) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--cm-accent, #58a6ff) 25%, transparent)',
          borderRadius: 999,
          color: 'var(--cm-accent, #58a6ff)',
          cursor: 'pointer',
          lineHeight: 1.4,
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{displayLabel}</span>
        <span style={{ opacity: 0.55, fontSize: 10, fontWeight: 400 }}>
          {hasOverride ? 'session' : 'admin'}
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          data-testid="codemode-model-pill-menu"
          style={{
            position: 'absolute',
            bottom: '100%',
            right: 0,
            marginBottom: 6,
            minWidth: 260,
            maxHeight: 320,
            overflowY: 'auto',
            background: 'var(--cm-bg-primary, #0d1117)',
            border: '1px solid var(--cm-border, #30363d)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            padding: 4,
            fontSize: 12,
            zIndex: 50,
          }}
        >
          {loading && (
            <div style={{ padding: 8, color: 'var(--cm-text-muted, #8b949e)' }}>
              loading…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <div style={{ padding: 8, color: 'var(--cm-text-muted, #8b949e)' }}>
              no code-role models registered
            </div>
          )}
          {!loading &&
            rows.map((m) => {
              const isCurrent = m.id === effective;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  data-testid={`codemode-model-option-${m.id}`}
                  onClick={() => void selectModel(m.id)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: 'none',
                    background: isCurrent
                      ? 'color-mix(in srgb, var(--cm-accent, #58a6ff) 18%, transparent)'
                      : 'transparent',
                    color: 'var(--cm-text, #e6edf3)',
                    cursor: 'pointer',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      color: isCurrent ? 'var(--cm-success, #3fb950)' : 'transparent',
                      width: '1ch',
                    }}
                  >
                    ●
                  </span>
                  <span style={{ flex: 1, fontFamily: 'monospace' }}>{m.label || m.id}</span>
                  {m.isDefault && (
                    <span style={{ fontSize: 10, opacity: 0.7 }}>admin-default</span>
                  )}
                </button>
              );
            })}
          {hasOverride && (
            <button
              type="button"
              data-testid="codemode-model-reset"
              onClick={() => void resetToDefault()}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginTop: 4,
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px dashed var(--cm-border, #30363d)',
                background: 'transparent',
                color: 'var(--cm-text-muted, #8b949e)',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              reset to admin default
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default CodemodeModelPill;
