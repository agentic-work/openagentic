import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';
import GlassCard from '@/shared/ui/GlassCard';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';
// import FilesystemManager from '@/components/FilesystemManager'; // TODO: Add this component
import {
  CogIcon,
  BellIcon,
  ShieldCheckIcon,
  ServerIcon,
  PaintBrushIcon,
  UserIcon,
  CpuChipIcon,
  FolderIcon,
  LinkIcon,
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';
// import toast from 'react-hot-toast'; // TODO: Add toast notifications

interface GitHubStatus {
  connected: boolean;
  githubUsername?: string;
  githubEmail?: string;
  avatarUrl?: string;
  scopes?: string[];
  isValid?: boolean;
}

interface GitHubConfig {
  configured: boolean;
  clientId?: string;
}

const Settings = () => {
  const { theme, changeTheme, accentColor, accentColors, changeAccentColor, backgroundEffect, setBackgroundEffect } = useTheme();
  const { getAuthHeaders } = useAuth();
  const [apiVersion, setApiVersion] = useState<{ version?: string; commit?: string; build?: string } | null>(null);

  // Memory & Context settings (Phase 16G)
  const [memorySettings, setMemorySettings] = useState({
    crossModeMemory: true,
    memorySources: { chat: true, code: true, workflows: true },
    memoryRetention: '90',  // days: '30' | '60' | '90' | '365' | 'forever'
    contextInChat: true,
    contextInCodeMode: true,
  });
  const [memorySaving, setMemorySaving] = useState(false);

  // GitHub OAuth state
  const [githubStatus, setGitHubStatus] = useState<GitHubStatus | null>(null);
  const [githubConfig, setGitHubConfig] = useState<GitHubConfig | null>(null);
  const [githubLoading, setGitHubLoading] = useState(false);
  const [githubError, setGitHubError] = useState<string | null>(null);

  // Fetch API version on mount
  React.useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiEndpoint('/version'));
        const data = await res.json();
        setApiVersion({
          version: data.version,
          commit: data.build?.commit?.slice(0, 7),
          build: data.build?.time,
        });
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch GitHub config and status
  React.useEffect(() => {
    const fetchGitHubData = async () => {
      try {
        // Check if GitHub OAuth is configured (public endpoint)
        const configRes = await fetch(apiEndpoint('/api/v1/github/config'));
        if (configRes.ok) {
          const config = await configRes.json();
          setGitHubConfig(config);
        }

        // Get GitHub connection status (requires auth)
        const authHeaders = await getAuthHeaders();
        const statusRes = await fetch(apiEndpoint('/api/v1/github/status'), {
          headers: authHeaders
        });
        if (statusRes.ok) {
          const status = await statusRes.json();
          setGitHubStatus(status);
        }
      } catch (err) {
        console.error('Failed to fetch GitHub status:', err);
      }
    };

    fetchGitHubData();

    // Check for OAuth callback params in URL
    const params = new URLSearchParams(window.location.search);
    const githubSuccess = params.get('github_success');
    const githubErrorParam = params.get('github_error');

    if (githubSuccess === 'true') {
      // Clear the URL params and refresh status
      window.history.replaceState({}, '', window.location.pathname);
      fetchGitHubData();
    } else if (githubErrorParam) {
      setGitHubError(decodeURIComponent(githubErrorParam));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [getAuthHeaders]);

  // GitHub OAuth connect
  const handleGitHubConnect = () => {
    // Redirect to GitHub OAuth flow
    window.location.href = apiEndpoint('/api/v1/github/connect?redirect=' + encodeURIComponent(window.location.pathname + '?github_success=true'));
  };

  // GitHub disconnect
  const handleGitHubDisconnect = async () => {
    setGitHubLoading(true);
    setGitHubError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(apiEndpoint('/api/v1/github/disconnect'), {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        setGitHubStatus({ connected: false });
      } else {
        const data = await res.json();
        setGitHubError(data.message || 'Failed to disconnect');
      }
    } catch (err) {
      setGitHubError('Failed to disconnect from GitHub');
    } finally {
      setGitHubLoading(false);
    }
  };

  // Validate GitHub token
  const handleGitHubValidate = async () => {
    setGitHubLoading(true);
    setGitHubError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(apiEndpoint('/api/v1/github/validate'), {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      if (data.valid) {
        setGitHubStatus(prev => prev ? { ...prev, isValid: true } : null);
      } else {
        setGitHubError(data.message || 'Token is invalid');
        setGitHubStatus(prev => prev ? { ...prev, isValid: false } : null);
      }
    } catch (err) {
      setGitHubError('Failed to validate token');
    } finally {
      setGitHubLoading(false);
    }
  };

  // Save theme to backend after user clicks theme button
  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    changeTheme(newTheme);
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(apiEndpoint('/settings'), {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ theme: newTheme === 'system' ? 'dark' : newTheme })
      });
    } catch (error) {
      console.error('Failed to save theme to backend:', error);
    }
  };

  const [notifications, setNotifications] = useState({
    testFailures: true,
    securityAlerts: true,
    systemUpdates: false,
    performanceWarnings: true,
  });
  
  const [apiSettings, setApiSettings] = useState({
    rateLimit: '1000',
    timeout: '30',
    maxRetries: '3',
  });
  
  const [aiModelSettings, setAiModelSettings] = useState({
    provider: 'ollama', // 'ollama' or 'azure'
    azureEndpoint: '',
    azureApiKey: '',
    azureDeploymentName: '',
    azureApiVersion: '2024-02-01',
  });
  
  const handleSave = () => {
    // Save settings to localStorage for now
    if (aiModelSettings.provider === 'azure' && aiModelSettings.azureApiKey) {
      localStorage.setItem('ai-model-settings', JSON.stringify(aiModelSettings));
    }
    // toast.success('Settings saved successfully!');
    // console.log('Settings saved successfully!');
  };
  
  // Load settings on mount
  React.useEffect(() => {
    const savedSettings = localStorage.getItem('ai-model-settings');
    if (savedSettings) {
      setAiModelSettings(JSON.parse(savedSettings));
    }
  }, []);

  // Load memory settings from API on mount
  React.useEffect(() => {
    (async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const res = await fetch(apiEndpoint('/api/user/settings'), { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          if (data.settings?.memorySettings) {
            setMemorySettings(prev => ({ ...prev, ...data.settings.memorySettings }));
          }
        }
      } catch { /* ignore - use defaults */ }
    })();
  }, []);

  // Save memory settings to API
  const saveMemorySettings = async (updated: typeof memorySettings) => {
    setMemorySaving(true);
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(apiEndpoint('/api/user/settings'), {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { memorySettings: updated } }),
      });
    } catch { /* ignore */ }
    setMemorySaving(false);
  };
  
  const settingsSections = [
    { icon: PaintBrushIcon, label: 'Appearance', id: 'appearance' },
    { icon: LinkIcon, label: 'Integrations', id: 'integrations' },
    { icon: BellIcon, label: 'Notifications', id: 'notifications' },
    { icon: ShieldCheckIcon, label: 'Security', id: 'security' },
    { icon: ServerIcon, label: 'API Settings', id: 'api' },
    { icon: CpuChipIcon, label: 'AI Models', id: 'ai-models' },
    { icon: FolderIcon, label: 'MCP Settings', id: 'mcp' },
    { icon: CircleStackIcon, label: 'Memory & Context', id: 'memory' },
    { icon: UserIcon, label: 'Profile', id: 'profile' },
  ];
  
  const [activeSection, setActiveSection] = useState('appearance');
  
  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-[var(--color-text)] mb-2">Settings</h1>
        <p className="text-[var(--color-textSecondary)]">Configure your OpenAgenticCode preferences</p>
      </motion.div>
      
      <div className="grid grid-cols-12 gap-6">
        {/* Settings Navigation */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="col-span-12 lg:col-span-3"
        >
          <GlassCard padding="p-4">
            <nav className="space-y-1">
              {settingsSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors ${
                    activeSection === section.id
                      ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]'
                      : 'text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-background)]/30'
                  }`}
                >
                  <section.icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{section.label}</span>
                </button>
              ))}
            </nav>
          </GlassCard>
        </motion.div>
        
        {/* Settings Content */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="col-span-12 lg:col-span-9"
        >
          {activeSection === 'appearance' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <PaintBrushIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Appearance</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <span className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Theme
                  </span>
                  <div className="grid grid-cols-3 gap-3">
                    <button
                      onClick={() => handleThemeChange('light')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        theme === 'light'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      {/* theme-allow: literal swatch previews the light theme's actual paper bg */}
                      <div className="w-full h-20 rounded-lg mb-2" style={{ background: 'var(--brand-paper)' }}></div>
                      <span className="text-sm font-medium">Light</span>
                    </button>

                    <button
                      onClick={() => handleThemeChange('dark')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        theme === 'dark'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      {/* theme-allow: literal swatch previews the dark theme's actual terminal bg */}
                      <div className="w-full h-20 rounded-lg mb-2" style={{ background: 'var(--brand-terminal-bg)' }}></div>
                      <span className="text-sm font-medium">Dark</span>
                    </button>

                    <button
                      onClick={() => handleThemeChange('system')}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        theme === 'system'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      {/* theme-allow: split swatch previews both theme bgs side-by-side for the System option */}
                      <div className="w-full h-20 rounded-lg mb-2" style={{ background: 'linear-gradient(to right, var(--brand-paper), var(--brand-terminal-bg))' }}></div>
                      <span className="text-sm font-medium">System</span>
                    </button>
                  </div>
                </div>
                
                <div>
                  <span className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Accent Color
                  </span>
                  <div className="flex flex-wrap gap-3">
                    {accentColors.map((color) => (
                      <button
                        key={color.name}
                        onClick={() => changeAccentColor(color)}
                        className={`group relative w-12 h-12 rounded-full border-2 transition-all ${
                          accentColor.name === color.name
                            ? 'border-[var(--color-text)] scale-110 shadow-lg'
                            : 'border-[var(--color-border)] hover:scale-110 hover:border-[var(--color-borderHover)]'
                        }`}
                        style={{
                          backgroundColor: color.name === 'System' ? undefined : color.primary,
                          // theme-allow: conic wheel illustrates the multi-accent "System" option
                          background: color.name === 'System'
                            ? 'conic-gradient(from 0deg, #1E40AF, #16A34A, #7C3AED, #EA580C, #1E40AF)'
                            : undefined
                        }}
                      >
                        {accentColor.name === color.name && (
                          <div className="absolute inset-0 rounded-full flex items-center justify-center">
                            <svg className="w-6 h-6 text-on-accent drop-shadow-md" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          </div>
                        )}
                        <span className="absolute -bottom-6 left-1/2 transform -translate-x-1/2 text-xs text-[var(--color-textSecondary)] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          {color.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Background Effect
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setBackgroundEffect('off')}
                      className={`p-3 rounded-xl border-2 transition-all ${
                        backgroundEffect === 'off'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="w-full h-12 bg-[var(--color-surface)] rounded-lg mb-2" />
                      <span className="text-sm font-medium">Off</span>
                      <p className="text-xs text-[var(--color-textSecondary)] mt-1">Solid color</p>
                    </button>

                    <button
                      onClick={() => setBackgroundEffect('subtle')}
                      className={`p-3 rounded-xl border-2 transition-all ${
                        backgroundEffect === 'subtle'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div
                        className="w-full h-12 rounded-lg mb-2"
                        style={{
                          background: `linear-gradient(135deg,
                            color-mix(in srgb, ${accentColor.primary} 10%, var(--color-surface)) 0%,
                            var(--color-surface) 100%)`,
                        }}
                      />
                      <span className="text-sm font-medium">Subtle</span>
                      <p className="text-xs text-[var(--color-textSecondary)] mt-1">Accent tint</p>
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Keyboard Shortcuts
                  </span>
                  <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/30">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">New Chat</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+C</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Light Theme</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+L</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Dark Theme</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+D</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Admin Portal</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+A</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">Documentation</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Ctrl+?</kbd>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[var(--color-textSecondary)]">All Shortcuts</span>
                        <kbd className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)] text-xs font-mono">Shift+?</kbd>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Onboarding Tutorial
                  </span>
                  <button
                    onClick={() => {
                      localStorage.removeItem('onboarding_completed');
                      localStorage.removeItem('ac-onboarding-completed');
                      localStorage.removeItem('ac-welcome-shown');
                      window.location.reload();
                    }}
                    className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-background)]/50 transition-colors text-sm"
                  >
                    Re-show Onboarding Tour
                  </button>
                  <p className="text-xs text-[var(--color-textSecondary)] mt-2">
                    Show the first-time user welcome tour again.
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {activeSection === 'integrations' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <LinkIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Integrations</h2>
              </div>

              <div className="space-y-6">
                {/* GitHub Integration */}
                <div className="p-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]/30">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      {/* GitHub Logo — theme-allow: GitHub vendor brand surface + on-brand white glyph */}
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: '#24292e' }}>
                        <svg viewBox="0 0 24 24" className="w-6 h-6" style={{ color: '#ffffff' }} fill="currentColor">
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                        </svg>
                      </div>
                      <div>
                        <h3 className="text-[var(--color-text)] font-semibold">GitHub</h3>
                        <p className="text-sm text-[var(--color-textSecondary)]">
                          Connect your GitHub account for repository access
                        </p>
                      </div>
                    </div>

                    {/* Status indicator */}
                    {githubStatus?.connected ? (
                      <div className="flex items-center space-x-2">
                        <CheckCircleIcon className="w-5 h-5 text-[var(--color-success)]" />
                        <span className="text-sm text-[var(--color-success)] font-medium">Connected</span>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <XCircleIcon className="w-5 h-5 text-[var(--color-textSecondary)]" />
                        <span className="text-sm text-[var(--color-textSecondary)]">Not connected</span>
                      </div>
                    )}
                  </div>

                  {/* Error message */}
                  {githubError && (
                    <div className="mb-4 p-3 rounded-lg bg-[var(--color-error)]/10 border border-[var(--color-error)]/30">
                      <p className="text-sm text-[var(--color-error)]">{githubError}</p>
                    </div>
                  )}

                  {/* Connected state */}
                  {githubStatus?.connected ? (
                    <div className="space-y-4">
                      {/* User info */}
                      <div className="flex items-center space-x-4 p-3 rounded-lg bg-[var(--color-background)]/30">
                        {githubStatus.avatarUrl ? (
                          <img
                            src={githubStatus.avatarUrl}
                            alt={githubStatus.githubUsername}
                            className="w-12 h-12 rounded-full"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-[var(--color-border)] flex items-center justify-center">
                            <UserIcon className="w-6 h-6 text-[var(--color-textSecondary)]" />
                          </div>
                        )}
                        <div>
                          <p className="text-[var(--color-text)] font-medium">{githubStatus.githubUsername}</p>
                          {githubStatus.githubEmail && (
                            <p className="text-sm text-[var(--color-textSecondary)]">{githubStatus.githubEmail}</p>
                          )}
                        </div>
                      </div>

                      {/* Scopes */}
                      {githubStatus.scopes && githubStatus.scopes.length > 0 && (
                        <div>
                          <p className="text-sm text-[var(--color-textSecondary)] mb-2">Permissions granted:</p>
                          <div className="flex flex-wrap gap-2">
                            {githubStatus.scopes.map((scope) => (
                              <span
                                key={scope}
                                className="px-2 py-1 rounded text-xs font-mono bg-[var(--color-background)] border border-[var(--color-border)]"
                              >
                                {scope}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center space-x-3 pt-2">
                        <button
                          onClick={handleGitHubValidate}
                          disabled={githubLoading}
                          className="px-4 py-2 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-background)]/50 transition-colors text-sm flex items-center space-x-2 disabled:opacity-50"
                        >
                          {githubLoading ? (
                            <ArrowPathIcon className="w-4 h-4 animate-spin" />
                          ) : (
                            <ArrowPathIcon className="w-4 h-4" />
                          )}
                          <span>Validate Token</span>
                        </button>
                        <button
                          onClick={handleGitHubDisconnect}
                          disabled={githubLoading}
                          className="px-4 py-2 rounded-lg border border-[var(--color-error)]/30 text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors text-sm disabled:opacity-50"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Disconnected state */
                    <div className="space-y-4">
                      {!githubConfig?.configured ? (
                        <div className="p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
                          <p className="text-sm text-[var(--color-warning)]">
                            GitHub OAuth is not configured on this server. Contact your administrator.
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-[var(--color-textSecondary)]">
                            Connect your GitHub account to enable repository browsing, code search, issue management, and more through the AI assistant.
                          </p>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <span className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)]">repo</span>
                            <span className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)]">read:org</span>
                            <span className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)]">read:user</span>
                            <span className="px-2 py-1 rounded bg-[var(--color-background)] border border-[var(--color-border)]">workflow</span>
                          </div>
                          <button
                            onClick={handleGitHubConnect}
                            // theme-allow: GitHub vendor brand button color
                            style={{ background: '#24292e', color: '#ffffff' }}
                            className="px-4 py-2 rounded-lg hover:opacity-90 transition-colors text-sm font-medium flex items-center space-x-2"
                          >
                            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                            </svg>
                            <span>Connect GitHub</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* More integrations placeholder */}
                <div className="p-4 rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]/10">
                  <p className="text-sm text-[var(--color-textSecondary)] text-center">
                    More integrations coming soon...
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {activeSection === 'notifications' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <BellIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Notifications</h2>
              </div>
              
              <div className="space-y-4">
                {Object.entries(notifications).map(([key, value]) => (
                  <label key={key} className="flex items-center justify-between cursor-pointer p-4 rounded-lg hover:bg-[var(--color-background)]/30 transition-colors">
                    <div>
                      <p className="text-[var(--color-text)] font-medium">
                        {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      </p>
                      <p className="text-sm text-[var(--color-textSecondary)]">
                        Receive notifications for {key.toLowerCase().replace(/([A-Z])/g, ' $1')}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => setNotifications({ ...notifications, [key]: e.target.checked })}
                      aria-label={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      className="sr-only"
                    />
                    <div className={`relative w-12 h-6 rounded-full transition-colors ${
                      value ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
                    }`}>
                      <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface rounded-full transition-transform ${
                        value ? 'translate-x-6' : 'translate-x-0'
                      }`} />
                    </div>
                  </label>
                ))}
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'security' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <ShieldCheckIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Security</h2>
              </div>
              
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[var(--color-text)] font-medium">Two-Factor Authentication</h3>
                    <span className="text-sm text-[var(--color-success)]">Enabled</span>
                  </div>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    Add an extra layer of security to your account
                  </p>
                </div>
                
                <div className="p-4 rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[var(--color-text)] font-medium">API Keys</h3>
                    <span className="text-sm text-[var(--color-textSecondary)]">3 active</span>
                  </div>
                  <p className="text-sm text-[var(--color-textSecondary)] mb-3">
                    Manage your API keys for external integrations
                  </p>
                  <button className="text-sm text-[var(--color-primary)] hover:text-[var(--color-secondary)]">
                    Manage Keys →
                  </button>
                </div>
                
                <div className="p-4 rounded-lg border border-[var(--color-border)]">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[var(--color-text)] font-medium">Session Timeout</h3>
                    <select className="px-3 py-1 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)]">
                      <option>30 minutes</option>
                      <option>1 hour</option>
                      <option>2 hours</option>
                      <option>Never</option>
                    </select>
                  </div>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    Automatically log out after period of inactivity
                  </p>
                </div>

                {/* About - Simple Build Info */}
                <div className="p-3 rounded-lg border border-[var(--color-border)] mt-6 bg-[var(--color-surface)]/30">
                  <h3 className="text-xs font-medium text-[var(--color-textSecondary)] mb-2 uppercase tracking-wide">About</h3>
                  <div className="font-mono text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-textSecondary)]">Version</span>
                      <span className="text-[var(--color-success)] font-semibold">v0.5.0</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-textSecondary)]">UI</span>
                      <span className="text-[var(--color-text)]">{import.meta.env.VITE_GIT_SHORT_COMMIT || 'dev'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-textSecondary)]">API</span>
                      <span className="text-[var(--color-text)]">{apiVersion?.version || apiVersion?.commit || '...'}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-[var(--color-border)]/50 mt-1">
                      <span className="text-[var(--color-textSecondary)]">Built</span>
                      <span className="text-[var(--color-text)]">{import.meta.env.VITE_BUILD_TIME ? new Date(import.meta.env.VITE_BUILD_TIME).toLocaleDateString() : 'dev'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'api' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <ServerIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">API Settings</h2>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label htmlFor="settings-api-rate-limit" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                    Rate Limit (requests/hour)
                  </label>
                  <input
                    id="settings-api-rate-limit"
                    type="number"
                    value={apiSettings.rateLimit}
                    onChange={(e) => setApiSettings({ ...apiSettings, rateLimit: e.target.value })}
                    className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label htmlFor="settings-api-timeout" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                    Request Timeout (seconds)
                  </label>
                  <input
                    id="settings-api-timeout"
                    type="number"
                    value={apiSettings.timeout}
                    onChange={(e) => setApiSettings({ ...apiSettings, timeout: e.target.value })}
                    className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
                
                <div>
                  <label htmlFor="settings-api-max-retries" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                    Max Retries
                  </label>
                  <input
                    id="settings-api-max-retries"
                    type="number"
                    value={apiSettings.maxRetries}
                    onChange={(e) => setApiSettings({ ...apiSettings, maxRetries: e.target.value })}
                    className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                  />
                </div>
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'ai-models' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <CpuChipIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">AI Models</h2>
              </div>
              
              <div className="space-y-6">
                {/* Model Provider Selection */}
                <div>
                  <span className="text-sm font-medium text-[var(--color-textSecondary)] mb-3 block">
                    Model Provider
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setAiModelSettings({ ...aiModelSettings, provider: 'ollama' })}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        aiModelSettings.provider === 'ollama'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="text-left">
                        <h4 className="font-medium text-[var(--color-text)] mb-1">Ollama</h4>
                        <p className="text-sm text-[var(--color-textSecondary)]">Local models</p>
                      </div>
                    </button>
                    
                    <button
                      onClick={() => setAiModelSettings({ ...aiModelSettings, provider: 'azure' })}
                      className={`p-4 rounded-xl border-2 transition-all ${
                        aiModelSettings.provider === 'azure'
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10'
                          : 'border-[var(--color-border)] hover:border-[var(--color-borderHover)]'
                      }`}
                    >
                      <div className="text-left">
                        <h4 className="font-medium text-[var(--color-text)] mb-1">Azure OpenAI</h4>
                        <p className="text-sm text-[var(--color-textSecondary)]">Cloud models</p>
                      </div>
                    </button>
                  </div>
                </div>
                
                {/* Azure OpenAI Settings */}
                {aiModelSettings.provider === 'azure' && (
                  <>
                    <div className="p-4 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
                      <p className="text-sm text-[var(--color-warning)]">
                        <strong>Note:</strong> This is for testing purposes. Your API key will be stored locally.
                      </p>
                    </div>
                    
                    <div>
                      <label htmlFor="settings-azure-endpoint" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        Azure OpenAI Endpoint
                      </label>
                      <input
                        id="settings-azure-endpoint"
                        type="url"
                        value={aiModelSettings.azureEndpoint}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureEndpoint: e.target.value })}
                        placeholder="https://your-resource.openai.azure.com/"
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="settings-azure-api-key" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        API Key
                      </label>
                      <input
                        id="settings-azure-api-key"
                        type="password"
                        value={aiModelSettings.azureApiKey}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureApiKey: e.target.value })}
                        placeholder="Your Azure OpenAI API key"
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="settings-azure-deployment" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        Deployment Name
                      </label>
                      <input
                        id="settings-azure-deployment"
                        type="text"
                        value={aiModelSettings.azureDeploymentName}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureDeploymentName: e.target.value })}
                        placeholder="e.g., gpt-4-turbo"
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      />
                    </div>
                    
                    <div>
                      <label htmlFor="settings-azure-api-version" className="text-sm font-medium text-[var(--color-textSecondary)] mb-2 block">
                        API Version
                      </label>
                      <select
                        id="settings-azure-api-version"
                        value={aiModelSettings.azureApiVersion}
                        onChange={(e) => setAiModelSettings({ ...aiModelSettings, azureApiVersion: e.target.value })}
                        className="w-full px-4 py-2 bg-[var(--color-background)]/50 border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:border-[var(--color-primary)] focus:outline-none"
                      >
                        <option value="2024-02-01">2024-02-01 (Latest)</option>
                        <option value="2023-12-01-preview">2023-12-01-preview</option>
                        <option value="2023-05-15">2023-05-15</option>
                      </select>
                    </div>
                    
                    <button
                      onClick={() => {
                        // Test connection
                        // console.log('Testing connection...');
                        /* toast.promise(
                          new Promise((resolve, reject) => {
                            setTimeout(() => {
                              if (aiModelSettings.azureEndpoint && aiModelSettings.azureApiKey) {
                                resolve('Connection successful!');
                              } else {
                                reject('Please fill in all required fields');
                              }
                            }, 1000);
                          }),
                          {
                            loading: 'Testing connection...',
                            success: 'Connection successful!',
                            error: 'Connection failed',
                          }
                        ); */
                      }}
                      className="px-4 py-2 bg-[var(--color-primary)]/20 text-[var(--color-primary)] rounded-lg font-medium hover:bg-[var(--color-primary)]/30 transition-colors"
                    >
                      Test Connection
                    </button>
                  </>
                )}
                
                {/* Ollama Settings */}
                {aiModelSettings.provider === 'ollama' && (
                  <div className="p-4 rounded-lg bg-[var(--color-success)]/10 border border-[var(--color-success)]/30">
                    <p className="text-sm text-[var(--color-success)]">
                      Using local Ollama models. Make sure Ollama is running on your system.
                    </p>
                  </div>
                )}
              </div>
            </GlassCard>
          )}
          
          {activeSection === 'mcp' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <FolderIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">MCP Settings</h2>
              </div>
              
              <div className="space-y-6">
                {/* MCP Information */}
                <div className="p-4 rounded-lg bg-[var(--color-info)]/10 border border-[var(--color-info)]/30 mb-6">
                  <h3 className="text-sm font-medium text-[var(--color-info)] mb-2">Model Context Protocol (MCP)</h3>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    MCP enables AI models to interact with external tools and services. The filesystem below is used by MCP servers to store and manage their data.
                  </p>
                </div>
                
                {/* Filesystem Manager */}
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-textSecondary)] mb-4">MCP Filesystem</h3>
                  {/* <FilesystemManager /> */}
                  <p className="text-sm text-[var(--color-textSecondary)]">Filesystem manager coming soon...</p>
                </div>
              </div>
            </GlassCard>
          )}

          {activeSection === 'memory' && (
            <GlassCard>
              <div className="flex items-center space-x-3 mb-6">
                <CircleStackIcon className="w-6 h-6 text-[var(--color-primary)]" />
                <h2 className="text-xl font-semibold text-[var(--color-text)]">Memory & Context</h2>
              </div>

              <div className="space-y-6">
                {/* Info banner */}
                <div className="p-4 rounded-lg bg-[var(--color-info)]/10 border border-[var(--color-info)]/30">
                  <h3 className="text-sm font-medium text-[var(--color-info)] mb-2">Cross-Mode Memory (Phase 16)</h3>
                  <p className="text-sm text-[var(--color-textSecondary)]">
                    Memory allows context from Chat, Code Mode, and Workflows to be shared across modes. This helps the AI understand your preferences and past work.
                  </p>
                </div>

                {/* Cross-Mode Memory toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-[var(--color-text)]">Cross-Mode Memory</h3>
                    <p className="text-xs text-[var(--color-textSecondary)]">Share context between Chat, Code Mode, and Workflows</p>
                  </div>
                  <button
                    onClick={() => {
                      const updated = { ...memorySettings, crossModeMemory: !memorySettings.crossModeMemory };
                      setMemorySettings(updated);
                      saveMemorySettings(updated);
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${memorySettings.crossModeMemory ? 'bg-[var(--color-primary)]' : 'bg-surface-2'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${memorySettings.crossModeMemory ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* Memory Sources */}
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">Memory Sources</h3>
                  <p className="text-xs text-[var(--color-textSecondary)] mb-3">Choose which modes contribute to your memory</p>
                  <div className="space-y-2">
                    {(['chat', 'code', 'workflows'] as const).map((source) => (
                      <label key={source} className="flex items-center space-x-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={memorySettings.memorySources[source]}
                          onChange={() => {
                            const updated = {
                              ...memorySettings,
                              memorySources: { ...memorySettings.memorySources, [source]: !memorySettings.memorySources[source] },
                            };
                            setMemorySettings(updated);
                            saveMemorySettings(updated);
                          }}
                          className="h-4 w-4 rounded border-border text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                        />
                        <span className="text-sm text-[var(--color-text)] capitalize">{source === 'code' ? 'Code Mode' : source}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Memory Retention */}
                <div>
                  <h3 className="text-sm font-medium text-[var(--color-text)] mb-2">Memory Retention</h3>
                  <p className="text-xs text-[var(--color-textSecondary)] mb-3">How long to keep memory entries</p>
                  <select
                    value={memorySettings.memoryRetention}
                    onChange={(e) => {
                      const updated = { ...memorySettings, memoryRetention: e.target.value };
                      setMemorySettings(updated);
                      saveMemorySettings(updated);
                    }}
                    className="w-full p-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                  >
                    <option value="30">30 days</option>
                    <option value="60">60 days</option>
                    <option value="90">90 days</option>
                    <option value="365">365 days</option>
                    <option value="forever">Forever</option>
                  </select>
                </div>

                {/* Context Loading toggles */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-[var(--color-text)]">Context Loading</h3>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-[var(--color-text)]">Load context in Chat</p>
                      <p className="text-xs text-[var(--color-textSecondary)]">Chat sessions receive cross-mode context</p>
                    </div>
                    <button
                      onClick={() => {
                        const updated = { ...memorySettings, contextInChat: !memorySettings.contextInChat };
                        setMemorySettings(updated);
                        saveMemorySettings(updated);
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${memorySettings.contextInChat ? 'bg-[var(--color-primary)]' : 'bg-surface-2'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${memorySettings.contextInChat ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-[var(--color-text)]">Load context in Code Mode</p>
                      <p className="text-xs text-[var(--color-textSecondary)]">Code Mode sessions receive cross-mode context</p>
                    </div>
                    <button
                      onClick={() => {
                        const updated = { ...memorySettings, contextInCodeMode: !memorySettings.contextInCodeMode };
                        setMemorySettings(updated);
                        saveMemorySettings(updated);
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${memorySettings.contextInCodeMode ? 'bg-[var(--color-primary)]' : 'bg-surface-2'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${memorySettings.contextInCodeMode ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                </div>

                {/* Saving indicator */}
                {memorySaving && (
                  <p className="text-xs text-[var(--color-textSecondary)] italic">Saving...</p>
                )}
              </div>
            </GlassCard>
          )}

          {/* Save Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-6 flex justify-end"
          >
            <button
              onClick={handleSave}
              className="px-6 py-3 bg-[var(--color-primary)] text-on-accent rounded-lg font-medium hover:bg-[var(--color-primary)]/80 transition-colors"
            >
              Save Changes
            </button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default Settings;
