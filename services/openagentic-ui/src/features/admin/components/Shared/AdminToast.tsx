import React, { useEffect, useState, useCallback, useRef } from 'react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AdminToastProps {
  toast: Toast | null;
  onDismiss?: () => void;
  /** Auto-dismiss after ms (default 3000, 0 = no auto-dismiss) */
  duration?: number;
}

const TOAST_COLORS: Record<Toast['type'], string> = {
  success: 'var(--toast-success)',
  error: 'var(--toast-error)',
  info: 'var(--toast-info)',
};

/**
 * Fixed-position toast notification with CSS variable colors.
 * Auto-dismisses after `duration` ms.
 */
export const AdminToast: React.FC<AdminToastProps> = ({
  toast,
  onDismiss,
  duration = 3000,
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (toast) {
      setVisible(true);
      if (duration > 0) {
        timerRef.current = setTimeout(() => {
          setVisible(false);
          onDismiss?.();
        }, duration);
      }
    } else {
      setVisible(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, duration, onDismiss]);

  if (!toast || !visible) return null;

  const color = TOAST_COLORS[toast.type];

  // M3 Expressive (task #160): rounded-toast (14px), soft-lg shadow,
  // slide-in from bottom-right over 300ms.
  return (
    <div
      className="fixed bottom-4 right-4 z-[100] px-4 py-2.5 rounded-toast text-xs font-medium shadow-soft-lg pointer-events-auto animate-slide-up"
      style={{
        backgroundColor: color,
        color: 'var(--ap-fg-0)',
      }}
      role="alert"
    >
      {toast.message}
    </div>
  );
};

/**
 * Hook for managing toast state with auto-dismiss.
 */
export function useAdminToast(duration = 3000) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback((type: Toast['type'], message: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = Date.now().toString();
    setToast({ id, type, message });
    if (duration > 0) {
      timerRef.current = setTimeout(() => setToast(null), duration);
    }
  }, [duration]);

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  return { toast, showToast, dismissToast };
}
