/**

 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from '@/shared/icons';

export interface NotificationProps {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  onClose: (id: string) => void;
  duration?: number;
}

const Notification: React.FC<NotificationProps> = ({ 
  id, 
  message, 
  type, 
  onClose, 
  duration = 5000 
}) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose(id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, onClose]);

  const icons = {
    success: <CheckCircle size={20} />,
    error: <XCircle size={20} />,
    info: <Info size={20} />,
    warning: <AlertTriangle size={20} />
  };

  const colors = {
    success: 'bg-success',
    error: 'bg-error',
    info: 'bg-info',
    warning: 'bg-warning'
  };

  return (
    // Neo-brutalist toast: 2px ink border, sharp corners, hard offset shadow,
    // slide-in from bottom-right over 300ms ease-out.
    <motion.div
      initial={{ opacity: 0, x: 24, y: 12 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] }}
      className={`${colors[type]} text-on-accent border-ink shadow-hard-sm p-4 flex items-center gap-3 min-w-[300px] max-w-[500px]`}
    >
      {icons[type]}
      <p className="flex-1">{message}</p>
      <button
        onClick={() => onClose(id)}
        className="hover:opacity-80 rounded-btn p-1 transition-[opacity,transform] duration-200 ease-emphasized active:scale-[0.98]"
      >
        <X size={16} />
      </button>
    </motion.div>
  );
};

export interface NotificationContainerProps {
  notifications: NotificationProps[];
  onClose: (id: string) => void;
}

export const NotificationContainer: React.FC<NotificationContainerProps> = ({ 
  notifications, 
  onClose 
}) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      <AnimatePresence>
        {notifications.map((notification) => (
          <Notification
            key={notification.id}
            {...notification}
            onClose={onClose}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};

// Hook to use notifications
export const useNotifications = () => {
  const [notifications, setNotifications] = React.useState<NotificationProps[]>([]);

  const showNotification = React.useCallback((
    message: string, 
    type: 'success' | 'error' | 'info' | 'warning' = 'info'
  ) => {
    const id = `notification-${Date.now()}-${Math.random()}`;
    setNotifications(prev => [...prev, { id, message, type, onClose: removeNotification }]);
  }, []);

  const removeNotification = React.useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Make showNotification available globally
  React.useEffect(() => {
    window.showNotification = showNotification;
    return () => {
      delete window.showNotification;
    };
  }, [showNotification]);

  return { notifications, showNotification, removeNotification };
};