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

      {/* Sidebar */}
      <aside className="w-16 glass-adaptive flex flex-col items-center py-6 relative z-20">
        <nav className="space-y-2">
          {navItems.map(({ path, icon: Icon, label }) => {
            const isActive = location.pathname === path;

            // Special handling for chat icon with sidebar toggle
            if (path === '/' && onToggleSidebar) {
              return (
                <div key={path} className="relative group">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={onToggleSidebar}
                    className={`p-3 rounded-lg transition-all ${
                      isActive
                        ? 'theme-bg-secondary theme-text-primary'
                        : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-secondary/50'
                    }`}
                  >
                    <Icon size={20} />
                  </motion.button>
                  
                  {/* Tooltip */}
                  <div className="absolute left-full ml-2 px-2 py-1 rounded theme-bg-tertiary theme-text-primary text-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                    Toggle Chats
                  </div>
                </div>
              );
            }
            
            return (
              <Link
                key={path}
                to={path}
                className="relative group"
                title={label}
              >
                <motion.div
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className={`p-3 rounded-lg transition-all ${
                    isActive
                      ? 'theme-bg-secondary theme-text-primary'
                      : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-secondary/50'
                  }`}
                >
                  <Icon size={20} />
                </motion.div>
                
                {/* Tooltip */}
                <div className="absolute left-full ml-2 px-2 py-1 rounded theme-bg-tertiary theme-text-primary text-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                  {label}
                </div>
              </Link>
            );
          })}
          
          {/* Action buttons - moved here under chat icon */}
          {actionButtons.length > 0 && actionButtons.map(({ action, icon: Icon, label, active }) => (
                <motion.div key={label} className="relative group">
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={action}
                    disabled={!action}
                    className={`p-3 rounded-lg transition-all ${
                      !action
                        ? 'theme-text-muted cursor-not-allowed'
                        : active
                        ? 'bg-info theme-text-primary'
                        : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-secondary/50'
                    }`}
                  >
                    <Icon size={20} />
                  </motion.button>
                  
                  {/* Tooltip */}
                  <div className="absolute left-full ml-2 px-2 py-1 rounded theme-bg-tertiary theme-text-primary text-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
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
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className={`p-3 rounded-lg transition-all ${
                  location.pathname === '/admin'
                    ? 'bg-error theme-text-primary'
                    : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-secondary/50'
                }`}
              >
                <Shield size={20} />
              </motion.div>
              
              {/* Tooltip */}
              <div className="absolute left-full ml-2 px-2 py-1 rounded theme-bg-tertiary theme-text-primary text-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                Admin Portal
              </div>
            </Link>
          )}
          
          <Link
            to="/settings"
            className="relative group block"
            title="Settings"
          >
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className={`p-3 rounded-lg transition-all ${
                location.pathname === '/settings'
                  ? 'theme-bg-secondary theme-text-primary'
                  : 'theme-text-secondary hover:theme-text-primary hover:theme-bg-secondary/50'
              }`}
            >
              <SettingsIcon size={20} />
            </motion.div>
            
            {/* Tooltip */}
            <div className="absolute left-full ml-2 px-2 py-1 rounded theme-bg-tertiary theme-text-primary text-sm opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
              Settings
            </div>
          </Link>
        </div>
      </aside>
      
      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden relative z-10">
        {/* Header with auth */}
        <header className="glass-adaptive px-6 py-4 flex justify-end items-center relative z-10">
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
