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
