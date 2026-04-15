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
 * Settings Panel Component (Slide-in)
 * GCP-style slide-in panel for quick access to app settings
 * Features: Theme switching, animation controls, MCP inspector integration, TTS settings
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun, Settings as SettingsIcon, Wrench, Brain, Zap, MessageCircle, Save, Folder } from '@/shared/icons';
import ArtifactsPanel from './ArtifactsPanel';

// Keyboard icon - inline since it's not in shared/icons
const Keyboard: React.FC<{ size?: number; style?: React.CSSProperties }> = ({ size = 24, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <rect x="2" y="4" width="20" height="16" rx="2" ry="2" />
    <path d="M6 8h.001M10 8h.001M14 8h.001M18 8h.001M8 12h.001M12 12h.001M16 12h.001M7 16h10" />
  </svg>
);
import clsx from 'clsx';
import { Settings } from '@/types';
import { useAuth } from '@/app/providers/AuthContext';
import { DocsViewer } from '@/features/docs/DocsViewer';
import { DocsBookIcon } from '@/features/docs/components/DocsIcons';
import SlideInPanel, { SlideInPanelSection, SlideInPanelField } from '@/shared/components/SlideInPanel';
import { useTheme } from '@/contexts/ThemeContext';

interface SettingsDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  theme: 'light' | 'dark';
  anchorElement?: HTMLElement | null;
  position?: 'top' | 'bottom';
  mcpServers?: any[];
}

const SettingsDropdown: React.FC<SettingsDropdownProps> = ({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  theme,
  anchorElement,
  position = 'top',
  mcpServers = []
}) => {
  const [activeTab, setActiveTab] = useState('general');
  const [showDocsViewer, setShowDocsViewer] = useState(false);
  const [showArtifacts, setShowArtifacts] = useState(false);
  const { accentColor, accentColors, changeAccentColor, backgroundEffect, setBackgroundEffect } = useTheme();

  const tabs = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'appearance', label: 'Appearance', icon: Sun },
    { id: 'mcp-tools', label: 'MCP Tools', icon: Wrench },
  ];

  // Get server icon based on name
  const getServerIcon = (name: string) => {
    if (name.toLowerCase().includes('memory')) {
      return <Brain size={16} />;
    } else if (name.toLowerCase().includes('azure')) {
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/>
        </svg>
      );
    } else if (name.toLowerCase().includes('time')) {
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      );
    } else if (name.toLowerCase().includes('sequential') || name.toLowerCase().includes('thinking')) {
      return <Zap size={16} />;
    }
    return <Wrench size={16} />;
  };

  // Format server description
  const getServerDescription = (server: any) => {
    const toolCount = server.toolCount ||
                    server.availableTools?.length ||
                    server.tools?.length ||
                    server.functions?.length ||
                    0;
    const status = server.status || (server.isConnected ? 'connected' : 'Unknown');
    return `${toolCount} tools • ${status}`;
  };

  return (
    <>
      <SlideInPanel
        isOpen={isOpen}
        onClose={onClose}
        title="Settings"
        subtitle="Customize your experience"
        width="md"
        icon={<SettingsIcon size={20} />}
        testId="settings-panel"
      >
        {/* Tab Navigation */}
        <div
          className="flex gap-1 p-1 rounded-lg mb-4 -mx-2"
          style={{ backgroundColor: 'var(--color-surfaceSecondary)' }}
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all rounded-md',
                activeTab === id
                  ? 'bg-[var(--color-background)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-textMuted)] hover:text-[var(--color-text)]'
              )}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="space-y-6">
            <SlideInPanelSection title="Chat Preferences">
              <div className="space-y-3">
                <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                  <div className="flex items-center gap-3">
                    <Keyboard size={18} style={{ color: 'var(--color-textMuted)' }} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        Keyboard shortcuts
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                        Enable quick actions with keyboard
                      </p>
                    </div>
                  </div>
                  <div
                    onClick={() => onSettingsChange({
                      ...settings,
                      general: { ...settings.general, enableKeyboardShortcuts: !settings.general?.enableKeyboardShortcuts }
                    })}
                    className={clsx(
                      'w-10 h-5 rounded-full transition-colors relative cursor-pointer',
                      settings.general?.enableKeyboardShortcuts !== false ? 'bg-green-500' : 'bg-gray-400'
                    )}
                  >
                    <div
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform',
                        settings.general?.enableKeyboardShortcuts !== false ? 'translate-x-5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                </label>

                <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                  <div className="flex items-center gap-3">
                    <MessageCircle size={18} style={{ color: 'var(--color-textMuted)' }} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        Typing indicators
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                        Show when AI is generating
                      </p>
                    </div>
                  </div>
                  <div
                    onClick={() => onSettingsChange({
                      ...settings,
                      general: { ...settings.general, showTypingIndicators: !settings.general?.showTypingIndicators }
                    })}
                    className={clsx(
                      'w-10 h-5 rounded-full transition-colors relative cursor-pointer',
                      settings.general?.showTypingIndicators !== false ? 'bg-green-500' : 'bg-gray-400'
                    )}
                  >
                    <div
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform',
                        settings.general?.showTypingIndicators !== false ? 'translate-x-5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                </label>

                <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]">
                  <div className="flex items-center gap-3">
                    <Save size={18} style={{ color: 'var(--color-textMuted)' }} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                        Auto-save conversations
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                        Automatically save chat history
                      </p>
                    </div>
                  </div>
                  <div
                    onClick={() => onSettingsChange({
                      ...settings,
                      general: { ...settings.general, autoSaveConversations: !settings.general?.autoSaveConversations }
                    })}
                    className={clsx(
                      'w-10 h-5 rounded-full transition-colors relative cursor-pointer',
                      settings.general?.autoSaveConversations !== false ? 'bg-green-500' : 'bg-gray-400'
                    )}
                  >
                    <div
                      className={clsx(
                        'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform',
                        settings.general?.autoSaveConversations !== false ? 'translate-x-5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                </label>
              </div>
            </SlideInPanelSection>
          </div>
        )}

        {/* Appearance Tab */}
        {activeTab === 'appearance' && (
          <div className="space-y-6">
            <SlideInPanelSection title="Theme">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'light', icon: Sun, label: 'Light' },
                  { value: 'dark', icon: Moon, label: 'Dark' }
                ].map(({ value, icon: Icon, label }) => (
                  <button
                    key={value}
                    onClick={() => onSettingsChange({ ...settings, theme: value as any })}
                    className={clsx(
                      'flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all border-2',
                      settings.theme === value
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                        : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                    )}
                    style={{ color: 'var(--color-text)' }}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </SlideInPanelSection>

            <SlideInPanelSection title="Accent Color">
              <div className="flex flex-wrap gap-3">
                {accentColors.map((color: any) => (
                  <button
                    key={color.name}
                    onClick={() => changeAccentColor(color)}
                    className={clsx(
                      'relative w-10 h-10 rounded-full border-2 transition-all',
                      accentColor.name === color.name
                        ? 'border-[var(--color-text)] scale-110 shadow-lg'
                        : 'border-transparent hover:scale-110'
                    )}
                    style={{
                      backgroundColor: color.name === 'System' ? undefined : color.primary,
                      background: color.name === 'System'
                        ? 'conic-gradient(from 0deg, #1E40AF, #16A34A, #7C3AED, #EA580C, #1E40AF)'
                        : undefined
                    }}
                    title={color.name}
                  >
                    {accentColor.name === color.name && (
                      <div className="absolute inset-0 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </SlideInPanelSection>

            {/* Background Effect always on — removed toggle */}

            <SlideInPanelSection title="Resources">
              <button
                onClick={() => {
                  setShowDocsViewer(true);
                  onClose();
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]"
              >
                <DocsBookIcon size={20} />
                <div className="text-left">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Documentation
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                    Guides, API references, and system docs
                  </p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="ml-auto" style={{ color: 'var(--color-textMuted)' }}>
                  <polyline points="9 18 15 12 9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              <button
                onClick={() => {
                  setShowArtifacts(true);
                  onClose();
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg transition-colors hover:bg-[var(--color-surfaceSecondary)]"
              >
                <Folder size={20} style={{ color: 'var(--color-primary)' }} />
                <div className="text-left">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    Artifacts
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                    Upload, download, and manage files
                  </p>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="ml-auto" style={{ color: 'var(--color-textMuted)' }}>
                  <polyline points="9 18 15 12 9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </SlideInPanelSection>
          </div>
        )}

        {/* MCP Tools Tab */}
        {activeTab === 'mcp-tools' && (
          <div className="space-y-4">
            <SlideInPanelSection
              title="Connected MCP Servers"
              description="Model Context Protocol servers providing AI tools"
            >
              {mcpServers && mcpServers.length > 0 ? (
                <div className="space-y-2">
                  {mcpServers.map((server, index) => (
                    <div
                      key={server.id || index}
                      className="flex items-center justify-between p-3 rounded-lg border transition-colors"
                      style={{
                        backgroundColor: 'var(--color-surfaceSecondary)',
                        borderColor: 'var(--color-border)'
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center"
                          style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-textMuted)' }}
                        >
                          {getServerIcon(server.serverName || server.name || '')}
                        </div>
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                            {server.serverName || server.name || 'Unknown Server'}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--color-textMuted)' }}>
                            {getServerDescription(server)}
                          </p>
                        </div>
                      </div>
                      <div className={clsx(
                        'w-2.5 h-2.5 rounded-full',
                        server.status === 'connected' || server.isConnected ? 'bg-green-500' : 'bg-gray-400'
                      )} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Wrench size={32} className="mx-auto mb-2 opacity-50" style={{ color: 'var(--color-textMuted)' }} />
                  <p className="text-sm" style={{ color: 'var(--color-textMuted)' }}>No MCP tools available</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-textMuted)' }}>Loading MCP servers...</p>
                </div>
              )}
            </SlideInPanelSection>
          </div>
        )}

        {/* Documentation tab removed - documentation link is now in Appearance > Resources */}
      </SlideInPanel>

      {/* Full-screen Documentation Viewer */}
      {showDocsViewer && (
        <div className="fixed inset-0 z-[200] bg-black/80">
          <DocsViewer
            isOpen={showDocsViewer}
            onClose={() => setShowDocsViewer(false)}
            theme={theme}
          />
        </div>
      )}

      {/* Artifacts Panel */}
      <ArtifactsPanel
        theme={theme}
        isOpen={showArtifacts}
        onClose={() => setShowArtifacts(false)}
      />
    </>
  );
};

export default SettingsDropdown;
