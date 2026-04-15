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
  success: 'var(--toast-success, #00D26A)',
  error: 'var(--toast-error, #FF453A)',
  info: 'var(--toast-info, #0A84FF)',
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

  return (
    <div
      className="fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-lg text-xs font-medium shadow-lg pointer-events-auto"
      style={{
        backgroundColor: color,
        color: '#FFFFFF',
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
