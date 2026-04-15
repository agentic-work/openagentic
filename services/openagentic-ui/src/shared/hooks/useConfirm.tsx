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
 * useConfirm - Global promise-based confirmation dialog
 *
 * Provides a context-based confirm() that replaces window.confirm().
 * Wrap app with <ConfirmProvider> once, then call useConfirm() anywhere.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm('Delete this item?', { variant: 'danger' });
 *   if (!ok) return;
 *
 * @copyright 2026 Gnomus.ai
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { ConfirmModal } from '@/shared/components/BaseModal';

interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'primary' | 'danger';
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface ConfirmState {
  isOpen: boolean;
  message: string;
  title: string;
  confirmText: string;
  cancelText: string;
  variant: 'primary' | 'danger';
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState>({
    isOpen: false,
    message: '',
    title: 'Confirm',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'primary',
  });

  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((message, options) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({
        isOpen: true,
        message,
        title: options?.title || 'Confirm',
        confirmText: options?.confirmText || 'Confirm',
        cancelText: options?.cancelText || 'Cancel',
        variant: options?.variant || 'primary',
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    setState(prev => ({ ...prev, isOpen: false }));
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmModal
        isOpen={state.isOpen}
        onClose={handleClose}
        onConfirm={handleConfirm}
        title={state.title}
        message={state.message}
        confirmText={state.confirmText}
        cancelText={state.cancelText}
        confirmVariant={state.variant}
      />
    </ConfirmContext.Provider>
  );
};

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Fallback to window.confirm if provider not mounted (shouldn't happen)
    return (message: string) => Promise.resolve(window.confirm(message));
  }
  return ctx;
}
