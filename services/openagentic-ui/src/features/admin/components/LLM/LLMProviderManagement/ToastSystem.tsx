/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
          backgroundColor: t.type === 'success' ? 'rgba(0,210,106,0.15)' : t.type === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
          border: `1px solid ${t.type === 'success' ? '#00D26A' : t.type === 'error' ? '#ef4444' : '#6366f1'}40`,
          color: t.type === 'success' ? '#00D26A' : t.type === 'error' ? '#ef4444' : '#6366f1',
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
