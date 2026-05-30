import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Section definitions for admin navigation
export type AdminSection =
  | 'overview' | 'analytics'
  | 'users' | 'user-lockout' | 'auth-control'
  | 'llm-providers' | 'multi-model' | 'ollama' | 'tiered-fc' | 'llm-router-tuning' | 'llm-default-models'
  | 'mcp-servers' | 'mcp-access' | 'mcp-tools' | 'mcp-inspector' | 'mcp-logs'
  | 'prompts' | 'templates' | 'pipeline'
  | 'monitoring' | 'usage' | 'performance' | 'feedback' | 'audit' | 'code-metrics'
  | 'rate-limits' | 'api-tokens'
  | 'awcode-sessions' | 'awcode-settings'
  | 'codemode-settings' | 'codemode-mcp' | 'codemode-skills' | 'codemode-users' | 'codemode-global'
  | 'settings';

// Section categories for sidebar
export const SECTION_CATEGORIES = {
  overview: ['overview', 'analytics'],
  system: ['users', 'user-lockout', 'auth-control', 'settings'],
  llm: ['llm-providers', 'llm-default-models', 'multi-model', 'ollama', 'tiered-fc', 'llm-router-tuning'],
  mcp: ['mcp-servers', 'mcp-access', 'mcp-tools', 'mcp-inspector', 'mcp-logs'],
  content: ['prompts', 'templates', 'pipeline'],
  monitoring: ['monitoring', 'usage', 'performance', 'feedback', 'audit', 'code-metrics'],
  security: ['rate-limits', 'api-tokens'],
  code: ['awcode-sessions', 'awcode-settings'],
  codemode: ['codemode-settings', 'codemode-global', 'codemode-mcp', 'codemode-skills', 'codemode-users'],
  systemConfig: [],
} as const;

interface AdminContextState {
  // Navigation
  activeSection: AdminSection;
  setActiveSection: (section: AdminSection) => void;
  expandedItems: Set<string>;
  toggleExpanded: (itemId: string) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Error handling
  error: string | null;
  setError: (error: string | null) => void;
  clearError: () => void;

  // Refresh trigger
  refreshKey: number;
  triggerRefresh: () => void;
}

const AdminContext = createContext<AdminContextState | null>(null);

interface AdminProviderProps {
  children: ReactNode;
  initialSection?: AdminSection;
}

export const AdminProvider: React.FC<AdminProviderProps> = ({
  children,
  initialSection = 'overview'
}) => {
  const [activeSection, setActiveSection] = useState<AdminSection>(initialSection);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const toggleExpanded = useCallback((itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const triggerRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
  }, []);

  const value: AdminContextState = {
    activeSection,
    setActiveSection,
    expandedItems,
    toggleExpanded,
    isLoading,
    setIsLoading,
    error,
    setError,
    clearError,
    refreshKey,
    triggerRefresh,
  };

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
};

export const useAdmin = (): AdminContextState => {
  const context = useContext(AdminContext);
  if (!context) {
    throw new Error('useAdmin must be used within an AdminProvider');
  }
  return context;
};

// Hook for section-specific logic
export const useAdminSection = () => {
  const { activeSection, setActiveSection } = useAdmin();

  const navigateTo = useCallback((section: AdminSection) => {
    setActiveSection(section);
  }, [setActiveSection]);

  const isActive = useCallback((section: AdminSection) => {
    return activeSection === section;
  }, [activeSection]);

  const getCategoryForSection = useCallback((section: AdminSection): string | null => {
    for (const [category, sections] of Object.entries(SECTION_CATEGORIES)) {
      if ((sections as readonly string[]).includes(section)) {
        return category;
      }
    }
    return null;
  }, []);

  return {
    activeSection,
    navigateTo,
    isActive,
    getCategoryForSection,
  };
};

export default AdminContext;
