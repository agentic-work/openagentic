/**
 * Enhanced Navigation Component
 * Provides access to all new features and admin capabilities
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Home,
  MessageSquare,
  Settings,
  Shield,
  Brain,
  Image,
  FileText,
  DollarSign,
  Activity,
  GitBranch,
  Package,
  ChevronDown,
  ChevronRight,
  LogOut,
  User,
  HelpCircle,
  Zap,
  Database,
  Lock,
  Users,
  BarChart,
  CreditCard,
  Server,
  Code,
  Layers
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { getDocsBaseUrl } from '@/config/constants';

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path?: string;
  children?: NavigationItem[];
  adminOnly?: boolean;
  badge?: string;
}

export const EnhancedNavigation: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['admin']));

  // Check if user is admin
  const isAdmin = user?.is_admin || user?.groups?.includes('OpenAgenticAdmins') || false;

  const navigationItems: NavigationItem[] = [
    {
      id: 'home',
      label: 'Home',
      icon: Home,
      path: '/'
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageSquare,
      path: '/chat'
    },
    {
      id: 'ai-features',
      label: 'AI Features',
      icon: Zap,
      children: [
        {
          id: 'memories',
          label: 'Memory Manager',
          icon: Brain,
          path: '/memories',
          badge: 'New'
        },
        {
          id: 'files',
          label: 'File Manager',
          icon: Package,
          path: '/files',
          badge: 'New'
        },
        {
          id: 'prompts',
          label: 'Prompt Library',
          icon: FileText,
          path: '/prompts'
        }
      ]
    },
    {
      id: 'admin',
      label: 'Administration',
      icon: Shield,
      adminOnly: true,
      children: [
        {
          id: 'dashboard',
          label: 'Admin Dashboard',
          icon: BarChart,
          path: '/admin',
          adminOnly: true
        },
        {
          id: 'mcp-management',
          label: 'MCP Management',
          icon: Server,
          path: '/admin/mcp',
          adminOnly: true
        },
        {
          id: 'mcp-metrics',
          label: 'MCP Metrics',
          icon: Activity,
          path: '/admin/mcp-metrics',
          adminOnly: true,
          badge: 'New'
        },
        {
          id: 'prompt-versions',
          label: 'Prompt Versions',
          icon: GitBranch,
          path: '/admin/versions',
          adminOnly: true,
          badge: 'New'
        },
        {
          id: 'azure-costs',
          label: 'Azure Cost Monitor',
          icon: DollarSign,
          path: '/admin/azure-costs',
          adminOnly: true,
          badge: 'New'
        },
        {
          id: 'usage-analytics',
          label: 'Usage Analytics',
          icon: BarChart,
          path: '/admin/usage',
          adminOnly: true
        },
        {
          id: 'user-management',
          label: 'User Management',
          icon: Users,
          path: '/admin/users',
          adminOnly: true
        },
        {
          id: 'security',
          label: 'Security',
          icon: Lock,
          path: '/admin/security',
          adminOnly: true
        }
      ]
    },
    {
      id: 'developer',
      label: 'Developer',
      icon: Code,
      children: [
        {
          id: 'api-docs',
          label: 'API Documentation',
          icon: FileText,
          path: '/docs/api'
        },
        {
          id: 'mcp-inspector',
          label: 'MCP Inspector',
          icon: Layers,
          path: '/dev/mcp-inspector'
        },
        {
          id: 'database',
          label: 'Database Explorer',
          icon: Database,
          path: '/dev/database',
          adminOnly: true
        }
      ]
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      path: '/settings'
    }
  ];

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

  const handleNavigation = (path?: string) => {
    if (path) {
      navigate(path);
    }
  };

  const renderNavigationItem = (item: NavigationItem, depth = 0) => {
    // Hide admin-only items if user is not admin
    if (item.adminOnly && !isAdmin) {
      return null;
    }

    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedSections.has(item.id);
    const Icon = item.icon;

    return (
      <div key={item.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleSection(item.id);
            } else {
              handleNavigation(item.path);
            }
          }}
          className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-800 rounded-lg transition-colors ${
            depth > 0 ? 'pl-8' : ''
          }`}
        >
          <div className="flex items-center gap-3">
            <Icon 
            className="w-4 h-4"
            style={{ color: 'var(--color-textMuted)' }} />
            <span style={{ color: 'var(--color-textMuted)' }}>{item.label}</span>
            {item.badge && (
              <span 
              className="px-2 py-0.5 text-xs bg-blue-600 rounded-full"
              style={{ color: 'var(--color-text)' }}>
                {item.badge}
              </span>
            )}
          </div>
          {hasChildren && (
            <div style={{ color: 'var(--color-textMuted)' }}>
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>
          )}
        </button>
        
        {hasChildren && isExpanded && (
          <div className="mt-1 space-y-1">
            {item.children!.map(child => renderNavigationItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav 
    className="h-full flex flex-col"
    style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>
      {/* Header */}
      <div 
      className="p-4 border-b"
      style={{ borderColor: 'var(--color-borderHover)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-primary)' }}>
            <Zap 
            className="w-6 h-6"
            style={{ color: 'var(--color-text)' }} />
          </div>
          <div>
            <h2 className="font-semibold">OpenAgentic Chat</h2>
            <p 
            className="text-xs"
            style={{ color: 'var(--color-textMuted)' }}>Enhanced Edition</p>
          </div>
        </div>
      </div>

      {/* User Info */}
      <div 
      className="p-4 border-b"
      style={{ borderColor: 'var(--color-borderHover)' }}>
        <div className="flex items-center gap-3">
          <div 
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-background)' }}>
            <User 
            className="w-4 h-4"
            style={{ color: 'var(--color-textMuted)' }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{user?.name || user?.email?.split('@')[0] || 'User'}</p>
            <p 
            className="text-xs"
            style={{ color: 'var(--color-textMuted)' }}>{user?.email}</p>
          </div>
          {isAdmin && (
            <span 
            className="px-2 py-1 text-xs bg-purple-600 rounded"
            style={{ color: 'var(--color-text)' }}>
              Admin
            </span>
          )}
        </div>
      </div>

      {/* Navigation Items */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {navigationItems.map(item => renderNavigationItem(item))}
      </div>

      {/* Footer Actions */}
      <div 
      className="p-4 border-t space-y-2"
      style={{ borderColor: 'var(--color-borderHover)' }}>
        <button
          onClick={() => window.open(getDocsBaseUrl(), '_blank')}
          
          className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-800 rounded-lg transition-colors"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <HelpCircle 
          className="w-4 h-4"
          style={{ color: 'var(--color-textMuted)' }} />
          Help & Support
        </button>
        
        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </div>
    </nav>
  );
};