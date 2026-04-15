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

import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
// SVG icons for sidebar child items — reliable rendering at 16px
import {
  X, ChevronRight, ChevronDown, Eye, EyeOff, Check, Save, Plus, Edit, Trash2,
  Settings, FileText, Monitor, List, BarChart, Star, MessageSquare, Users, Key,
  // Sidebar child icons (SVG — guaranteed to render)
  Shield, Database, Terminal, Network, Folder, Wrench, Zap, Globe,
  Server, XCircle, CheckCircle, Grid, Bot, Rocket, Target, PlayCircle,
  Gauge, Lock, Sparkles, Clock, Layers, Code, SlidersHorizontal, Brain,
  UserCheck, GitBranch, Cpu, Sliders, LineChart, Activity, Link2,
  BarChart2, Hand, FlaskConical, GitMerge, Hourglass, DollarSign,
  ShieldCheck, Box
} from '@/shared/icons';
// Animated SVG section header icons (stay as-is, they're already beautiful)
import {
  SystemManagementIcon,

  ContentDataIcon,
  MonitoringPulseIcon,
  SecurityFortressIcon,
  LLMSparkleIcon,
  WorkflowFlowIcon,
  MCPToolsIcon,
  TerminalCodeIcon,
  SynthBeakerIcon,
  ChargebackCoinIcon,
  DashboardOverviewIcon,
  AgentOrchestrationIcon
} from '../Shared/AdminIcons';

// Sidebar child icon aliases — map semantic names to shared SVG icons
const UsersIcon = Users;
const CogIcon = Settings;
const ChartIcon = BarChart;
const LockIcon = Lock;
const KeyIcon = Key;
const TerminalIcon = Terminal;
const NetworkIcon = Network;
const FolderIcon = Folder;
const CubeIcon = Box;
const LogsIcon = FileText;
const GridIcon = Grid;
const PromptIcon = Sparkles;
const TemplateIcon = Layers;
const TrendingIcon = LineChart;
const ZapIcon = Zap;
const SparkleIcon = Sparkles;
const ServerRackIcon = Server;
const ToolsIcon = Wrench;
const AnalyticsIcon = BarChart2;
const RobotIcon = Bot;
const PlayExecIcon = PlayCircle;
const FeedbackIcon = Target;
const CostCoinIcon = DollarSign;
const ContextWinIcon = Cpu;
const AuthAccessIcon = ShieldCheck;
const ShieldIcon = ShieldCheck;
const RateLimitIcon = Hourglass;
const EmbeddingsIcon = Brain;
const PerformanceIcon = Rocket;
const PipelineIcon = GitBranch;
const OllamaIcon = Globe;
const MultiModelIcon = GitMerge;
const TieredFCIcon = SlidersHorizontal;
const K8sIcon = Cpu;


const FlowExecIcon = PlayCircle;
const SynthConfigIcon = FlaskConical;
const SynthApprovalIcon = Hand;
const SynthStatsIcon = BarChart2;
const WfAdminIcon = Grid;
const WfManagerIcon = Folder;
const WfUsersIcon = Users;
const WfSettingsIcon = Settings;
const CodeSettingsIcon = Settings;
const SkillsIcon = Target;
const AuditLogIcon = FileText;
const UserPermIcon = UserCheck;
const ApiTokenIcon = Key;
const GrafanaIcon = Gauge;
const SysPerformanceIcon = Gauge;
const MonitorLogsIcon = Activity;
const GlobeIcon = Globe;
import { AdminQueryProvider } from '../../hooks/useAdminQuery';

// Lazy-loaded admin views -- each section loads on-demand for fast initial render
const UsageAnalytics = React.lazy(() => import('../Monitoring/UsageAnalytics'));
const PerformanceMetrics = React.lazy(() => import('../Monitoring/PerformanceMetrics'));
const LLMPerformanceMetrics = React.lazy(() => import('../LLM/LLMPerformanceMetrics'));
const EmbeddingMetrics = React.lazy(() => import('../Monitoring/EmbeddingMetrics'));
const PromptMetrics = React.lazy(() => import('../Content/PromptMetrics'));
const ContextWindowMetrics = React.lazy(() => import('../Monitoring/ContextWindowMetrics').then(m => ({ default: m.ContextWindowMetrics })));
const LLMProviderManagement = React.lazy(() => import('../LLM/LLMProviderManagement').then(m => ({ default: m.LLMProviderManagement })));
const ModelManagementView = React.lazy(() => import('../LLM/ModelManagementView').then(m => ({ default: m.ModelManagementView })));
const MCPCallLogsView = React.lazy(() => import('../MCP/MCPCallLogsView').then(m => ({ default: m.MCPCallLogsView })));
// MCPToolsView removed (dead page)
const MCPManagementView = React.lazy(() => import('../MCP/MCPManagementView').then(m => ({ default: m.MCPManagementView })));
const AuditLogsView = React.lazy(() => import('../Monitoring/AuditLogsView').then(m => ({ default: m.AuditLogsView })));
const TestHarnessView = React.lazy(() => import('../Testing/TestHarnessView'));
const MonitoringView = React.lazy(() => import('../Monitoring/MonitoringView').then(m => ({ default: m.MonitoringView })));
// MCPAccessControlView removed (dead page)
// DeveloperAPIView removed (dead page - docs available at /docs)
const UserPermissionsView = React.lazy(() => import('../System/UserPermissionsView'));
const DashboardOverview = React.lazy(() => import('../Overview/DashboardOverview').then(m => ({ default: m.DashboardOverview })));
const PromptTemplateManager = React.lazy(() => import('../Content/PromptTemplateManager').then(m => ({ default: m.PromptTemplateManager })));
const AWCodeSessionsView = React.lazy(() => import('../Code/AWCodeSessionsView').then(m => ({ default: m.AWCodeSessionsView })));
const AWCodeSettingsView = React.lazy(() => import('../Code/AWCodeSettingsView').then(m => ({ default: m.AWCodeSettingsView })));
// New CodeMode admin views (replacing old Openagentic section)
const CodeModeSettingsView = React.lazy(() => import('../CodeMode/CodeModeSettingsView'));
const CodeModeMcpView = React.lazy(() => import('../CodeMode/CodeModeMcpView'));
const CodeModeSkillsView = React.lazy(() => import('../CodeMode/CodeModeSkillsView'));
const CodeModeUsersView = React.lazy(() => import('../CodeMode/CodeModeUsersView'));
const OllamaManagementView = React.lazy(() => import('../LLM/OllamaManagementView').then(m => ({ default: m.OllamaManagementView })));
const SystemSettingsView = React.lazy(() => import('../System/SystemSettingsView'));
const CodeModeMetricsDashboard = React.lazy(() => import('../Monitoring/CodeModeMetricsDashboard').then(m => ({ default: m.CodeModeMetricsDashboard })));
const PipelineSettingsView = React.lazy(() => import('../Content/PipelineSettingsView').then(m => ({ default: m.PipelineSettingsView })));
const SharedKBView = React.lazy(() => import('../Content/SharedKBView').then(m => ({ default: m.SharedKBView })));
const AuthAccessControlView = React.lazy(() => import('../System/AuthAccessControlView').then(m => ({ default: m.AuthAccessControlView })));
const FeedbackAnalyticsView = React.lazy(() => import('../Monitoring/FeedbackAnalyticsView').then(m => ({ default: m.FeedbackAnalyticsView })));
const UserLockoutView = React.lazy(() => import('../System/UserLockoutView'));
const RateLimitsView = React.lazy(() => import('../Security/RateLimitsView'));
const NetworkSecurityView = React.lazy(() => import('../Security/NetworkSecurityView'));
const WebhookSecurityView = React.lazy(() => import('../Security/WebhookSecurityView'));
const DLPConfigView = React.lazy(() => import('../Security/DLPConfigView'));
const TieredFCConfigView = React.lazy(() => import('../LLM/TieredFCConfigView'));
const AgentManagementView = React.lazy(() => import('../Agents').then(m => ({ default: m.AgentManagementView })));
const AgentExecutionMonitor = React.lazy(() => import('../Agents').then(m => ({ default: m.AgentExecutionMonitor })));
const AgentExecutionDashboard = React.lazy(() => import('../Agents/AgentExecutionDashboard').then(m => ({ default: m.AgentExecutionDashboard })));
const AdminWorkflowsView = React.lazy(() => import('../Workflows/AdminWorkflowsView').then(m => ({ default: m.AdminWorkflowsView })));
const AdminExecutionsView = React.lazy(() => import('../Workflows/AdminExecutionsView').then(m => ({ default: m.AdminExecutionsView })));
const WorkflowCredentialsView = React.lazy(() => import('../Workflows/WorkflowCredentialsView'));
const AdminWorkflowSettingsView = React.lazy(() => import('../Workflows/AdminWorkflowSettingsView').then(m => ({ default: m.AdminWorkflowSettingsView })));
const FlowCostsView = React.lazy(() => import('../Workflows/FlowCostsView').then(m => ({ default: m.FlowCostsView })));
const UserActivityDashboard = React.lazy(() => import('../Monitoring/UserActivityDashboard'));
const OATManagementView = React.lazy(() => import('../OAT').then(m => ({ default: m.OATManagementView })));
const OATUsageStatsView = React.lazy(() => import('../OAT').then(m => ({ default: m.OATUsageStatsView })));
const OATApprovalsView = React.lazy(() => import('../OAT').then(m => ({ default: m.OATApprovalsView })));
const ToolExecutionModeView = React.lazy(() => import('../MCP/ToolExecutionModeView').then(m => ({ default: m.ToolExecutionModeView })));
const ChargebackView = React.lazy(() => import('../Chargeback').then(m => ({ default: m.ChargebackView })));
const UnifiedDataLayerView = React.lazy(() => import('../DataLayer').then(m => ({ default: m.UnifiedDataLayerView })));
const UserContextView = React.lazy(() => import('../DataLayer/UserContextView').then(m => ({ default: m.UserContextView })));
const AgentScheduleView = React.lazy(() => import('../Agents/AgentScheduleView').then(m => ({ default: m.AgentScheduleView })));
const SkillsMarketplaceView = React.lazy(() => import('../Agents/SkillsMarketplaceView').then(m => ({ default: m.SkillsMarketplaceView })));
const IntegrationsView = React.lazy(() => import('../Integrations/IntegrationsView').then(m => ({ default: m.IntegrationsView })));
const PromptModulesView = React.lazy(() => import('../Prompts/PromptModulesView').then(m => ({ default: m.PromptModulesView })));
const EffectivenessView = React.lazy(() => import('../Prompts/EffectivenessView').then(m => ({ default: m.EffectivenessView })));
import { useAuth } from '../../../../app/providers/AuthContext';
import SettingsMenu from '../../../chat/components/SettingsMenu';
import { VersionBadge } from '@/components/VersionBadge';
import { useSystemConfig } from '@/hooks/useSystemConfig';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { featureFlags } from '@/config/featureFlags';
import { apiRequest } from '@/utils/api';

interface AdminPortalProps {
  theme: string;
  embedded?: boolean;
  onClose?: () => void;
}


interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string; color?: string }>;
  children?: SidebarItem[];
  badge?: string;
  externalUrl?: string;
}

interface DashboardData {
  users: {
    total: number;
    active: number;
  };
  sessions: {
    total: number;
    active: number;
  };
  messages: {
    total: number;
  };
  mcpServers: {
    configured: number;
    tools: number;
  };
  systemHealth: string;
}

interface MCPServer {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
}

interface MilvusCollection {
  name: string;
  description?: string;
  status?: string;
}

interface SystemPrompt {
  id: number;
  name: string;
  description: string | null;
  content: string;
  is_default: boolean;
  is_active: boolean;
  category: string | null;
  tags: string[];
  version: number;
  created_at: string;
  updated_at: string;
  assignedUsersCount: number;
}

interface PromptTemplate {
  id: number;
  name: string;
  description: string | null;
  content: string;
  category: string | null;
  tags: string[];
  is_default: boolean;
  is_active: boolean;
  is_public: boolean;
  model_specific: boolean;
  target_model: string | null;
  temperature: number | null;
  max_tokens: number | null;
  version: number;
  created_at: string;
  updated_at: string;
  assignedUsersCount: number;
}

interface ApiToken {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  name: string;
  apiKey?: string; // Only present on creation
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  isExpired: boolean;
  createdAt: string;
}

interface AvailableUser {
  id: string;
  email: string;
  name: string | null;
  displayName: string;
  createdAt: string;
}

const AdminPortal: React.FC<AdminPortalProps> = ({ theme, embedded, onClose }) => {
  const { getAuthHeaders } = useAuth();
  const { config: systemConfig } = useSystemConfig();
  const confirm = useConfirm();
  const [activeSection, setActiveSection] = useState('overview');
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set()); // All collapsed by default
  // MCP Inspector removed - tool testing now in MCPManagementView
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [mcpServersLoading, setMcpServersLoading] = useState(false);
  const [milvusCollections, setMilvusCollections] = useState<MilvusCollection[]>([]);
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);

  // User assignment state
  const [showUserAssignDialog, setShowUserAssignDialog] = useState(false);
  const [assigningPrompt, setAssigningPrompt] = useState<SystemPrompt | null>(null);
  const [assigningTemplate, setAssigningTemplate] = useState<PromptTemplate | null>(null);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);

  // API Token management state
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [showCreateTokenDialog, setShowCreateTokenDialog] = useState(false);
  const [newTokenData, setNewTokenData] = useState<{ userId: string; name: string; expiresInDays: number; rateLimitTier: string; rateLimitPerMinute?: number; rateLimitPerHour?: number }>({ userId: '', name: '', expiresInDays: 30, rateLimitTier: 'free' });
  const [createdToken, setCreatedToken] = useState<ApiToken | null>(null);
  const [apiMetrics, setApiMetrics] = useState<any>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);


  // Fetch dashboard overview data — lazy-loaded, cached once per session.
  // Only fetches when dashboard section is active AND data hasn't been loaded yet.
  // This prevents swamping the API when navigating between other admin sections.
  useEffect(() => {
    if (activeSection !== 'overview') return; // Only fetch when on dashboard
    if (dashboardData) return; // Already loaded — don't re-fetch

    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/admin/system/dashboard/overview', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setDashboardData(data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [activeSection]);

  // Fetch MCP servers data
  useEffect(() => {
    const fetchMCPServers = async () => {
      try {
        setMcpServersLoading(true);
        const response = await fetch('/api/admin/system/mcp-servers', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setMcpServers(data.servers || []);
        }
      } catch (error) {
        console.error('Failed to fetch MCP servers:', error);
      } finally {
        setMcpServersLoading(false);
      }
    };

    if (activeSection === 'servers') {
      fetchMCPServers();
    }
  }, [activeSection]);

  // Fetch Milvus collections data
  useEffect(() => {
    const fetchMilvusCollections = async () => {
      try {
        const response = await fetch('/api/admin/system/milvus/collections', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setMilvusCollections(data.collections || []);
        }
      } catch (error) {
        console.error('Failed to fetch Milvus collections:', error);
      }
    };

    if (activeSection === 'collections') {
      fetchMilvusCollections();
    }
  }, [activeSection]);

  // Fetch system prompts
  useEffect(() => {
    const fetchSystemPrompts = async () => {
      try {
        const response = await fetch('/api/admin/prompts/system-prompts', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSystemPrompts(data.prompts || []);
        }
      } catch (error) {
        console.error('Failed to fetch system prompts:', error);
      }
    };

    if (activeSection === 'prompts') {
      fetchSystemPrompts();
    }
  }, [activeSection]);

  // Fetch prompt templates
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response = await fetch('/api/admin/prompts/templates', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setPromptTemplates(data.templates || []);
        }
      } catch (error) {
        console.error('Failed to fetch templates:', error);
      }
    };

    if (activeSection === 'templates') {
      fetchTemplates();
    }
  }, [activeSection]);

  // Fetch API tokens and available users
  useEffect(() => {
    const fetchApiTokens = async () => {
      try {
        // Include expired tokens so admins can delete them
        const response = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setApiTokens(data.tokens || []);
        }
      } catch (error) {
        console.error('Failed to fetch API tokens:', error);
      }
    };

    const fetchAvailableUsers = async () => {
      try {
        const response = await fetch('/api/admin/tokens/users/available', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setAvailableUsers(data.users || []);
        }
      } catch (error) {
        console.error('Failed to fetch available users:', error);
      }
    };

    const fetchApiMetrics = async () => {
      try {
        setMetricsLoading(true);
        const response = await fetch('/api/admin/tokens/metrics', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          setApiMetrics(data);
        }
      } catch (error) {
        console.error('Failed to fetch API metrics:', error);
      } finally {
        setMetricsLoading(false);
      }
    };

    if (activeSection === 'tokens') {
      fetchApiTokens();
      fetchAvailableUsers();
      fetchApiMetrics();
    }
  }, [activeSection]);

  // Handler functions for prompts and templates
  const handleSavePrompt = async (prompt: SystemPrompt) => {
    try {
      const url = prompt.id
        ? `/api/admin/prompts/system-prompts/${prompt.id}`
        : '/api/admin/prompts/system-prompts';
      const method = prompt.id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(prompt)
      });

      if (response.ok) {
        // Refresh the list
        const listResponse = await fetch('/api/admin/prompts/system-prompts', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const data = await listResponse.json();
          setSystemPrompts(data.prompts || []);
        }
        setShowEditDialog(false);
        setEditingPrompt(null);
      }
    } catch (error) {
      console.error('Failed to save prompt:', error);
    }
  };

  const handleDeletePrompt = async (id: number) => {
    if (!await confirm('Are you sure you want to delete this prompt?', { variant: 'danger', title: 'Delete Prompt' })) return;

    try {
      const response = await fetch(`/api/admin/prompts/system-prompts/${id}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok || response.status === 204) {
        setSystemPrompts(systemPrompts.filter(p => p.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete prompt:', error);
    }
  };

  const handleSaveTemplate = async (template: PromptTemplate) => {
    try {
      const url = template.id
        ? `/api/admin/prompts/templates/${template.id}`
        : '/api/admin/prompts/templates';
      const method = template.id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(template)
      });

      if (response.ok) {
        // Refresh the list
        const listResponse = await fetch('/api/admin/prompts/templates', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const data = await listResponse.json();
          setPromptTemplates(data.templates || []);
        }
        setShowEditDialog(false);
        setEditingTemplate(null);
      }
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    if (!await confirm('Are you sure you want to delete this template?', { variant: 'danger', title: 'Delete Template' })) return;

    try {
      const response = await fetch(`/api/admin/prompts/templates/${id}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok || response.status === 204) {
        setPromptTemplates(promptTemplates.filter(t => t.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  };

  // Handler functions for user assignment
  const handleAssignUsersToPrompt = async (prompt: SystemPrompt) => {
    try {
      // Fetch currently assigned users
      const response = await fetch(`/api/admin/prompts/system-prompts/${prompt.id}/users`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAssignedUserIds(data.userIds || []);
      }

      setAssigningPrompt(prompt);
      setAssigningTemplate(null);
      setShowUserAssignDialog(true);
    } catch (error) {
      console.error('Failed to fetch assigned users:', error);
    }
  };

  const handleAssignUsersToTemplate = async (template: PromptTemplate) => {
    try {
      // Fetch currently assigned users
      const response = await fetch(`/api/admin/prompts/templates/${template.id}/users`, {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAssignedUserIds(data.userIds || []);
      }

      setAssigningTemplate(template);
      setAssigningPrompt(null);
      setShowUserAssignDialog(true);
    } catch (error) {
      console.error('Failed to fetch assigned users:', error);
    }
  };

  const handleSaveUserAssignments = async () => {
    try {
      const isPrompt = assigningPrompt !== null;
      const id = isPrompt ? assigningPrompt?.id : assigningTemplate?.id;
      const endpoint = isPrompt
        ? `/api/admin/prompts/system-prompts/${id}/users`
        : `/api/admin/prompts/templates/${id}/users`;

      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userIds: assignedUserIds })
      });

      if (response.ok) {
        // Refresh the list to update assignedUsersCount
        if (isPrompt) {
          const listResponse = await fetch('/api/admin/prompts/system-prompts', {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            }
          });
          if (listResponse.ok) {
            const data = await listResponse.json();
            setSystemPrompts(data.prompts || []);
          }
        } else {
          const listResponse = await fetch('/api/admin/prompts/templates', {
            headers: {
              ...getAuthHeaders(),
              'Content-Type': 'application/json'
            }
          });
          if (listResponse.ok) {
            const data = await listResponse.json();
            setPromptTemplates(data.templates || []);
          }
        }

        setShowUserAssignDialog(false);
        setAssigningPrompt(null);
        setAssigningTemplate(null);
        setAssignedUserIds([]);
      }
    } catch (error) {
      console.error('Failed to save user assignments:', error);
    }
  };

  const toggleUserAssignment = (userId: string) => {
    setAssignedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  // Handler functions for API tokens
  const handleCreateToken = async () => {
    if (!newTokenData.userId || !newTokenData.name) {
      alert('Please select a user and enter a token name');
      return;
    }

    try {
      const response = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newTokenData)
      });

      if (response.ok) {
        const data = await response.json();
        setCreatedToken(data.token);
        // Refresh the token list (include expired tokens)
        const listResponse = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const listData = await listResponse.json();
          setApiTokens(listData.tokens || []);
        }
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to create API token');
      }
    } catch (error: any) {
      console.error('Failed to create API token:', error);
      alert('Failed to create API token');
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!await confirm('Are you sure you want to revoke this API token? The token will be deactivated but can still be permanently deleted.', { variant: 'danger', title: 'Revoke Token' })) return;

    try {
      const response = await fetch(`/api/admin/tokens/${tokenId}`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Refresh the token list (include expired/revoked tokens)
        const listResponse = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const listData = await listResponse.json();
          setApiTokens(listData.tokens || []);
        }
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to revoke API token');
      }
    } catch (error) {
      console.error('Failed to revoke API token:', error);
      alert('Failed to revoke API token');
    }
  };

  const handleDeleteToken = async (tokenId: string) => {
    if (!await confirm('Are you sure you want to permanently delete this API token? This action cannot be undone.', { variant: 'danger', title: 'Delete Token' })) return;

    try {
      const response = await fetch(`/api/admin/tokens/${tokenId}/permanent`, {
        method: 'DELETE',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        // Refresh the token list
        const listResponse = await fetch('/api/admin/tokens?includeExpired=true', {
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          }
        });
        if (listResponse.ok) {
          const listData = await listResponse.json();
          setApiTokens(listData.tokens || []);
        }
      } else {
        const error = await response.json();
        alert(error.message || 'Failed to delete API token');
      }
    } catch (error) {
      console.error('Failed to delete API token:', error);
      alert('Failed to delete API token');
    }
  };

  // AWCodeSessionsView, AWCodeSettingsView, and CodeModeMetricsDashboard
  // are imported from their standalone files in ../Code/ and ../Monitoring/

  // Sidebar navigation structure
  // GCP-style sidebar with custom icons - 80% professional, 20% nerd
  const sidebarItems: SidebarItem[] = [
    {
      id: 'overview',
      label: 'Dashboard Overview',
      icon: DashboardOverviewIcon
    },
    {
      id: 'system',
      label: 'System Management',
      icon: SystemManagementIcon,
      children: [
        { id: 'users', label: 'User Management', icon: UsersIcon },
        { id: 'settings', label: 'System Settings', icon: CogIcon },
        { id: 'rate-limits', label: 'Rate Limits', icon: RateLimitIcon }
      ]
    },
    {
      id: 'llm',
      label: 'LLM Providers',
      icon: LLMSparkleIcon,
      children: [
        { id: 'providers', label: 'Provider Management', icon: SparkleIcon },
        { id: 'model-management', label: 'Models', icon: GridIcon },
        { id: 'ollama', label: 'Ollama Hosts', icon: OllamaIcon },
        { id: 'tiered-fc', label: 'Tiered Function Calling', icon: TieredFCIcon },
        { id: 'llm-performance', label: 'Performance Metrics', icon: PerformanceIcon }
      ]
    },
    // Tools Management - unified section for all LLM tool capabilities
    ...(featureFlags.mcp ? [{
      id: 'tools',
      label: 'Tools Management',
      icon: MCPToolsIcon,
      children: [
        { id: 'mcp-management', label: 'Server Management', icon: ServerRackIcon },
        { id: 'mcp-logs', label: 'Call Logs', icon: LogsIcon },
        { id: 'mcp-kubernetes', label: 'Kubernetes', icon: K8sIcon },
        ...(featureFlags.oat ? [
          { id: 'synth-management', label: 'Synthesis Config', icon: SynthConfigIcon },
          { id: 'synth-approvals', label: 'Synthesis Approvals', icon: SynthApprovalIcon },
          { id: 'synth-stats', label: 'Synthesis Stats', icon: SynthStatsIcon },
        ] : []),
        { id: 'tool-execution-mode', label: 'Tool Execution Mode', icon: ShieldIcon },
      ]
    }] : []),
    // OpenAgentic Native Workflows (always available)
    {
      id: 'native-workflows',
      label: 'OpenAgentic Flows',
      icon: WorkflowFlowIcon,
      children: [
        { id: 'native-workflow-list', label: 'All Workflows', icon: FolderIcon },
        { id: 'native-execution-list', label: 'All Executions', icon: FlowExecIcon },
        { id: 'native-workflow-costs', label: 'Flow Costs', icon: CostCoinIcon },
        { id: 'native-workflow-credentials', label: 'Credentials', icon: KeyIcon },
        { id: 'native-workflow-settings', label: 'Governance', icon: CogIcon },
      ]
    },
    // CodeMode - build-time feature flag (replaces old Openagentic section)
    ...(featureFlags.openagentic ? [{
      id: 'codemode',
      label: 'Code Mode',
      icon: TerminalCodeIcon,
      children: [
        { id: 'codemode-settings', label: 'Settings', icon: CodeSettingsIcon },
        { id: 'codemode-mcp', label: 'MCP Servers', icon: ServerRackIcon },
        { id: 'codemode-skills', label: 'Skills & Plugins', icon: SparkleIcon },
        { id: 'codemode-users', label: 'Users & Sessions', icon: UsersIcon },
        { id: 'openagentic-metrics', label: 'Metrics', icon: AnalyticsIcon }
      ]
    }] : []),


    // Agent Management - Registry, Skills, Executions
    {
      id: 'agent-management',
      label: 'Agent Management',
      icon: AgentOrchestrationIcon,
      children: [
        { id: 'agent-registry', label: 'Agent Registry', icon: RobotIcon },
        { id: 'agent-skills', label: 'Skills & Plugins', icon: NetworkIcon },
        { id: 'agent-executions', label: 'Agent Observability', icon: PlayExecIcon },
      ]
    },
    // Integrations - Slack, Teams, etc.
    {
      id: 'integrations',
      label: 'Integrations',
      icon: GlobeIcon,
      children: [
        { id: 'slack-integration', label: 'Slack', icon: NetworkIcon },
        { id: 'teams-integration', label: 'Microsoft Teams', icon: CubeIcon },
        { id: 'integration-logs', label: 'Integration Logs', icon: LogsIcon },
      ]
    },
    // Tool Synthesis is now under Tools Management (above)
    {
      id: 'prompt-engineering',
      label: 'Prompt Engineering',
      icon: SparkleIcon,
      children: [
        { id: 'prompt-modules', label: 'Prompt Modules', icon: Layers },
        { id: 'prompt-effectiveness', label: 'Effectiveness', icon: ChartIcon },
        { id: 'prompt-metrics', label: 'Prompt Metrics', icon: ChartIcon },
        { id: 'prompts', label: 'Legacy Templates', icon: PromptIcon, badge: 'deprecated' },
      ]
    },
    {
      id: 'content',
      label: 'Content & Data',
      icon: ContentDataIcon,
      children: [
        { id: 'templates', label: 'Chat Templates', icon: TemplateIcon },
        { id: 'pipeline-settings', label: 'Pipeline Settings', icon: PipelineIcon },
        { id: 'shared-kb', label: 'Shared Knowledge Base', icon: Brain, badge: 'Beta' },
        { id: 'data-layer', label: 'Unified Data Layer', icon: Database },
        { id: 'user-context', label: 'User Memory', icon: CubeIcon },
      ]
    },
    {
      id: 'chargeback',
      label: 'Chargeback & Costs',
      icon: ChargebackCoinIcon,
      children: [
        { id: 'chargeback-dashboard', label: 'Cost Management', icon: CostCoinIcon }
      ]
    },
    {
      id: 'monitoring',
      label: 'Monitoring & Logs',
      icon: MonitoringPulseIcon,
      children: [
        { id: 'user-activity', label: 'User Activity', icon: Activity },
        { id: 'analytics', label: 'Usage Analytics', icon: TrendingIcon },
        { id: 'feedback', label: 'Feedback Analytics', icon: FeedbackIcon },
        { id: 'audit', label: 'Audit Logs', icon: AuditLogIcon },
        { id: 'performance', label: 'Performance Metrics', icon: SysPerformanceIcon },
        { id: 'errors', label: 'Monitoring & Logs', icon: MonitorLogsIcon },
        { id: 'context-window', label: 'Context Window Metrics', icon: ContextWinIcon },
        { id: 'embeddings', label: 'Embedding Metrics', icon: EmbeddingsIcon },
        { id: 'grafana', label: 'Grafana Dashboards', icon: GrafanaIcon, externalUrl: '/grafana/', badge: 'Live' },
        { id: 'test-harness', label: 'Test Harness', icon: Activity, badge: 'Live' }
      ]
    },
    {
      id: 'security',
      label: 'Security & Access',
      icon: SecurityFortressIcon,
      children: [
        { id: 'auth-access', label: 'Auth Access Control', icon: AuthAccessIcon },
        { id: 'permissions', label: 'User Permissions', icon: UserPermIcon },
        { id: 'user-lockout', label: 'User Lockouts', icon: LockIcon },
        { id: 'tokens', label: 'API Token Management', icon: ApiTokenIcon },
        { id: 'network', label: 'Network Security', icon: NetworkIcon },
        { id: 'webhook-security', label: 'Webhook Security', icon: Shield },
        { id: 'dlp-config', label: 'DLP Configuration', icon: Shield }
      ]
    },
    // Developer API removed - Documentation available via Milvus knowledge collection
    // Development/UAT Dashboard removed - Not needed for production
  ];

  // Note: Data fetching disabled - showing placeholder content

  const toggleExpanded = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };


  // Helper to render icon - all icons are now SVG components
  const renderIcon = (icon: SidebarItem['icon'], size = 16, className = '') => {
    const IconComponent = icon;
    return <IconComponent size={size} className={className} />;
  };

  const renderSidebarItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedItems.has(item.id);
    const isActive = activeSection === item.id;
    const hasChildren = item.children && item.children.length > 0;

    return (
      <div key={item.id} className="w-full">
        <button
          onClick={() => {
            if (item.externalUrl) {
              window.open(item.externalUrl, '_blank', 'noopener,noreferrer');
              return;
            }
            if (hasChildren) {
              toggleExpanded(item.id);
            } else {
              setActiveSection(item.id);
            }
          }}
          className={`admin-nav-item w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all duration-150 ${
            isActive
              ? 'active'
              : ''
          }`}
          data-active={isActive}
          style={{
            marginLeft: `${depth * 12}px`,
            borderRadius: depth === 0 ? '0 24px 24px 0' : '8px',
            marginRight: '8px',
            fontSize: '13px'
          }}
        >
          {/* Always render the section's unique icon - no generic folders */}
          <span className="flex-shrink-0 opacity-80">
            {renderIcon(item.icon, 16)}
          </span>

          <span className="flex-1 font-medium" style={{ letterSpacing: '-0.01em' }}>{item.label}</span>

          {item.badge && (
            <span
              className={`admin-segment px-2 py-0.5 text-xs rounded font-semibold uppercase tracking-wider ${
                item.badge === 'Alpha' ? 'warning' : item.badge === 'Live' ? 'success' : ''
              }`}
            >
              {item.badge}
            </span>
          )}

          {item.externalUrl && (
            <Globe size={12} className="flex-shrink-0 opacity-40" />
          )}

          {hasChildren && (
            <ChevronRight
              size={14}
              className={`flex-shrink-0 transition-transform duration-200 opacity-50 ${
                isExpanded ? 'rotate-90' : ''
              }`}
            />
          )}
        </button>

        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {item.children!.map(child => renderSidebarItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderMainContent = () => {
    switch (activeSection) {
      case 'overview':
        return <DashboardOverview theme={theme} />;


      case 'providers':
        return <LLMProviderManagement theme={theme} />;

      case 'model-management':
        return <ModelManagementView theme={theme} />;

      // case 'multi-model': (B1 cleanup - removed)
      //   return <MultiModelConfigView />;

      case 'llm-performance':
        return <LLMPerformanceMetrics theme={theme} />;

      case 'ollama':
        return <OllamaManagementView theme={theme as 'light' | 'dark'} />;

      case 'mcp-management':
        return <MCPManagementView theme={theme} />;

      case 'mcp-logs':
        return <MCPCallLogsView theme={theme} />;

      case 'mcp-kubernetes':
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">
                Kubernetes MCP Configuration
              </h2>
              <p className="text-text-secondary">
                Manage kubeconfigs for the Kubernetes MCP server. Add multiple clusters to enable K8s administration via MCP tools.
              </p>
            </div>

            {/* In-Cluster Status */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Server size={18} />
                In-Cluster Configuration
              </h3>
              <div className="p-4 rounded-lg bg-surface-secondary mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-text-primary">Current Cluster</div>
                    <div className="text-xs text-text-secondary mt-1">
                      The K8s MCP automatically uses in-cluster ServiceAccount credentials when deployed in Kubernetes.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle style={{ color: 'var(--ap-success)' }} size={20} />
                    <span className="text-sm ap-text-success">Active</span>
                  </div>
                </div>
              </div>
              <div className="text-xs text-text-secondary">
                <strong>Protected Namespace:</strong> The namespace where OpenAgentic is deployed is automatically protected (read-only).
              </div>
            </div>

            {/* Additional Clusters */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Database size={18} />
                Additional Clusters (Coming Soon)
              </h3>
              <p className="text-text-secondary text-sm mb-4">
                Add kubeconfigs for additional Kubernetes clusters. This feature allows managing multiple clusters from a single OpenAgentic deployment.
              </p>
              <button
                disabled
                className="px-4 py-2 rounded-lg bg-accent-primary/50 text-white text-sm cursor-not-allowed opacity-50"
              >
                <Plus size={14} className="inline mr-2" />
                Add Kubeconfig
              </button>
            </div>

            {/* K8s MCP Tools Summary */}
            <div className="glass-card p-6">
              <h3 className="text-sm font-bold text-text-primary mb-4 flex items-center gap-2">
                <Activity size={18} />
                Available K8s Tools
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {['Namespaces', 'Pods', 'Deployments', 'Services', 'ConfigMaps', 'Secrets', 'Nodes', 'Helm'].map(tool => (
                  <div key={tool} className="p-3 rounded-lg bg-surface-secondary text-center">
                    <div className="text-sm font-medium text-text-primary">{tool}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs text-text-secondary">
                The Kubernetes MCP provides 40+ tools for cluster administration. Admin users can manage pods, deployments, services, helm releases, and more.
              </div>
            </div>
          </div>
        );

      // OpenAgentic Native Workflows
      case 'native-workflow-list':
        return <AdminWorkflowsView theme={theme} />;
      case 'native-execution-list':
        return <AdminExecutionsView theme={theme} />;
      case 'native-workflow-credentials':
        return <WorkflowCredentialsView theme={theme} />;
      case 'native-workflow-settings':
        return <AdminWorkflowSettingsView />;
      case 'native-workflow-costs':
        return <FlowCostsView theme={theme} />;

      // New CodeMode section
      case 'codemode-settings':
        return <CodeModeSettingsView theme={theme} />;
      case 'codemode-mcp':
        return <CodeModeMcpView theme={theme} />;
      case 'codemode-skills':
        return <CodeModeSkillsView theme={theme} />;
      case 'codemode-users':
        return <CodeModeUsersView theme={theme} />;

      // Legacy (kept for backward compat, redirects to new views)
      case 'openagentic-sessions':
        return <CodeModeUsersView theme={theme} />;
      case 'openagentic-settings':
        return <CodeModeSettingsView theme={theme} />;
      case 'openagentic-metrics':
        return <CodeModeMetricsDashboard theme={theme} />;

      // Agent Management
      case 'agent-registry':
        return <AgentManagementView theme={theme} />;
      case 'agent-skills':
        return <SkillsMarketplaceView theme={theme} />;
      case 'agent-executions':
        return <AgentExecutionDashboard theme={theme} />;
      case 'agent-schedules':
        return <AgentScheduleView theme={theme} />;

      // Integrations
      case 'slack-integration':
      case 'teams-integration':
      case 'integration-logs':
        return <IntegrationsView theme={theme} />;


      // Synth - Tool Synthesis
      case 'synth-management':
        return <OATManagementView theme={theme} />;

      case 'synth-approvals':
        return <OATApprovalsView theme={theme} />;

      case 'synth-stats':
        return <OATUsageStatsView theme={theme} />;

      case 'tool-execution-mode':
        return <ToolExecutionModeView theme={theme} />;

      case 'settings':
        return <SystemSettingsView theme={theme} />;

      case 'users':
      case 'permissions':
        return <UserPermissionsView />;

      case 'auth-access':
        return <AuthAccessControlView />;

      case 'rate-limits':
        return <RateLimitsView />;

      case 'network':
        return <NetworkSecurityView theme={theme} />;

      case 'webhook-security':
        return <WebhookSecurityView theme={theme} />;

      case 'dlp-config':
        return <DLPConfigView theme={theme} />;

      case 'user-lockout':
        return <UserLockoutView />;

      case 'tiered-fc':
        return <TieredFCConfigView />;

      case 'database':
      case 'milvus':
      case 'data-layer':
        return <UnifiedDataLayerView theme={theme} />;
      case 'user-context':
        return <UserContextView theme={theme} />;

      case 'chargeback-dashboard':
        return <ChargebackView theme={theme} />;

      case 'prompts':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold mb-2 text-text-primary">
                  System Prompts Library
                </h2>
                <p className="text-text-secondary">
                  Manage system prompts that guide AI behavior and responses
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingPrompt({
                    id: 0,
                    name: '',
                    description: '',
                    content: '',
                    is_default: false,
                    is_active: true,
                    category: 'general',
                    tags: [],
                    version: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    assignedUsersCount: 0
                  });
                  setShowEditDialog(true);
                }}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                New Prompt
              </button>
            </div>

            {systemPrompts.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <FileText size={48} className="mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No system prompts found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {systemPrompts.map((prompt) => (
                  <div key={prompt.id} className="glass-card p-6 hover:shadow-lg transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-sm font-semibold text-text-primary">{prompt.name}</h3>
                          {prompt.is_default && (
                            <span className="px-2 py-1 text-xs rounded-full bg-warning-500/10 ap-text-warning flex items-center gap-1">
                              <Star size={12} />
                              Default
                            </span>
                          )}
                          <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${
                            prompt.is_active
                              ? 'bg-success-500/10 ap-text-success'
                              : 'bg-theme-bg-secondary text-text-secondary'
                          }`}>
                            {prompt.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
                            {prompt.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {prompt.category && (
                            <span className="px-2 py-1 text-xs rounded-full bg-primary-500/10 text-primary-500">
                              {prompt.category}
                            </span>
                          )}
                        </div>
                        {prompt.description && (
                          <p className="text-sm text-text-secondary mb-3">{prompt.description}</p>
                        )}
                        <div className="bg-surface-secondary rounded-lg p-3 mb-3">
                          <p className="text-sm text-text-primary font-mono line-clamp-3">
                            {prompt.content}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-text-secondary">
                          <span>Version {prompt.version}</span>
                          <span>{prompt.assignedUsersCount} user{prompt.assignedUsersCount !== 1 ? 's' : ''}</span>
                          <span>Updated {new Date(prompt.updated_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button
                          onClick={() => handleAssignUsersToPrompt(prompt)}
                          className="px-3 py-2 rounded-lg hover:bg-primary-500/10 text-primary-500 transition-colors flex items-center gap-2 text-sm"
                          title="Assign users to this prompt"
                        >
                          <Users size={16} />
                          Assign Users
                        </button>
                        <button
                          onClick={() => {
                            setEditingPrompt(prompt);
                            setShowEditDialog(true);
                          }}
                          className="p-2 rounded-lg hover:bg-primary-500/10 text-primary-500 transition-colors"
                        >
                          <Edit size={18} />
                        </button>
                        <button
                          onClick={() => handleDeletePrompt(prompt.id)}
                          className="p-2 rounded-lg hover:bg-error-500/10 ap-text-error transition-colors"
                          disabled={prompt.is_default}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 'templates':
        return <PromptTemplateManager />;

      case 'prompt-modules':
        return <PromptModulesView />;

      case 'prompt-effectiveness':
        return <EffectivenessView />;

      case 'prompt-metrics':
        return <PromptMetrics theme={theme} />;

      case 'pipeline-settings':
        return <PipelineSettingsView />;

      case 'shared-kb':
        return <SharedKBView />;

      case 'tokens':
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold mb-2 text-text-primary">
                  API Token Management
                </h2>
                <p className="text-text-secondary">
                  Create and manage API keys for any user to access the API programmatically
                </p>
              </div>
              <button
                onClick={() => {
                  setShowCreateTokenDialog(true);
                  setNewTokenData({ userId: '', name: '', expiresInDays: 30, rateLimitTier: 'free' });
                  setCreatedToken(null);
                }}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Plus size={18} />
                Create API Token
              </button>
            </div>

            {/* Create Token Dialog */}
            {showCreateTokenDialog && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 dark:bg-black/70">
                <div className="glass-card w-full max-w-2xl m-4 p-6">
                  {!createdToken ? (
                    <>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-base font-bold text-text-primary">Create New API Token</h3>
                        <button
                          onClick={() => setShowCreateTokenDialog(false)}
                          className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            User *
                          </label>
                          <select
                            value={newTokenData.userId}
                            onChange={(e) => setNewTokenData({ ...newTokenData, userId: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          >
                            <option value="" style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }}>Select a user...</option>
                            {availableUsers.map(user => (
                              <option key={user.id} value={user.id} style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }}>
                                {user.displayName}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-text-secondary mt-1">
                            Create an API token for any user to access the API programmatically
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            Token Name *
                          </label>
                          <input
                            type="text"
                            value={newTokenData.name}
                            onChange={(e) => setNewTokenData({ ...newTokenData, name: e.target.value })}
                            placeholder="e.g., Production Server, Dev Environment, CI/CD Pipeline"
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            Expires In (Days)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="365"
                            value={newTokenData.expiresInDays}
                            onChange={(e) => setNewTokenData({ ...newTokenData, expiresInDays: parseInt(e.target.value) || 30 })}
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          />
                          <p className="text-xs text-text-secondary mt-1">
                            Token will expire after this many days. Maximum 365 days.
                          </p>
                        </div>

                        {/* Rate Limit Configuration */}
                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            Rate Limit Tier
                          </label>
                          <select
                            value={newTokenData.rateLimitTier}
                            onChange={(e) => setNewTokenData({ ...newTokenData, rateLimitTier: e.target.value })}
                            className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                            style={{
                              backgroundColor: 'var(--color-surfaceSecondary)',
                              borderColor: 'var(--color-border)',
                              color: 'var(--color-text)'
                            }}
                          >
                            <option value="free">Free (60 req/min, 1K req/hour)</option>
                            <option value="pro">Pro (120 req/min, 5K req/hour)</option>
                            <option value="enterprise">Enterprise (300 req/min, Unlimited/hour)</option>
                            <option value="custom">Custom</option>
                          </select>
                        </div>

                        {newTokenData.rateLimitTier === 'custom' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-text-primary mb-2">
                                Requests per Minute
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="10000"
                                value={newTokenData.rateLimitPerMinute || ''}
                                onChange={(e) => setNewTokenData({ ...newTokenData, rateLimitPerMinute: parseInt(e.target.value) || undefined })}
                                placeholder="e.g., 60"
                                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                                style={{
                                  backgroundColor: 'var(--color-surfaceSecondary)',
                                  borderColor: 'var(--color-border)',
                                  color: 'var(--color-text)'
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-text-primary mb-2">
                                Requests per Hour
                              </label>
                              <input
                                type="number"
                                min="1"
                                max="100000"
                                value={newTokenData.rateLimitPerHour || ''}
                                onChange={(e) => setNewTokenData({ ...newTokenData, rateLimitPerHour: parseInt(e.target.value) || undefined })}
                                placeholder="e.g., 1000"
                                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                                style={{
                                  backgroundColor: 'var(--color-surfaceSecondary)',
                                  borderColor: 'var(--color-border)',
                                  color: 'var(--color-text)'
                                }}
                              />
                            </div>
                          </>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-3 mt-6">
                        <button
                          onClick={() => setShowCreateTokenDialog(false)}
                          className="px-4 py-2 rounded-lg bg-surface-secondary text-text-primary hover:bg-surface-hover transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateToken}
                          disabled={!newTokenData.userId || !newTokenData.name}
                          className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          <Key size={18} />
                          Generate Token
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-base font-bold ap-text-success">API Token Created Successfully!</h3>
                        <button
                          onClick={() => {
                            setShowCreateTokenDialog(false);
                            setCreatedToken(null);
                          }}
                          className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
                        >
                          <X size={20} />
                        </button>
                      </div>

                      <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-warning-500/10 border border-warning/20">
                          <p className="text-sm font-medium ap-text-warning mb-2">
                            Important: Save this token now!
                          </p>
                          <p className="text-xs text-text-secondary">
                            This is the only time you'll see this token. Store it securely - it won't be shown again.
                          </p>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-text-primary mb-2">
                            API Token
                          </label>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={createdToken.apiKey || ''}
                              readOnly
                              className="flex-1 px-4 py-2 rounded-lg border font-mono text-sm"
                              style={{
                                backgroundColor: 'var(--color-surfaceSecondary)',
                                borderColor: 'var(--color-border)',
                                color: 'var(--color-text)'
                              }}
                            />
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(createdToken.apiKey || '');
                                alert('Token copied to clipboard!');
                              }}
                              className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Token Name</label>
                            <p className="text-sm font-medium text-text-primary">{createdToken.name}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">User</label>
                            <p className="text-sm font-medium text-text-primary">{createdToken.userName}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Expires</label>
                            <p className="text-sm font-medium text-text-primary">
                              {createdToken.expiresAt ? new Date(createdToken.expiresAt).toLocaleDateString() : 'Never'}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Created</label>
                            <p className="text-sm font-medium text-text-primary">
                              {new Date(createdToken.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end mt-6">
                        <button
                          onClick={() => {
                            setShowCreateTokenDialog(false);
                            setCreatedToken(null);
                          }}
                          className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors"
                        >
                          Done
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Token List */}
            {apiTokens.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <Key size={48} className="mx-auto mb-4 text-text-secondary" />
                <p className="text-text-secondary">No API tokens found</p>
                <p className="text-sm text-text-secondary mt-2">
                  Create an API token to allow programmatic access to the API
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {apiTokens.map((token) => (
                  <div key={token.id} className="glass-card p-6 hover:shadow-lg transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-sm font-semibold text-text-primary">{token.name}</h3>
                          <span className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${
                            token.isActive && !token.isExpired
                              ? 'bg-success-500/10 ap-text-success'
                              : 'bg-error-500/10 ap-text-error'
                          }`}>
                            {token.isActive && !token.isExpired ? 'Active' : token.isExpired ? 'Expired' : 'Revoked'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4">
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">User</label>
                            <p className="text-sm font-medium text-text-primary">{token.userName}</p>
                            <p className="text-xs text-text-secondary">{token.userEmail}</p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Created</label>
                            <p className="text-sm font-medium text-text-primary">
                              {new Date(token.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Last Used</label>
                            <p className="text-sm font-medium text-text-primary">
                              {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : 'Never'}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Expires</label>
                            <p className={`text-sm font-medium ${token.isExpired ? 'ap-text-error' : 'text-text-primary'}`}>
                              {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'Never'}
                            </p>
                          </div>
                          <div>
                            <label className="block text-xs text-text-secondary mb-1">Rate Limit</label>
                            <p className="text-sm font-medium text-text-primary capitalize">
                              {(token as any).rateLimitTier || 'free'}
                            </p>
                            {(token as any).rateLimitPerMinute && (
                              <p className="text-xs text-text-secondary">
                                {(token as any).rateLimitPerMinute} req/min
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="ml-4 flex items-center gap-2">
                        {/* Revoke button - only for active tokens */}
                        {token.isActive && !token.isExpired && (
                          <button
                            onClick={() => handleRevokeToken(token.id)}
                            className="p-2 rounded-lg hover:bg-warning-500/10 ap-text-warning transition-colors"
                            title="Revoke Token"
                          >
                            <XCircle size={18} />
                          </button>
                        )}
                        {/* Delete button - only for revoked or expired tokens */}
                        {(!token.isActive || token.isExpired) && (
                          <button
                            onClick={() => handleDeleteToken(token.id)}
                            className="p-2 rounded-lg hover:bg-error-500/10 ap-text-error transition-colors"
                            title="Permanently Delete Token"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* API Token Usage Metrics Dashboard */}
            {apiMetrics && (
              <div className="space-y-4 mt-6">
                <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                  <BarChart size={20} />
                  API Token Usage Metrics
                </h3>

                {/* Overall Statistics */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Total Tokens</div>
                    <div className="text-2xl font-bold text-text-primary">{apiMetrics.overall?.totalTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Active</div>
                    <div className="text-2xl font-bold ap-text-success">{apiMetrics.overall?.activeTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Expired</div>
                    <div className="text-2xl font-bold ap-text-warning">{apiMetrics.overall?.expiredTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Revoked</div>
                    <div className="text-2xl font-bold ap-text-error">{apiMetrics.overall?.revokedTokens || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Total Requests</div>
                    <div className="text-2xl font-bold text-primary-500">{apiMetrics.overall?.totalRequests?.toLocaleString() || 0}</div>
                  </div>
                  <div className="glass-card p-4">
                    <div className="text-xs text-text-secondary mb-1">Total Errors</div>
                    <div className="text-2xl font-bold ap-text-error">{apiMetrics.overall?.totalErrors?.toLocaleString() || 0}</div>
                  </div>
                </div>

                {/* Per-Token Detailed Metrics */}
                {apiMetrics.tokens && apiMetrics.tokens.length > 0 && (
                  <div className="space-y-4">
                    <h4 className="text-sm font-semibold text-text-primary">Per-Token Metrics</h4>
                    {apiMetrics.tokens.map((tokenMetric: any) => (
                      <div key={tokenMetric.tokenId} className="glass-card p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h5 className="text-sm font-semibold text-text-primary">{tokenMetric.tokenName}</h5>
                            <p className="text-xs text-text-secondary">{tokenMetric.userName} ({tokenMetric.userEmail})</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              tokenMetric.isActive && !tokenMetric.isExpired
                                ? 'bg-success-500/10 ap-text-success'
                                : 'bg-error-500/10 ap-text-error'
                            }`}>
                              {tokenMetric.isActive && !tokenMetric.isExpired ? 'Active' : tokenMetric.isExpired ? 'Expired' : 'Revoked'}
                            </span>
                          </div>
                        </div>

                        {/* Metric Summary */}
                        {tokenMetric.metrics && (
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Total Requests</div>
                            <div className="text-lg font-bold text-text-primary">{(tokenMetric.metrics.totalRequests || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Errors</div>
                            <div className="text-lg font-bold ap-text-error">{(tokenMetric.metrics.totalErrors || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Error Rate</div>
                            <div className="text-lg font-bold ap-text-warning">{(tokenMetric.metrics.errorRate || 0).toFixed(2)}%</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Token Usage</div>
                            <div className="text-lg font-bold text-primary-500">{(tokenMetric.metrics.totalTokens || 0).toLocaleString()}</div>
                          </div>
                          <div className="bg-surface-secondary p-3 rounded-lg">
                            <div className="text-xs text-text-secondary mb-1">Avg Response (ms)</div>
                            <div className="text-lg font-bold ap-text-info">{(tokenMetric.metrics.averageResponseTime || 0).toFixed(0)}</div>
                          </div>
                        </div>
                        )}

                        {/* Endpoint Usage */}
                        {tokenMetric.metrics?.endpointUsage && tokenMetric.metrics.endpointUsage.length > 0 && (
                          <div className="mb-4">
                            <h6 className="text-xs font-semibold text-text-primary mb-2">Top Endpoints</h6>
                            <div className="space-y-2">
                              {tokenMetric.metrics.endpointUsage.slice(0, 5).map((ep: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <div className="flex-1 bg-surface-secondary rounded-full h-6 overflow-hidden">
                                    <div
                                      className="bg-primary-500/30 h-full flex items-center px-2"
                                      style={{ width: `${ep.percentage}%` }}
                                    >
                                      <span className="text-xs font-mono text-text-primary truncate">{ep.endpoint}</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-text-secondary w-16 text-right">{ep.count} ({ep.percentage.toFixed(1)}%)</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Error Breakdown */}
                        {tokenMetric.metrics?.errorBreakdown && tokenMetric.metrics.errorBreakdown.length > 0 && (
                          <div className="mb-4">
                            <h6 className="text-xs font-semibold text-text-primary mb-2">Error Breakdown</h6>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {tokenMetric.metrics.errorBreakdown.map((err: any, idx: number) => (
                                <div key={idx} className="bg-error-500/10 p-2 rounded">
                                  <div className="text-xs ap-text-error font-semibold">{err.errorType}</div>
                                  <div className="text-sm text-text-primary">{err.count} ({err.percentage.toFixed(1)}%)</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Request Frequency Chart (Last 30 Days) */}
                        {tokenMetric.metrics?.requestFrequency && tokenMetric.metrics.requestFrequency.length > 0 && (
                          <div>
                            <h6 className="text-xs font-semibold text-text-primary mb-2">Request Frequency (Last 30 Days)</h6>
                            <div className="flex items-end gap-1 h-20">
                              {tokenMetric.metrics.requestFrequency.map((freq: any, idx: number) => {
                                const maxCount = Math.max(...tokenMetric.metrics.requestFrequency.map((f: any) => f.count));
                                const height = maxCount > 0 ? (freq.count / maxCount) * 100 : 0;
                                return (
                                  <div
                                    key={idx}
                                    className="flex-1 bg-primary-500/50 hover:bg-primary-500 transition-colors rounded-t"
                                    style={{ height: `${height}%` }}
                                    title={`${freq.date}: ${freq.count} requests`}
                                  />
                                );
                              })}
                            </div>
                            <div className="flex justify-between text-xs text-text-secondary mt-1">
                              <span>{tokenMetric.metrics.requestFrequency[0]?.date}</span>
                              <span>{tokenMetric.metrics.requestFrequency[tokenMetric.metrics.requestFrequency.length - 1]?.date}</span>
                            </div>
                          </div>
                        )}

                        {/* Last Used */}
                        <div className="mt-4 pt-4 border-t border-border text-xs text-text-secondary">
                          Last used: {tokenMetric.lastUsedAt ? new Date(tokenMetric.lastUsedAt).toLocaleString() : 'Never'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {metricsLoading && (
                  <div className="glass-card p-8 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mx-auto mb-4"></div>
                    <p className="text-text-secondary">Loading metrics...</p>
                  </div>
                )}
              </div>
            )}

          </div>
        );

      case 'user-activity':
        return <UserActivityDashboard theme={theme} />;

      case 'analytics':
        return <UsageAnalytics theme={theme} />;

      case 'feedback':
        return <FeedbackAnalyticsView theme={theme} />;

      case 'performance':
        return <LLMPerformanceMetrics theme={theme} />;
      case 'context-window':
        return <ContextWindowMetrics />;

      case 'embeddings':
        return <EmbeddingMetrics theme={theme} />;

      case 'audit':
        return <AuditLogsView theme={theme} />;
      case 'test-harness':
        return <TestHarnessView />;

      case 'errors':
        return <MonitoringView theme={theme} />;

      default:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-base font-bold mb-2 text-text-primary">
                {sidebarItems.find(item =>
                  item.id === activeSection ||
                  item.children?.some(child => child.id === activeSection)
                )?.label || 'Admin Section'}
              </h2>
              <p className="text-text-secondary">Feature coming soon...</p>
            </div>

            <div className="glass-card p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="p-4 rounded-full bg-primary-500/10 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                  <Settings size={32} className="text-primary-500" />
                </div>
                <h3 className="text-base font-semibold mb-2 text-text-primary">Feature Coming Soon</h3>
                <p className="text-text-secondary">This admin feature is currently under development and will be available in a future update.</p>
              </div>
            </div>
          </div>
        );
    }
  };

  // Edit Dialog Component
  // Memoized handlers to prevent EditDialog recreation on each keystroke
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, name: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, name: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleDescriptionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, description: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, description: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, content: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, content: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleCategoryChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, category: value } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, category: value } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleCloseDialog = useCallback(() => {
    setShowEditDialog(false);
    setEditingPrompt(null);
    setEditingTemplate(null);
  }, []);

  const handleTemperatureChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditingTemplate(prev => prev ? { ...prev, temperature: value ? parseFloat(value) : null } : null);
  }, []);

  const handleMaxTokensChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditingTemplate(prev => prev ? { ...prev, max_tokens: value ? parseInt(value) : null } : null);
  }, []);

  const handleTargetModelChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEditingTemplate(prev => prev ? { ...prev, target_model: value || null, model_specific: !!value } : null);
  }, []);

  const handleIsDefaultChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, is_default: checked } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, is_default: checked } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleIsActiveChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    if (editingPrompt) {
      setEditingPrompt(prev => prev ? { ...prev, is_active: checked } : null);
    } else if (editingTemplate) {
      setEditingTemplate(prev => prev ? { ...prev, is_active: checked } : null);
    }
  }, [editingPrompt, editingTemplate]);

  const handleIsPublicChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setEditingTemplate(prev => prev ? { ...prev, is_public: checked } : null);
  }, []);

  // Memoized EditDialog component to prevent recreation on parent re-renders
  const EditDialog = useMemo(() => {
    if (!showEditDialog || (!editingPrompt && !editingTemplate)) return null;

    const isPrompt = !!editingPrompt;
    const item = isPrompt ? editingPrompt : editingTemplate;
    if (!item) return null;

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 dark:bg-black/70">
        <div
          className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col m-4 rounded-2xl shadow-2xl border"
          style={{
            backgroundColor: 'var(--color-background)',
            borderColor: 'var(--color-border)'
          }}
        >
          {/* Header */}
          <div
            className="p-6 border-b flex items-center justify-between"
            style={{
              borderColor: 'var(--color-border)'
            }}
          >
            <h2 className="text-sm font-bold text-text-primary">
              {item.id ? 'Edit' : 'Create'} {isPrompt ? 'System Prompt' : 'Chat Template'}
            </h2>
            <button
              onClick={handleCloseDialog}
              className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Form */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Name *
              </label>
              <input
                type="text"
                defaultValue={item.name}
                onChange={handleNameChange}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                placeholder="Enter name..."
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Description
              </label>
              <textarea
                defaultValue={item.description || ''}
                onChange={handleDescriptionChange}
                className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                placeholder="Enter description..."
                rows={2}
              />
            </div>

            {/* Content */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Content *
              </label>
              <textarea
                defaultValue={item.content}
                onChange={handleContentChange}
                className="w-full px-4 py-2 rounded-lg border font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                style={{
                  backgroundColor: 'var(--color-surfaceSecondary)',
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
                placeholder="Enter prompt/template content..."
                rows={12}
              />
              <p className="text-xs text-text-secondary mt-2">
                Character count: {item.content.length}
              </p>
            </div>

            {/* Category and Tags */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Category
                </label>
                <select
                  defaultValue={item.category || 'general'}
                  onChange={handleCategoryChange}
                  className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                  style={{
                    backgroundColor: 'var(--color-surfaceSecondary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text)'
                  }}
                >
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="general">General</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="development">Development</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="writing">Writing</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="analysis">Analysis</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="creative">Creative</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="business">Business</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="education">Education</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="technical">Technical</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="research">Research</option>
                  <option style={{ backgroundColor: 'var(--color-surfaceSecondary)', color: 'var(--color-text)' }} value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Template-specific fields */}
            {!isPrompt && editingTemplate && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Temperature
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      defaultValue={editingTemplate.temperature || ''}
                      onChange={handleTemperatureChange}
                      className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                      style={{
                        backgroundColor: 'var(--color-surfaceSecondary)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)'
                      }}
                      placeholder="0.7"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Max Tokens
                    </label>
                    <input
                      type="number"
                      defaultValue={editingTemplate.max_tokens || ''}
                      onChange={handleMaxTokensChange}
                      className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                      style={{
                        backgroundColor: 'var(--color-surfaceSecondary)',
                        borderColor: 'var(--color-border)',
                        color: 'var(--color-text)'
                      }}
                      placeholder="2000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Target Model (optional)
                  </label>
                  <input
                    type="text"
                    defaultValue={editingTemplate.target_model || ''}
                    onChange={handleTargetModelChange}
                    className="w-full px-4 py-2 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary-500"
                    style={{
                      backgroundColor: 'var(--color-surfaceSecondary)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text)'
                    }}
                    placeholder="gpt-4, claude-3, etc."
                  />
                </div>
              </>
            )}

            {/* Toggles */}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  defaultChecked={item.is_default}
                  onChange={handleIsDefaultChange}
                  className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm text-text-primary">Set as Default</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  defaultChecked={item.is_active}
                  onChange={handleIsActiveChange}
                  className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                <span className="text-sm text-text-primary">Active</span>
              </label>

              {!isPrompt && editingTemplate && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    defaultChecked={editingTemplate.is_public}
                    onChange={handleIsPublicChange}
                    className="w-4 h-4 rounded border-border text-primary-500 focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-text-primary">Public</span>
                </label>
              )}
            </div>
          </div>

          {/* Footer */}
          <div
            className="p-6 border-t flex items-center justify-end gap-3"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surfaceTertiary)'
            }}
          >
            <button
              onClick={handleCloseDialog}
              className="px-4 py-2 rounded-lg transition-colors"
              style={{
                backgroundColor: 'var(--color-surfaceSecondary)',
                color: 'var(--color-text)'
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (isPrompt && editingPrompt) {
                  handleSavePrompt(editingPrompt);
                } else if (editingTemplate) {
                  handleSaveTemplate(editingTemplate);
                }
              }}
              disabled={!item.name || !item.content}
              className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Save size={18} />
              Save {isPrompt ? 'Prompt' : 'Template'}
            </button>
          </div>
        </div>
      </div>
    );
  }, [
    showEditDialog,
    editingPrompt,
    editingTemplate,
    handleNameChange,
    handleDescriptionChange,
    handleContentChange,
    handleCategoryChange,
    handleTemperatureChange,
    handleMaxTokensChange,
    handleTargetModelChange,
    handleIsDefaultChange,
    handleIsActiveChange,
    handleIsPublicChange,
    handleCloseDialog,
    handleSavePrompt,
    handleSaveTemplate
  ]);

  return (
    <AdminQueryProvider>
    <div className="fixed inset-0 z-[1100] flex admin-portal" style={{ background: 'transparent' }}>
      {/* Edit Dialog */}
      {EditDialog}

      {/* User Assignment Dialog */}
      {showUserAssignDialog && (assigningPrompt || assigningTemplate) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 dark:bg-black/70">
          <div
            className="w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col m-4 rounded-2xl shadow-2xl border"
            style={{
              backgroundColor: 'var(--color-background)',
              borderColor: 'var(--color-border)'
            }}
          >
            <div
              className="p-6 border-b flex items-center justify-between"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h2 className="text-sm font-bold text-text-primary">
                Assign Users to {assigningPrompt ? assigningPrompt.name : assigningTemplate?.name}
              </h2>
              <button
                onClick={() => {
                  setShowUserAssignDialog(false);
                  setAssigningPrompt(null);
                  setAssigningTemplate(null);
                  setAssignedUserIds([]);
                }}
                className="p-2 rounded-lg hover:bg-surface-secondary transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <p className="text-sm text-text-secondary mb-4">
                Select users who should have access to this {assigningPrompt ? 'prompt' : 'template'}
              </p>

              {availableUsers.length === 0 ? (
                <div className="glass-card p-8 text-center">
                  <Users size={48} className="mx-auto mb-4 text-text-secondary" />
                  <p className="text-text-secondary">No users available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableUsers.map((user) => (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-surface-secondary transition-colors"
                      style={{
                        borderColor: assignedUserIds.includes(user.id) ? 'var(--color-primary)' : 'var(--color-border)',
                        backgroundColor: assignedUserIds.includes(user.id) ? 'var(--color-primary-500)/10' : 'transparent'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={assignedUserIds.includes(user.id)}
                        onChange={() => toggleUserAssignment(user.id)}
                        className="w-4 h-4 rounded border-border"
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-text-primary">{user.displayName}</div>
                        <div className="text-xs text-text-secondary">{user.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div
              className="p-6 border-t flex items-center justify-end gap-3"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <button
                onClick={() => {
                  setShowUserAssignDialog(false);
                  setAssigningPrompt(null);
                  setAssigningTemplate(null);
                  setAssignedUserIds([]);
                }}
                className="px-4 py-2 rounded-lg border hover:bg-surface-secondary transition-colors"
                style={{
                  borderColor: 'var(--color-border)',
                  color: 'var(--color-text)'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUserAssignments}
                className="px-4 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-2"
              >
                <Save size={18} />
                Save Assignments
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar - GCP Style */}
      <div
        className="admin-sidebar w-64 flex-shrink-0 flex flex-col"
        style={{
          background: 'var(--ap-bg-secondary)',
          borderRight: '1px solid var(--ap-border)'
        }}
      >
        {/* Logo/Header */}
        <div
          className="px-4 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--ap-border)' }}
        >
          <div className="flex items-center gap-3">
            <CogIcon size={20} className="text-[var(--ap-accent)]" />
            <span
              className="font-semibold text-[var(--ap-text)]"
              style={{ fontSize: '14px', letterSpacing: '-0.02em' }}
            >
              Admin Console
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors hover:bg-[var(--ap-bg-tertiary)]"
              style={{ color: 'var(--ap-text-muted)' }}
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Navigation Items - scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide py-2 space-y-0.5">
          {sidebarItems.map(item => renderSidebarItem(item))}
        </div>

        {/* Version badge + Settings menu (pinned to bottom) */}
        <div className="shrink-0" style={{ background: 'var(--ap-bg-secondary)', borderTop: '1px solid var(--ap-border)' }}>
          <div className="px-3 pt-2 pb-0">
            <VersionBadge />
          </div>
          <div className="px-3 py-3">
            <SettingsMenu
              isExpanded={true}
              currentTheme={theme}
              isAdmin={true}
              onLogout={() => { window.location.href = '/'; }}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col admin-main-content">
        {/* Header - GCP Style */}
        <div
          className="admin-header px-6 py-3 flex items-center justify-between"
          style={{
            background: 'var(--ap-bg)',
            borderBottom: '1px solid var(--ap-border)'
          }}
        >
          <div className="flex items-center gap-3">
            <Clock size={14} className="opacity-50" />
            <span style={{ fontSize: '12px', color: 'var(--ap-text-muted)' }}>
              Last updated: {new Date().toLocaleTimeString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Nerd font status indicators */}
            <span
              className="admin-segment success flex items-center gap-1.5"
              title="System Status"
            >
              <CheckCircle size={10} />
              <span>Healthy</span>
            </span>
          </div>
        </div>

        {/* Content Area */}
        <div
          className="flex-1 p-6 overflow-y-auto"
          style={{
            fontSize: '13px',
            background: 'var(--ap-bg)',
            color: 'var(--ap-text)'
          }}
        >
          {loading && activeSection === 'overview' ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
              <span className="ml-4 text-sm text-text-secondary">Loading dashboard...</span>
            </div>
          ) : (
            <Suspense fallback={
              <div className="flex items-center justify-center h-64 w-full">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-text-secondary">Loading...</span>
                </div>
              </div>
            }>
              {renderMainContent()}
            </Suspense>
          )}
        </div>
      </div>
    </div>
    </AdminQueryProvider>
  );
};

// Wrap with React.memo to prevent unnecessary re-renders during chat streaming
export default React.memo(AdminPortal);