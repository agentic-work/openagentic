/**
 * Multi-toast system with per-toast dismiss — richer than the shared AdminToast.
 */
import React, { useState, useCallback } from 'react';
import { X as XIcon } from '@/shared/icons';
import { CheckCircle, XCircle, AlertCircle } from '../../Shared/AdminIcons';
import type { Toast } from './types';

export const ToastContainer: React.FC<{ toasts: Toast[]; onDismiss: (id: string) => void }> = ({ toasts, onDismiss }) => (
  <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
    {toasts.map(t => (
      <div key={t.id} className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium"
        style={{
          backgroundColor: t.type === 'success' ? 'color-mix(in srgb, var(--color-ok) 15%, transparent)' : t.type === 'error' ? 'color-mix(in srgb, var(--color-err) 15%, transparent)' : 'color-mix(in srgb, var(--ap-accent) 15%, transparent)',
          border: `1px solid ${t.type === 'success' ? 'var(--ap-ok)' : t.type === 'error' ? 'var(--ap-err)' : 'var(--ap-accent)'}40`,
          color: t.type === 'success' ? 'var(--ap-ok)' : t.type === 'error' ? 'var(--ap-err)' : 'var(--ap-accent)',
        }}>
        {t.type === 'success' ? <CheckCircle size={16} /> : t.type === 'error' ? <XCircle size={16} /> : <AlertCircle size={16} />}
        <span>{t.message}</span>
        <button onClick={() => onDismiss(t.id)} className="ml-2 opacity-60 hover:opacity-100"><XIcon size={14} /></button>
      </div>
    ))}
  </div>
);

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((type: Toast['type'], message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  return { toasts, show, dismiss };
}
