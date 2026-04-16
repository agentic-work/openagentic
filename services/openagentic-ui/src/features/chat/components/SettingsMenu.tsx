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
 * Settings Menu Component
 * A clean dropdown menu matching Gemini's design with User/Help/Themes options
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, User, Palette, ChevronRight, LogOut, Shield, Sun, Moon, Waves, Info, Monitor, Terminal } from '@/shared/icons';
import { useTheme } from '@/contexts/ThemeContext';
import AboutModal from '@/features/about/AboutModal';
// DocsBookIcon removed — using inline folder SVG instead
import { useUIVisibilityStore } from '@/stores/useUIVisibilityStore';

interface SettingsMenuProps {
  isExpanded: boolean;
  currentTheme: string;
  userName?: string;
  userEmail?: string;
  isAdmin?: boolean;
  onThemeChange?: (theme: string) => void;
  onLogout?: () => void;
  onHelpClick?: () => void;
  onAdminPanelClick?: () => void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({
  isExpanded,
  currentTheme,
  userName = 'User',
  userEmail,
  isAdmin = false,
  onThemeChange,
  onLogout,
  onHelpClick,
  onAdminPanelClick,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showThemeSubmenu, setShowThemeSubmenu] = useState(false);
  const [showAccentSubmenu, setShowAccentSubmenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const openUI = useUIVisibilityStore(s => s.open);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Get theme context for accent colors and background animations
  const { theme, accentColor, accentColors, changeAccentColor, changeTheme, backgroundAnimations, toggleBackgroundAnimations } = useTheme();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setShowThemeSubmenu(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleThemeSelect = (theme: string) => {
    onThemeChange?.(theme);
    setShowThemeSubmenu(false);
    setIsOpen(false);
  };

  return (
    <>
      {/* Settings Button */}
      <motion.button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
        style={{
          color: 'var(--color-textSecondary)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
          e.currentTarget.style.color = 'var(--color-text)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.color = 'var(--color-textSecondary)';
        }}
        title={!isExpanded ? 'Settings' : undefined}
      >
        <Settings size={20} className="flex-shrink-0" />
        {isExpanded && (
          <span className="text-sm font-medium">Settings & more</span>
        )}
      </motion.button>

      {/* Dropdown Menu */}
      {isOpen && createPortal(
        <AnimatePresence>
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={
              isExpanded
                ? 'fixed z-[10002] rounded-lg shadow-xl min-w-[280px] bottom-20 left-3 w-[304px]'
                : 'fixed z-[10002] rounded-lg shadow-xl min-w-[280px] bottom-20 left-[72px] w-[280px]'
            }
            style={{
              backgroundColor: 'var(--color-surface)',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: 'var(--color-border)',
            }}
          >
            {/* User Section */}
            <div
              className="px-4 py-3"
              style={{
                borderBottomWidth: '1px',
                borderBottomStyle: 'solid',
                borderBottomColor: 'var(--color-border)',
              }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'var(--color-primary)' }}>
                  <User size={20} style={{ color: 'var(--color-text)' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="text-sm font-medium truncate"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {userName}
                  </div>
                  {userEmail && (
                    <div
                      className="text-xs truncate"
                      style={{ color: 'var(--color-textSecondary)' }}
                    >
                      {userEmail}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Menu Items */}
            <div className="py-2">
              {/* Admin Panel (if admin) */}
              {isAdmin && onAdminPanelClick && (
                <button
                  onClick={() => {
                    onAdminPanelClick();
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                  style={{ color: 'var(--color-text)' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <Shield size={18} />
                  <span className="text-sm">Admin Panel</span>
                </button>
              )}

              {/* About - Platform Documentation */}
              <button
                onClick={() => {
                  setShowAboutModal(true);
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <Info size={18} />
                <span className="text-sm">About</span>
              </button>

              {/* Documentation — simple folder icon, above Theme */}
              <button
                onClick={() => {
                  openUI('showDocsViewer');
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <span className="text-sm">Documentation</span>
              </button>

              {/* Theme Selector */}
              <button
                onClick={() => setShowThemeSubmenu(!showThemeSubmenu)}
                className="w-full flex items-center justify-between px-4 py-2.5 transition-colors text-left"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div className="flex items-center gap-3">
                  {theme === 'light' ? <Sun size={18} /> : <Moon size={18} />}
                  <span className="text-sm">Theme</span>
                </div>
                <ChevronRight size={16} className={`transition-transform ${showThemeSubmenu ? 'rotate-90' : ''}`} />
              </button>

              {/* Theme Submenu */}
              <AnimatePresence>
                {showThemeSubmenu && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 py-1 space-y-1">
                      <button
                        onClick={() => {
                          changeTheme('light');
                          setShowThemeSubmenu(false);
                          setIsOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors"
                        style={{
                          backgroundColor: theme === 'light' ? 'var(--color-surfaceHover)' : 'transparent',
                          color: 'var(--color-text)'
                        }}
                      >
                        <Sun size={16} />
                        <span className="text-sm">Light</span>
                      </button>
                      <button
                        onClick={() => {
                          changeTheme('dark');
                          setShowThemeSubmenu(false);
                          setIsOpen(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors"
                        style={{
                          backgroundColor: theme === 'dark' ? 'var(--color-surfaceHover)' : 'transparent',
                          color: 'var(--color-text)'
                        }}
                      >
                        <Moon size={16} />
                        <span className="text-sm">Dark</span>
                      </button>
                      {/* Catppuccin, Tokyo Night, Dracula, Terminal themes are code-mode only */}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Accent Color Picker */}
              <button
                onClick={() => setShowAccentSubmenu(!showAccentSubmenu)}
                className="w-full flex items-center justify-between px-4 py-2.5 transition-colors text-left"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div className="flex items-center gap-3">
                  <Palette size={18} />
                  <span className="text-sm">Accent Color</span>
                </div>
                <ChevronRight size={16} className={`transition-transform ${showAccentSubmenu ? 'rotate-90' : ''}`} />
              </button>

              {/* Accent Color Submenu */}
              <AnimatePresence>
                {showAccentSubmenu && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 py-3">
                      <div className="flex flex-wrap gap-3">
                        {accentColors.map((color: any) => (
                          <button
                            key={color.name}
                            onClick={() => changeAccentColor(color)}
                            className="relative w-10 h-10 rounded-full border-2 transition-all"
                            style={{
                              backgroundColor: color.primary,
                              borderColor: accentColor.name === color.name ? 'var(--color-text)' : 'var(--color-border)',
                              transform: accentColor.name === color.name ? 'scale(1.1)' : 'scale(1)',
                            }}
                            title={color.name}
                          >
                            {accentColor.name === color.name && (
                              <div className="absolute inset-0 rounded-full flex items-center justify-center">
                                <svg 
                                className="w-5 h-5 drop-shadow-md"
                                style={{ color: 'var(--color-text)' }} fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Background effects always on — toggle removed */}

              {/* Divider */}
              <div
                className="my-2"
                style={{
                  borderTopWidth: '1px',
                  borderTopStyle: 'solid',
                  borderTopColor: 'var(--color-border)',
                }}
              />

              {/* Logout */}
              <button
                onClick={() => {
                  onLogout?.();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--color-surfaceHover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <LogOut size={18} />
                <span className="text-sm">Sign out</span>
              </button>
            </div>
          </motion.div>
        </AnimatePresence>,
        document.body
      )}

      {/* About Modal */}
      <AboutModal isOpen={showAboutModal} onClose={() => setShowAboutModal(false)} />

      {/* Documentation Viewer is rendered by ChatContainer via useUIVisibilityStore */}
    </>
  );
};

export default SettingsMenu;
