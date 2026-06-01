import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageCircle, Settings as SettingsIcon, Coins, LineChart, Shield } from '@/shared/icons';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/providers/AuthContext';

interface LayoutProps {
  children: React.ReactNode;
  theme: 'light' | 'dark';
  onNewChat?: () => void;
  onToggleTokens?: () => void;
  onOpenMonitor?: () => void;
  onToggleSidebar?: () => void;
  showTokens?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children, theme, onNewChat, onToggleTokens, onOpenMonitor, onToggleSidebar, showTokens }) => {
  const location = useLocation();
  const { user } = useAuth();
  const isOnChat = location.pathname === '/';
  
  // Check if user is admin
  const adminGroup = import.meta.env.VITE_AZURE_AD_ADMIN_GROUP || 'OpenAgenticAdmins';
  const isAdmin = user?.groups?.includes(adminGroup) || false;
  
  const navItems = [
    { path: '/', icon: MessageCircle, label: 'Chat' }
  ];
  
  // Get onToggleTools from props if available
  const onToggleTools = (window as any).__toggleMCPFunctions;
  
  // Action buttons - removed Token Usage as it's now in settings dropdown
  const actionButtons: any[] = [
    // Token Usage moved to settings dropdown in Chat component
  ];
  
  return (
    <div className="flex h-screen relative">
      {/* Background is now global in App.tsx via WebGLBackground */}

      {/* Sidebar — neo-brutalist field-guide rail: paper surface, 2px ink
          right-rule, sharp-cornered nav cells, mono tooltips. */}
      <aside className="w-16 bg-surface border-r-2 border-rule-strong flex flex-col items-center py-6 relative z-20">
        <nav className="space-y-2">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path;

            // Special handling for chat icon with sidebar toggle
            if (path === '/' && onToggleSidebar) {
              return (
                <div key={path} className="relative group">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={onToggleSidebar}
                    className={`p-3 rounded-none border-2 transition-colors ${
                      isActive
                        ? 'bg-accent text-on-accent border-rule-strong shadow-hard-xs'
                        : 'bg-transparent text-fg-muted border-transparent hover:text-fg hover:bg-surface-2 hover:border-rule'
                    }`}
                  >
                    <Icon size={20} />
                  </motion.button>

                  {/* Tooltip */}
                  <div className="eyebrow absolute left-full ml-2 px-2 py-1 rounded-none border-2 border-rule-strong bg-surface text-fg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-hard-xs">
                    Toggle Chats
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={path}
                to={path}
                className="relative group block"
                title={label}
              >
                <motion.div
                  whileTap={{ scale: 0.95 }}
                  className={`p-3 rounded-none border-2 transition-colors ${
                    isActive
                      ? 'bg-accent text-on-accent border-rule-strong shadow-hard-xs'
                      : 'bg-transparent text-fg-muted border-transparent hover:text-fg hover:bg-surface-2 hover:border-rule'
                  }`}
                >
                  <Icon size={20} />
                </motion.div>

                {/* Tooltip */}
                <div className="eyebrow absolute left-full ml-2 px-2 py-1 rounded-none border-2 border-rule-strong bg-surface text-fg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-hard-xs">
                  {label}
                </div>
              </Link>
            );
          })}

          {/* Action buttons - moved here under chat icon */}
          {actionButtons.length > 0 && actionButtons.map(({ action, icon: Icon, label, active }) => (
                <motion.div key={label} className="relative group">
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={action}
                    disabled={!action}
                    className={`p-3 rounded-none border-2 transition-colors ${
                      !action
                        ? 'text-fg-subtle border-transparent cursor-not-allowed'
                        : active
                        ? 'bg-accent text-on-accent border-rule-strong shadow-hard-xs'
                        : 'bg-transparent text-fg-muted border-transparent hover:text-fg hover:bg-surface-2 hover:border-rule'
                    }`}
                  >
                    <Icon size={20} />
                  </motion.button>

                  {/* Tooltip */}
                  <div className="eyebrow absolute left-full ml-2 px-2 py-1 rounded-none border-2 border-rule-strong bg-surface text-fg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-hard-xs">
                    {label}
                  </div>
                </motion.div>
          ))}
        </nav>
        
        {/* Spacer */}
        <div className="flex-1" />
        
        {/* Settings and Admin at the bottom */}
        <div className="mb-6 space-y-2">
          {/* Admin Portal - Only visible to admins */}
          {isAdmin && (
            <Link
              to="/admin"
              className="relative group block"
            >
              <motion.div
                whileTap={{ scale: 0.95 }}
                className={`p-3 rounded-none border-2 transition-colors ${
                  location.pathname === '/admin'
                    ? 'bg-err text-on-accent border-rule-strong shadow-hard-xs'
                    : 'bg-transparent text-fg-muted border-transparent hover:text-fg hover:bg-surface-2 hover:border-rule'
                }`}
              >
                <Shield size={20} />
              </motion.div>

              {/* Tooltip */}
              <div className="eyebrow absolute left-full ml-2 px-2 py-1 rounded-none border-2 border-rule-strong bg-surface text-fg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-hard-xs">
                Admin Portal
              </div>
            </Link>
          )}
          
          {/* 2026-05-07 — legacy /settings route ripped (it was a duplicate
              of admin v3 panes). Sidebar settings icon now bounces straight
              to /admin#integrations where tenant-wide config (GitHub OAuth,
              providers, MCP) actually lives. Per-user GitHub OAuth surfaces
              inside codemode (where it's used). */}
          <Link
            to="/admin#integrations"
            className="relative group block"
            title="Settings (admin)"
          >
            <motion.div
              whileTap={{ scale: 0.95 }}
              className={`p-3 rounded-none border-2 transition-colors ${
                location.pathname.startsWith('/admin')
                  ? 'bg-accent text-on-accent border-rule-strong shadow-hard-xs'
                  : 'bg-transparent text-fg-muted border-transparent hover:text-fg hover:bg-surface-2 hover:border-rule'
              }`}
            >
              <SettingsIcon size={20} />
            </motion.div>

            {/* Tooltip */}
            <div className="eyebrow absolute left-full ml-2 px-2 py-1 rounded-none border-2 border-rule-strong bg-surface text-fg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50 shadow-hard-xs">
              Settings
            </div>
          </Link>
        </div>
      </aside>
      
      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Header with auth */}
        <header className="bg-surface border-b-2 border-rule-strong px-6 py-4 flex justify-end items-center relative z-10">
          {/* Auth component rendered here */}
        </header>
        
        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
