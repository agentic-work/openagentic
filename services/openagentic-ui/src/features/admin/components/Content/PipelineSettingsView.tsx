import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../../../../app/providers/AuthContext';
import { useConfirm } from '@/shared/hooks/useConfirm';
import { PageHeader } from '../../primitives-v2';
import { onKeyActivate } from '@/utils/a11y';

// ============================================================================
// CUSTOM SVG ICONS (replacing lucide-react)
// ============================================================================

const Icons = {
  Shield: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  CheckCircle: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22,4 12,14.01 9,11.01" />
    </svg>
  ),
  Database: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  ),
  Brain: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
    </svg>
  ),
  MessageSquare: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  Wrench: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  Layers: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12,2 2,7 12,12 22,7 12,2" />
      <polyline points="2,17 12,22 22,17" />
      <polyline points="2,12 12,17 22,12" />
    </svg>
  ),
  Zap: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2" />
    </svg>
  ),
  Settings: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  FileOutput: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" />
      <polyline points="14,2 14,8 20,8" />
      <path d="M2 15h10" />
      <path d="m5 12-3 3 3 3" />
    </svg>
  ),
  ToggleLeft: ({ size = 24, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="8" cy="12" r="3" />
    </svg>
  ),
  ToggleRight: ({ size = 24, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="1" y="5" width="22" height="14" rx="7" ry="7" />
      <circle cx="16" cy="12" r="3" />
    </svg>
  ),
  Save: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17,21 17,13 7,13 7,21" />
      <polyline points="7,3 7,8 15,8" />
    </svg>
  ),
  RefreshCw: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="23,4 23,10 17,10" />
      <polyline points="1,20 1,14 7,14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  RotateCcw: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="1,4 1,10 7,10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  ),
  AlertCircle: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Info: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  Loader2: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`animate-spin ${className}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  ),
  ChevronDown: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="6,9 12,15 18,9" />
    </svg>
  ),
  // Skills icons
  Smile: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  ),
  Skull: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <path d="M8 20v2h8v-2" />
      <path d="m12.5 17-.5-1-.5 1h1z" />
      <path d="M16 20a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20" />
    </svg>
  ),
  Ghost: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
      <path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z" />
    </svg>
  ),
  Heart: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  ),
  Flame: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  ),
  Star: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26 12,2" />
    </svg>
  ),
  Crown: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14" />
    </svg>
  ),
  Sparkles: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  ),
  Plus: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Trash: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="3,6 5,6 21,6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  Edit: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  ArrowRight: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12,5 19,12 12,19" />
    </svg>
  ),
  // Missing icons for Skills categories
  Code: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  FileText: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  ),
  BarChart: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="12" y1="20" x2="12" y2="10" />
      <line x1="18" y1="20" x2="18" y2="4" />
      <line x1="6" y1="20" x2="6" y2="16" />
    </svg>
  ),
  Server: ({ size = 18, className = '' }: { size?: number; className?: string }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  ),
};

// ============================================================================
// SKILLS - Professional task-focused capabilities (Anthropic Skills format)
// https://github.com/anthropics/skills
// ============================================================================

type SkillCategory = 'development' | 'design' | 'writing' | 'analysis' | 'enterprise' | 'custom';

interface Skill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  category: SkillCategory;
  icon: keyof typeof Icons;
  color: string;
  isBuiltIn: boolean;
}

const CATEGORY_COLORS: Record<SkillCategory, string> = {
  development: 'text-primary-500 bg-primary-500/10',
  design: 'ap-text-info bg-info-500/10',
  writing: 'ap-text-success bg-success-500/10',
  analysis: 'text-warn bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]',
  enterprise: 'text-primary-500 bg-primary-500/10',
  custom: 'ap-text-info bg-info-500/10',
};

const CATEGORY_ICONS: Record<SkillCategory, keyof typeof Icons> = {
  development: 'Code',
  design: 'Layers',
  writing: 'FileText',
  analysis: 'BarChart',
  enterprise: 'Server',
  custom: 'Sparkles',
};

const BUILT_IN_SKILLS: Skill[] = [
  {
    id: 'openagentic-expert',
    name: 'OpenAgentic Platform Expert',
    emoji: '🚀',
    description: 'Master of the OpenAgentic platform - knows all features, MCPs, integrations, and best practices',
    category: 'enterprise',
    systemPrompt: `You are the definitive expert on the OpenAgentic platform with deep knowledge of all capabilities.`,
    icon: 'Server',
    color: 'text-primary-500 bg-primary-500/10',
    isBuiltIn: true,
  },
  {
    id: 'serena-code',
    name: 'Serena Code Editor',
    emoji: '✨',
    description: 'Expert code editing with symbolic understanding - finds, navigates, and modifies code intelligently',
    category: 'development',
    systemPrompt: `You are an expert code editor with deep symbolic understanding of codebases.`,
    icon: 'Code',
    color: 'text-primary-500 bg-primary-500/10',
    isBuiltIn: true,
  },
  {
    id: 'code-review',
    name: 'Code Review',
    emoji: '🔍',
    description: 'Thorough code review with security, performance, and best practice analysis',
    category: 'development',
    systemPrompt: `You are an expert code reviewer focusing on security, performance, and best practices.`,
    icon: 'Code',
    color: 'text-primary-500 bg-primary-500/10',
    isBuiltIn: true,
  },
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    emoji: '🎨',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality',
    category: 'design',
    systemPrompt: `Create distinctive, production-grade frontend interfaces that prioritize originality.`,
    icon: 'Layers',
    color: 'ap-text-info bg-info-500/10',
    isBuiltIn: true,
  },
  {
    id: 'technical-writing',
    name: 'Technical Writing',
    emoji: '📝',
    description: 'Create clear, well-structured technical documentation and guides',
    category: 'writing',
    systemPrompt: `Create clear, accurate, and user-focused technical documentation.`,
    icon: 'FileText',
    color: 'ap-text-success bg-success-500/10',
    isBuiltIn: true,
  },
  {
    id: 'data-analysis',
    name: 'Data Analysis',
    emoji: '📊',
    description: 'Analyze data sets, identify patterns, and generate insights with visualizations',
    category: 'analysis',
    systemPrompt: `Provide rigorous, insightful data analysis with clear visualizations.`,
    icon: 'BarChart',
    color: 'text-warn bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]',
    isBuiltIn: true,
  },
  {
    id: 'architecture-design',
    name: 'Architecture Design',
    emoji: '🏗️',
    description: 'Design scalable system architectures with clear diagrams and trade-off analysis',
    category: 'development',
    systemPrompt: `Design robust, scalable system architectures with clear documentation.`,
    icon: 'Server',
    color: 'text-primary-500 bg-primary-500/10',
    isBuiltIn: true,
  },
  {
    id: 'api-design',
    name: 'API Design',
    emoji: '🔌',
    description: 'Design clean, consistent, and well-documented REST and GraphQL APIs',
    category: 'development',
    systemPrompt: `Design clean, consistent, developer-friendly APIs that are easy to use and maintain.`,
    icon: 'Code',
    color: 'text-primary-500 bg-primary-500/10',
    isBuiltIn: true,
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    emoji: '🔒',
    description: 'Perform security assessments and identify vulnerabilities with remediation advice',
    category: 'analysis',
    systemPrompt: `Perform comprehensive security assessments with actionable remediation guidance.`,
    icon: 'Shield',
    color: 'text-warn bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]',
    isBuiltIn: true,
  },
  {
    id: 'internal-comms',
    name: 'Internal Communications',
    emoji: '📣',
    description: 'Draft professional internal communications, announcements, and documentation',
    category: 'enterprise',
    systemPrompt: `Create clear, professional internal communications that inform and engage employees.`,
    icon: 'FileText',
    color: 'text-primary-500 bg-primary-500/10',
    isBuiltIn: true,
  },
];

// ============================================================================
// TYPES
// ============================================================================

interface AuthStageConfig {
  rateLimitPerMinute: number;
  rateLimitPerHour: number;
  allowOnRateLimitFailure: boolean;
}

interface ValidationStageConfig {
  maxHistory: number;
  enableMemoryContextService: boolean;
  maxContextTokens: number;
}

interface RAGStageConfig {
  enabled: boolean;
  topK: number;
  minimumScore: number;
  enableHybridSearch: boolean;
}

interface MemoryStageConfig {
  enabled: boolean;
  sessionMemoryLimit: number;
  enableAutoExtraction: boolean;
  searchLimit: number;
}

interface PromptStageConfig {
  enableDynamicPrompts: boolean;
  defaultTemplateId: string | null;
  enableSkills: boolean;
  activeSkillIds: string[];
  customSkills: Skill[];
}

interface MCPStageConfig {
  enabled: boolean;
  semanticSearchTopK: number;
  enableIntentBoosting: boolean;
  intentBoostLimit: number;
  enableWebToolsInjection: boolean;
  maxToolsPerRequest: number;
  enableTieredFC: boolean;
  /**
   * V2 tool.stage knob — apply pgvector score-gap on the broad-routing
   * path (no specific intent server). Default false: gives the model a
   * wider menu for generic asks like "show me cloud resources". Set
   * true to tighten back up if the model is wasting rounds on
   * irrelevant tools.
   */
  applyScoreGapOnBroadPath?: boolean;
}

interface MessagePreparationStageConfig {
  enableDeduplication: boolean;
  enableToolCallValidation: boolean;
}

interface CompletionStageConfig {
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  defaultThinkingBudget: number;
  enableIntelligentRouting: boolean;
  streamPersistIntervalMs: number;
  tokenUpdateIntervalMs: number;
  enableStreaming: boolean;
  visionCapableModels: string;
}

interface MultiModelStageConfig {
  enabled: boolean;
  sliderThreshold: number;
  configCacheTtlMs: number;
  roles: {
    reasoning: { primaryModel: string; thinkingBudget: number; temperature: number };
    toolExecution: { primaryModel: string; temperature: number };
    synthesis: { primaryModel: string; temperature: number };
    fallback: { primaryModel: string; temperature: number };
  };
  routing: {
    complexityThreshold: number;
    alwaysMultiModelPatterns: string[];
    maxHandoffs: number;
    preferCheaperToolModel: boolean;
  };
}

interface ToolExecutionConfig {
  maxToolCallRounds: number;
  enableToolResultCaching: boolean;
  toolResultCacheTtlHours: number;
  enableCrossUserCaching: boolean;
}

interface ResponseStageConfig {
  enableDeduplication: boolean;
  enableAutoSummary: boolean;
  autoSummaryThreshold: number;
}

interface PipelineConfiguration {
  version: string;
  updatedAt: string;
  updatedBy: string;
  stages: {
    auth: AuthStageConfig;
    validation: ValidationStageConfig;
    rag: RAGStageConfig;
    memory: MemoryStageConfig;
    prompt: PromptStageConfig;
    mcp: MCPStageConfig;
    messagePreparation: MessagePreparationStageConfig;
    completion: CompletionStageConfig;
    multiModel: MultiModelStageConfig;
    toolExecution: ToolExecutionConfig;
    response: ResponseStageConfig;
  };
}

interface AvailableModel {
  id: string;
  displayName: string;
  provider: string;
  thinking: boolean;
  vision: boolean;
  maxContextTokens: number;
}

// Stage metadata with custom icons
type StageId = keyof PipelineConfiguration['stages'];

const STAGES: Array<{
  id: StageId;
  label: string;
  shortLabel: string;
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  description: string;
}> = [
  { id: 'auth', label: 'Authentication', shortLabel: 'Auth', icon: Icons.Shield, color: 'text-primary-500 bg-primary-500/10', description: 'Rate limits and auth behavior' },
  { id: 'validation', label: 'Validation', shortLabel: 'Valid', icon: Icons.CheckCircle, color: 'ap-text-success bg-success-500/10', description: 'Message history and context limits' },
  { id: 'rag', label: 'RAG', shortLabel: 'RAG', icon: Icons.Database, color: 'ap-text-info bg-info-500/10', description: 'Knowledge retrieval settings' },
  { id: 'memory', label: 'Memory', shortLabel: 'Mem', icon: Icons.Brain, color: 'ap-text-info bg-info-500/10', description: 'Session memory settings' },
  { id: 'prompt', label: 'Prompt', shortLabel: 'Prompt', icon: Icons.MessageSquare, color: 'text-info bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]', description: 'Dynamic prompt settings' },
  { id: 'mcp', label: 'MCP Tools', shortLabel: 'MCP', icon: Icons.Wrench, color: 'ap-text-warning bg-warning-500/10', description: 'Tool discovery and limits' },
  { id: 'messagePreparation', label: 'Msg Prep', shortLabel: 'Prep', icon: Icons.Layers, color: 'text-primary-500 bg-primary-500/10', description: 'Deduplication and validation' },
  { id: 'completion', label: 'Completion', shortLabel: 'LLM', icon: Icons.Zap, color: 'ap-text-warning bg-warning-500/10', description: 'Model and streaming settings' },
  { id: 'multiModel', label: 'Multi-Model', shortLabel: 'Multi', icon: Icons.Layers, color: 'text-[color:var(--ap-accent)] bg-[color:var(--ap-accent-soft)]', description: 'Multi-model orchestration' },
  { id: 'toolExecution', label: 'Tool Exec', shortLabel: 'Tools', icon: Icons.Settings, color: 'text-info bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]', description: 'Tool rounds and caching' },
  { id: 'response', label: 'Response', shortLabel: 'Resp', icon: Icons.FileOutput, color: 'text-ok bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)]', description: 'Response processing' },
];

// Extended stage info for visualization tooltips
const STAGE_DETAILS: Record<StageId, { fullDescription: string; examples: string[] }> = {
  auth: {
    fullDescription: 'Validates user authentication, enforces rate limits, and loads user-specific settings like the intelligence slider.',
    examples: ['Rate limiting: 60 req/min', 'Load slider settings', 'JWT validation']
  },
  validation: {
    fullDescription: 'Validates and prepares the incoming message, trims history to fit context limits, and initializes memory services.',
    examples: ['Max 200 history messages', 'Context window: 128K tokens', 'Memory context service']
  },
  rag: {
    fullDescription: 'Retrieves relevant documents from the vector database (Milvus) using semantic search to augment the prompt.',
    examples: ['Top-K: 5 results', 'Min score: 0.7', 'Hybrid search available']
  },
  memory: {
    fullDescription: 'Injects user memories and conversation context from long-term storage to maintain continuity.',
    examples: ['Session memory limit: 50', 'Auto-extraction enabled', 'Semantic search']
  },
  prompt: {
    fullDescription: 'Constructs the system prompt using templates, professional skills, and dynamic prompt injection.',
    examples: ['Dynamic prompts', 'Skills system', 'Template selection']
  },
  mcp: {
    fullDescription: 'Discovers and injects available MCP tools based on semantic matching with the user query.',
    examples: ['Semantic tool search', 'Intent boosting', 'Max 128 tools/request']
  },
  messagePreparation: {
    fullDescription: 'Prepares the final message array, deduplicates content, and validates tool call structures.',
    examples: ['Message deduplication', 'Tool call validation', 'Format normalization']
  },
  completion: {
    fullDescription: 'Sends the prepared messages to the LLM and streams the response back with thinking blocks.',
    examples: ['Model routing', 'Temperature control', 'Thinking budget']
  },
  multiModel: {
    fullDescription: 'Orchestrates multiple models for different roles: reasoning, tool execution, synthesis, and fallback.',
    examples: ['Role-based routing', 'Complexity threshold', 'Max 5 handoffs']
  },
  toolExecution: {
    fullDescription: 'Executes tool calls from the LLM, manages caching, and handles multiple rounds of tool execution.',
    examples: ['Max 15 tool rounds', 'Result caching', 'Cross-user cache']
  },
  response: {
    fullDescription: 'Processes the final response, handles deduplication, and optionally generates auto-summaries.',
    examples: ['Response dedup', 'Auto-summary', 'Message persistence']
  },
};

// ============================================================================
// PIPELINE VISUALIZATION COMPONENT
// ============================================================================

interface PipelineVisualizationProps {
  activeStage: StageId;
  onStageClick: (stage: StageId) => void;
}

const PipelineVisualization: React.FC<PipelineVisualizationProps> = ({ activeStage, onStageClick }) => {
  const [hoveredStage, setHoveredStage] = useState<StageId | null>(null);

  return (
    <div className="relative w-full overflow-x-auto pb-4">
      {/* Pipeline Flow Diagram */}
      <div className="min-w-[900px] p-4">
        {/* Input Arrow */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-accent-primary/20 to-accent-primary/10 border border-primary/30">
            <Icons.MessageSquare size={16} className="text-primary-500" />
            <span className="text-sm font-medium text-primary-500">User Message</span>
          </div>
          <Icons.ArrowRight size={20} className="text-text-secondary" />
        </div>

        {/* Main Pipeline Flow */}
        <div className="relative flex items-center flex-wrap gap-y-4">
          {STAGES.map((stage, index) => {
            const isActive = activeStage === stage.id;
            const isHovered = hoveredStage === stage.id;
            const Icon = stage.icon;
            const details = STAGE_DETAILS[stage.id];

            return (
              <React.Fragment key={stage.id}>
                {/* Stage Node */}
                <div
                  className="relative"
                  onMouseEnter={() => setHoveredStage(stage.id)}
                  onMouseLeave={() => setHoveredStage(null)}
                >
                  <button
                    onClick={() => onStageClick(stage.id)}
                    className={`
                      relative flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200
                      ${isActive
                        ? 'bg-primary-500/20 border-2 border-primary-500 shadow-lg shadow-primary-500/20 scale-105'
                        : 'bg-surface-secondary border border-border hover:border-primary-500/50 hover:bg-surface-hover'
                      }
                      ${isHovered && !isActive ? 'scale-102 shadow-md' : ''}
                    `}
                    style={{ minWidth: '70px' }}
                  >
                    {/* Stage Number Badge */}
                    <div className={`
                      absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                      ${isActive ? 'bg-primary-500 text-on-accent' : 'bg-surface-secondary text-text-secondary border border-border'}
                    `}>
                      {index + 1}
                    </div>

                    {/* Icon */}
                    <div className={`p-1.5 rounded-lg ${stage.color}`}>
                      <Icon size={18} />
                    </div>

                    {/* Label */}
                    <span className={`text-xs font-medium ${isActive ? 'text-primary-500' : 'text-text-secondary'}`}>
                      {stage.shortLabel}
                    </span>
                  </button>

                  {/* Hover Tooltip */}
                  {isHovered && (
                    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-lg bg-surface-primary border border-border shadow-xl">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`p-1 rounded ${stage.color}`}>
                          <Icon size={14} />
                        </div>
                        <span className="font-semibold text-sm text-text-primary">{stage.label}</span>
                      </div>
                      <p className="text-xs text-text-secondary mb-2">{details.fullDescription}</p>
                      <div className="flex flex-wrap gap-1">
                        {details.examples.map((ex, i) => (
                          <span key={i} className="px-1.5 py-0.5 text-xs rounded bg-surface-secondary text-text-secondary">
                            {ex}
                          </span>
                        ))}
                      </div>
                      {/* Tooltip Arrow */}
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-transparent border-t-border" />
                    </div>
                  )}
                </div>

                {/* Arrow between stages */}
                {index < STAGES.length - 1 && (
                  <div className="flex items-center px-1">
                    <div className={`h-0.5 w-3 ${isActive || activeStage === STAGES[index + 1]?.id ? 'bg-primary-500' : 'bg-border'}`} />
                    <Icons.ArrowRight size={14} className={isActive || activeStage === STAGES[index + 1]?.id ? 'text-primary-500' : 'text-text-secondary'} />
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* Output */}
          <div className="flex items-center gap-2 ml-2">
            <Icons.ArrowRight size={20} className="text-text-secondary" />
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-[color-mix(in_srgb,var(--color-ok)_10%,transparent)] to-[color-mix(in_srgb,var(--color-ok)_20%,transparent)] border border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]">
              <Icons.Zap size={16} className="text-ok" />
              <span className="text-sm font-medium text-ok">AI Response</span>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-4 pt-4 border-t border-border flex items-center gap-6 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-primary-500/20 border border-primary-500" />
            Active Stage
          </span>
          <span className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-surface-secondary border border-border" />
            Click to Configure
          </span>
          <span className="flex items-center gap-1.5">
            <Icons.Info size={12} />
            Hover for Details
          </span>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// SKILLS MANAGER COMPONENT - Anthropic Skills Format
// ============================================================================

interface SkillsManagerProps {
  skills: Skill[];
  activeSkillIds: string[];
  onToggleSkill: (id: string) => void;
  onSaveSkill: (skill: Skill) => void;
  onDeleteSkill: (id: string) => void;
}

const SkillsManager: React.FC<SkillsManagerProps> = ({
  skills,
  activeSkillIds,
  onToggleSkill,
  onSaveSkill,
  onDeleteSkill,
}) => {
  const confirm = useConfirm();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<SkillCategory | 'all'>('all');
  const [newSkill, setNewSkill] = useState<Partial<Skill>>({
    name: '',
    emoji: '🔧',
    description: '',
    systemPrompt: '',
    category: 'custom',
    icon: 'Sparkles',
    color: 'ap-text-info bg-info-500/10',
  });

  const handleSave = () => {
    if (!newSkill.name || !newSkill.systemPrompt || !newSkill.description) return;

    const skill: Skill = {
      id: editingId || `custom-${Date.now()}`,
      name: newSkill.name || 'Custom Skill',
      emoji: newSkill.emoji || '🔧',
      description: newSkill.description || 'Custom skill',
      systemPrompt: newSkill.systemPrompt || '',
      category: newSkill.category || 'custom',
      icon: CATEGORY_ICONS[newSkill.category || 'custom'],
      color: CATEGORY_COLORS[newSkill.category || 'custom'],
      isBuiltIn: false,
    };

    onSaveSkill(skill);
    setIsCreating(false);
    setEditingId(null);
    setNewSkill({
      name: '',
      emoji: '🔧',
      description: '',
      systemPrompt: '',
      category: 'custom',
      icon: 'Sparkles',
      color: 'ap-text-info bg-info-500/10',
    });
  };

  // Group skills by category
  const categories: SkillCategory[] = ['development', 'design', 'writing', 'analysis', 'enterprise', 'custom'];
  const filteredSkills = selectedCategory === 'all'
    ? skills
    : skills.filter(s => s.category === selectedCategory);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Icons.Sparkles size={20} className="text-primary-500" />
            Skills (Anthropic Format)
          </h3>
          <p className="text-sm text-text-secondary">
            Professional capabilities that enhance AI responses. Multiple skills can be active simultaneously.
          </p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-500 text-on-accent hover:bg-primary-600 transition-colors"
        >
          <Icons.Plus size={16} />
          New Skill
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            selectedCategory === 'all'
              ? 'bg-primary-500 text-on-accent'
              : 'bg-surface-secondary text-text-secondary hover:text-text-primary'
          }`}
        >
          All ({skills.length})
        </button>
        {categories.map(cat => {
          const count = skills.filter(s => s.category === cat).length;
          if (count === 0) return null;
          const Icon = Icons[CATEGORY_ICONS[cat]];
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 transition-colors ${
                selectedCategory === cat
                  ? 'bg-primary-500 text-on-accent'
                  : 'bg-surface-secondary text-text-secondary hover:text-text-primary'
              }`}
            >
              <Icon size={14} />
              {cat.charAt(0).toUpperCase() + cat.slice(1)} ({count})
            </button>
          );
        })}
      </div>

      {/* Active Skills Summary */}
      {activeSkillIds.length > 0 && (
        <div className="p-4 rounded-lg bg-primary-500/10 border border-primary-500/30">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-primary-400">Active Skills:</span>
            <span className="text-xs text-primary-300">({activeSkillIds.length} enabled)</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {activeSkillIds.map(id => {
              const skill = skills.find(s => s.id === id);
              if (!skill) return null;
              return (
                <span
                  key={id}
                  className="px-2 py-1 rounded-full bg-primary-500/20 text-primary-300 text-xs flex items-center gap-1"
                >
                  {skill.emoji} {skill.name}
                  <button
                    onClick={() => onToggleSkill(id)}
                    className="ml-1 hover:text-on-accent"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Skills Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredSkills.map((skill) => {
          const Icon = Icons[skill.icon] || Icons.Sparkles;
          const isActive = activeSkillIds.includes(skill.id);

          return (
            <div
              key={skill.id}
              role="button"
              tabIndex={0}
              className={`
                relative p-4 rounded-xl border transition-all cursor-pointer
                ${isActive
                  ? 'bg-primary-500/10 border-primary-500 shadow-lg shadow-primary-500/10'
                  : 'bg-surface-secondary border-border hover:border-primary-500/50'
                }
              `}
              onClick={() => onToggleSkill(skill.id)}
              onKeyDown={onKeyActivate(() => onToggleSkill(skill.id))}
            >
              {/* Active Badge */}
              {isActive && (
                <div className="absolute -top-2 -right-2 px-2 py-0.5 rounded-full bg-primary-500 text-on-accent text-xs font-bold">
                  ACTIVE
                </div>
              )}

              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{skill.emoji}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-text-primary truncate">{skill.name}</h4>
                  <p className="text-xs text-text-secondary truncate">{skill.description}</p>
                </div>
              </div>

              {/* Category Badge */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${skill.color}`}>
                  {skill.category}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${skill.isBuiltIn ? 'bg-primary-500/10 text-primary-500' : 'bg-info-500/10 ap-text-info'}`}>
                  {skill.isBuiltIn ? 'Built-in' : 'Custom'}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {!skill.isBuiltIn && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(skill.id);
                        setNewSkill(skill);
                        setIsCreating(true);
                      }}
                      className="p-1.5 rounded-lg hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
                    >
                      <Icons.Edit size={14} />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await confirm('Delete this skill?', { variant: 'danger', title: 'Delete Skill' })) {
                          onDeleteSkill(skill.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-error-500/10 text-text-secondary hover:ap-text-error transition-colors"
                    >
                      <Icons.Trash size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSkill(skill.id);
                  }}
                  className={`ml-auto p-1.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary-500 text-on-accent hover:bg-primary-600'
                      : 'bg-surface-hover text-text-secondary hover:text-primary-500'
                  }`}
                >
                  {isActive ? <Icons.CheckCircle size={14} /> : <Icons.Plus size={14} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create/Edit Modal */}
      {isCreating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-shadow)_50%,transparent)] backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-surface-primary rounded-2xl border border-border shadow-2xl p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              {editingId ? 'Edit Skill' : 'Create New Skill'}
            </h3>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Name (max 64 chars)</label>
                  <input
                    type="text"
                    value={newSkill.name || ''}
                    onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value.slice(0, 64) })}
                    placeholder="e.g., Code Review"
                    maxLength={64}
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Emoji</label>
                  <input
                    type="text"
                    value={newSkill.emoji || ''}
                    onChange={(e) => setNewSkill({ ...newSkill, emoji: e.target.value })}
                    placeholder="🔧"
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm text-text-secondary mb-1">Category</label>
                  <select
                    value={newSkill.category || 'custom'}
                    onChange={(e) => setNewSkill({ ...newSkill, category: e.target.value as SkillCategory })}
                    className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                  >
                    <option value="development">Development</option>
                    <option value="design">Design</option>
                    <option value="writing">Writing</option>
                    <option value="analysis">Analysis</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1">Description (max 200 chars) - When should this skill be used?</label>
                <input
                  type="text"
                  value={newSkill.description || ''}
                  onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value.slice(0, 200) })}
                  placeholder="Brief description of when this skill applies"
                  maxLength={200}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary"
                />
                <p className="text-xs text-text-secondary mt-1">{(newSkill.description || '').length}/200 characters</p>
              </div>

              <div>
                <label className="block text-sm text-text-secondary mb-1">System Prompt (Skill Instructions)</label>
                <textarea
                  value={newSkill.systemPrompt || ''}
                  onChange={(e) => setNewSkill({ ...newSkill, systemPrompt: e.target.value })}
                  placeholder="# Skill Name&#10;&#10;Instructions for how Claude should behave when this skill is active...&#10;&#10;## Guidelines&#10;- Guideline 1&#10;- Guideline 2"
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg bg-surface-secondary border border-border text-text-primary font-mono text-sm"
                />
                <p className="text-xs text-text-secondary mt-1">Use Markdown format. See <a href="https://github.com/anthropics/skills" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:underline">Anthropic Skills</a> for examples.</p>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 rounded-lg bg-surface-secondary text-text-primary hover:bg-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!newSkill.name || !newSkill.systemPrompt || !newSkill.description}
                  className="px-4 py-2 rounded-lg bg-primary-500 text-on-accent hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editingId ? 'Save Changes' : 'Create Skill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const PipelineSettingsView: React.FC = () => {
  const { getAccessToken } = useAuth();
  const confirm = useConfirm();
  const [config, setConfig] = useState<PipelineConfiguration | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<StageId>('toolExecution');
  const [hasChanges, setHasChanges] = useState(false);

  // View mode: 'pipeline' (stage config) or 'skills' (skills manager)
  const [viewMode, setViewMode] = useState<'pipeline' | 'skills'>('pipeline');

  // Skills state
  const [skills, setSkills] = useState<Skill[]>(BUILT_IN_SKILLS);
  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);

  // Memoize all skills (built-in + custom)
  const allSkills = useMemo(() => {
    return [...BUILT_IN_SKILLS, ...skills.filter(s => !s.isBuiltIn)];
  }, [skills]);

  // Skills handlers
  const handleSaveSkill = useCallback((skill: Skill) => {
    setSkills(prev => {
      const existing = prev.findIndex(s => s.id === skill.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = skill;
        return updated;
      }
      return [...prev, skill];
    });
    setHasChanges(true);
  }, []);

  const handleDeleteSkill = useCallback((id: string) => {
    setSkills(prev => prev.filter(s => s.id !== id));
    setActiveSkillIds(prev => prev.filter(skillId => skillId !== id));
    setHasChanges(true);
  }, []);

  const handleToggleSkill = useCallback((id: string) => {
    setActiveSkillIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(skillId => skillId !== id);
      }
      return [...prev, id];
    });
    setHasChanges(true);
  }, []);

  // Fetch configuration
  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch configuration: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        // Load skills state from config
        const promptConfig = data.config?.stages?.prompt;
        if (promptConfig) {
          setActiveSkillIds(promptConfig.activeSkillIds || []);
          if (promptConfig.customSkills?.length > 0) {
            setSkills([...BUILT_IN_SKILLS, ...promptConfig.customSkills]);
          }
        }
      } else {
        throw new Error(data.error || 'Failed to fetch configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load pipeline configuration');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  // Fetch available models dynamically
  const fetchModels = useCallback(async () => {
    setLoadingModels(true);
    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config/models', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.models) {
          setAvailableModels(data.models);
        }
      }
    } catch (err) {
      console.warn('Failed to load models, using text input fallback');
    } finally {
      setLoadingModels(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchConfig();
    fetchModels();
  }, [fetchConfig, fetchModels]);

  // Save configuration
  const saveConfig = async () => {
    if (!config) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Merge skills state into config before saving
      const configToSave = {
        ...config,
        stages: {
          ...config.stages,
          prompt: {
            ...config.stages.prompt,
            enableSkills: activeSkillIds.length > 0,
            activeSkillIds: activeSkillIds,
            customSkills: skills.filter(s => !s.isBuiltIn)
          }
        }
      };

      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(configToSave)
      });

      if (!response.ok) {
        throw new Error(`Failed to save configuration: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        setSuccess('Configuration saved successfully');
        setHasChanges(false);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(data.error || 'Failed to save configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  // Reset to defaults
  const resetToDefaults = async () => {
    if (!await confirm('Are you sure you want to reset all pipeline settings to defaults?', { variant: 'danger', title: 'Reset Settings' })) return;

    setSaving(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const response = await fetch('/api/admin/pipeline-config/reset', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to reset configuration: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.success) {
        setConfig(data.config);
        // Reset skills state to defaults
        setActiveSkillIds([]);
        setSkills(BUILT_IN_SKILLS);
        setSuccess('Configuration reset to defaults');
        setHasChanges(false);
        setTimeout(() => setSuccess(null), 3000);
      } else {
        throw new Error(data.error || 'Failed to reset configuration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reset configuration');
    } finally {
      setSaving(false);
    }
  };

  // Update stage config
  const updateStageConfig = <K extends keyof PipelineConfiguration['stages']>(
    stageName: K,
    field: string,
    value: any
  ) => {
    if (!config) return;

    setConfig(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        stages: {
          ...prev.stages,
          [stageName]: {
            ...prev.stages[stageName],
            [field]: value
          }
        }
      };
    });
    setHasChanges(true);
  };

  // Update nested config (for multiModel.roles)
  const updateNestedConfig = <K extends keyof PipelineConfiguration['stages']>(
    stageName: K,
    path: string[],
    value: any
  ) => {
    if (!config) return;

    setConfig(prev => {
      if (!prev) return prev;
      const stageConfig = { ...prev.stages[stageName] } as any;

      let current = stageConfig;
      for (let i = 0; i < path.length - 1; i++) {
        current[path[i]] = { ...current[path[i]] };
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;

      return {
        ...prev,
        stages: {
          ...prev.stages,
          [stageName]: stageConfig
        }
      };
    });
    setHasChanges(true);
  };

  // Render helpers
  const renderToggle = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: boolean,
    label: string
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <button
        onClick={() => updateStageConfig(stageName, field, !value)}
        className={`p-1 rounded-md transition-colors ${value ? 'ap-text-success' : 'text-text-secondary'}`}
      >
        {value ? <Icons.ToggleRight size={28} /> : <Icons.ToggleLeft size={28} />}
      </button>
    </div>
  );

  const renderNumberInput = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: number,
    label: string,
    min?: number,
    max?: number,
    step?: number
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={(e) => updateStageConfig(stageName, field, parseFloat(e.target.value) || 0)}
        className="w-28 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  const renderTextInput = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: string,
    label: string,
    placeholder?: string
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="text"
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => updateStageConfig(stageName, field, e.target.value)}
        className="w-56 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  const renderModelSelect = (
    stageName: keyof PipelineConfiguration['stages'],
    field: string,
    value: string,
    label: string,
    filterThinking?: boolean
  ) => {
    const models = filterThinking
      ? availableModels.filter(m => m.thinking)
      : availableModels;

    return (
      <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <span className="text-sm text-text-primary">{label}</span>
        {availableModels.length > 0 ? (
          <div className="relative">
            <select
              value={value || ''}
              onChange={(e) => updateStageConfig(stageName, field, e.target.value)}
              className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none pr-8"
            >
              <option value="">Select a model...</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.displayName} ({model.provider})
                </option>
              ))}
            </select>
            <Icons.ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>
        ) : (
          <input
            type="text"
            value={value || ''}
            placeholder="model-id"
            onChange={(e) => updateStageConfig(stageName, field, e.target.value)}
            className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        )}
      </div>
    );
  };

  const renderNestedModelSelect = (
    stageName: keyof PipelineConfiguration['stages'],
    path: string[],
    value: string,
    label: string,
    filterThinking?: boolean
  ) => {
    const models = filterThinking
      ? availableModels.filter(m => m.thinking)
      : availableModels;

    return (
      <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <span className="text-sm text-text-primary">{label}</span>
        {availableModels.length > 0 ? (
          <div className="relative">
            <select
              value={value || ''}
              onChange={(e) => updateNestedConfig(stageName, path, e.target.value)}
              className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none pr-8"
            >
              <option value="">Select a model...</option>
              {models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.displayName} ({model.provider})
                </option>
              ))}
            </select>
            <Icons.ChevronDown size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>
        ) : (
          <input
            type="text"
            value={value || ''}
            placeholder="model-id"
            onChange={(e) => updateNestedConfig(stageName, path, e.target.value)}
            className="w-64 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        )}
      </div>
    );
  };

  const renderNestedNumberInput = (
    stageName: keyof PipelineConfiguration['stages'],
    path: string[],
    value: number,
    label: string,
    min?: number,
    max?: number,
    step?: number
  ) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm text-text-primary">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={(e) => updateNestedConfig(stageName, path, parseFloat(e.target.value) || 0)}
        className="w-28 px-3 py-1.5 text-sm rounded-lg bg-surface-secondary border border-border text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );

  // Render stage content
  const renderStageContent = (stageId: StageId) => {
    if (!config) return null;
    const stageConfig = config.stages[stageId];

    switch (stageId) {
      case 'auth':
        const auth = stageConfig as AuthStageConfig;
        return (
          <div className="space-y-1">
            {renderNumberInput('auth', 'rateLimitPerMinute', auth.rateLimitPerMinute, 'Rate Limit (per minute)', 0, 1000)}
            {renderNumberInput('auth', 'rateLimitPerHour', auth.rateLimitPerHour, 'Rate Limit (per hour)', 0, 10000)}
            {renderToggle('auth', 'allowOnRateLimitFailure', auth.allowOnRateLimitFailure, 'Allow on Rate Limit Failure')}
          </div>
        );

      case 'validation':
        const validation = stageConfig as ValidationStageConfig;
        return (
          <div className="space-y-1">
            {renderNumberInput('validation', 'maxHistory', validation.maxHistory, 'Max History Messages', 1, 1000)}
            {renderToggle('validation', 'enableMemoryContextService', validation.enableMemoryContextService, 'Enable Memory Context Service')}
            {renderNumberInput('validation', 'maxContextTokens', validation.maxContextTokens, 'Max Context Tokens', 1000, 200000)}
          </div>
        );

      case 'rag':
        const rag = stageConfig as RAGStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('rag', 'enabled', rag.enabled, 'Enable RAG')}
            {renderNumberInput('rag', 'topK', rag.topK, 'Top K Results', 1, 50)}
            {renderNumberInput('rag', 'minimumScore', rag.minimumScore, 'Minimum Score', 0, 1, 0.1)}
            {renderToggle('rag', 'enableHybridSearch', rag.enableHybridSearch, 'Enable Hybrid Search')}
          </div>
        );

      case 'memory':
        const memory = stageConfig as MemoryStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('memory', 'enabled', memory.enabled, 'Enable Memory')}
            {renderNumberInput('memory', 'sessionMemoryLimit', memory.sessionMemoryLimit, 'Session Memory Limit', 1, 100)}
            {renderToggle('memory', 'enableAutoExtraction', memory.enableAutoExtraction, 'Enable Auto Extraction')}
            {renderNumberInput('memory', 'searchLimit', memory.searchLimit, 'Search Limit', 1, 100)}
          </div>
        );

      case 'prompt':
        const prompt = stageConfig as PromptStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('prompt', 'enableDynamicPrompts', prompt.enableDynamicPrompts, 'Enable Dynamic Prompts')}
            {renderTextInput('prompt', 'defaultTemplateId', prompt.defaultTemplateId || '', 'Default Template ID', 'template-id')}
            {renderToggle('prompt', 'enableSkills', prompt.enableSkills, 'Enable Skills')}
          </div>
        );

      case 'mcp':
        const mcp = stageConfig as MCPStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('mcp', 'enabled', mcp.enabled, 'Enable MCP')}
            {renderNumberInput('mcp', 'semanticSearchTopK', mcp.semanticSearchTopK, 'Semantic Search Top K', 1, 100)}
            {renderToggle('mcp', 'enableIntentBoosting', mcp.enableIntentBoosting, 'Enable Intent Boosting')}
            {renderNumberInput('mcp', 'intentBoostLimit', mcp.intentBoostLimit, 'Intent Boost Limit', 1, 50)}
            {renderToggle('mcp', 'enableWebToolsInjection', mcp.enableWebToolsInjection, 'Enable Web Tools Injection')}
            {renderNumberInput('mcp', 'maxToolsPerRequest', mcp.maxToolsPerRequest, 'Max Tools Per Request', 1, 128)}
            {renderToggle('mcp', 'enableTieredFC', mcp.enableTieredFC, 'Enable Tiered Function Calling')}
            {renderToggle(
              'mcp',
              'applyScoreGapOnBroadPath',
              mcp.applyScoreGapOnBroadPath ?? false,
              'Apply Score-Gap on Broad Path (tighter top-K)',
            )}
          </div>
        );

      case 'messagePreparation':
        const msgPrep = stageConfig as MessagePreparationStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('messagePreparation', 'enableDeduplication', msgPrep.enableDeduplication, 'Enable Deduplication')}
            {renderToggle('messagePreparation', 'enableToolCallValidation', msgPrep.enableToolCallValidation, 'Enable Tool Call Validation')}
          </div>
        );

      case 'completion':
        const completion = stageConfig as CompletionStageConfig;
        return (
          <div className="space-y-1">
            {renderModelSelect('completion', 'defaultModel', completion.defaultModel, 'Default Model')}
            {renderNumberInput('completion', 'defaultTemperature', completion.defaultTemperature, 'Default Temperature', 0, 2, 0.1)}
            {renderNumberInput('completion', 'defaultMaxTokens', completion.defaultMaxTokens, 'Default Max Tokens', 100, 100000)}
            {renderNumberInput('completion', 'defaultThinkingBudget', completion.defaultThinkingBudget, 'Default Thinking Budget', 0, 100000)}
            {renderToggle('completion', 'enableIntelligentRouting', completion.enableIntelligentRouting, 'Enable Intelligent Routing')}
            {renderNumberInput('completion', 'streamPersistIntervalMs', completion.streamPersistIntervalMs, 'Stream Persist Interval (ms)', 100, 10000)}
            {renderNumberInput('completion', 'tokenUpdateIntervalMs', completion.tokenUpdateIntervalMs, 'Token Update Interval (ms)', 100, 5000)}
            {renderToggle('completion', 'enableStreaming', completion.enableStreaming, 'Enable Streaming')}
            {renderTextInput('completion', 'visionCapableModels', completion.visionCapableModels, 'Vision Capable Models', 'model1,model2')}
          </div>
        );

      case 'multiModel':
        const multiModel = stageConfig as MultiModelStageConfig;
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">General Settings</h4>
              {renderToggle('multiModel', 'enabled', multiModel.enabled, 'Enable Multi-Model')}
              {renderNumberInput('multiModel', 'sliderThreshold', multiModel.sliderThreshold, 'Slider Threshold (%)', 0, 100)}
              {renderNumberInput('multiModel', 'configCacheTtlMs', multiModel.configCacheTtlMs, 'Config Cache TTL (ms)', 1000, 600000)}
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">Role Assignments</h4>
              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Reasoning Role (for complex analysis)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'reasoning', 'primaryModel'], multiModel.roles.reasoning.primaryModel, 'Primary Model', true)}
                {renderNestedNumberInput('multiModel', ['roles', 'reasoning', 'thinkingBudget'], multiModel.roles.reasoning.thinkingBudget, 'Thinking Budget', 0, 100000)}
                {renderNestedNumberInput('multiModel', ['roles', 'reasoning', 'temperature'], multiModel.roles.reasoning.temperature, 'Temperature', 0, 2, 0.1)}
              </div>

              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Tool Execution Role (for tool calls)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'toolExecution', 'primaryModel'], multiModel.roles.toolExecution.primaryModel, 'Primary Model')}
                {renderNestedNumberInput('multiModel', ['roles', 'toolExecution', 'temperature'], multiModel.roles.toolExecution.temperature, 'Temperature', 0, 2, 0.1)}
              </div>

              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Synthesis Role (for final response)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'synthesis', 'primaryModel'], multiModel.roles.synthesis.primaryModel, 'Primary Model')}
                {renderNestedNumberInput('multiModel', ['roles', 'synthesis', 'temperature'], multiModel.roles.synthesis.temperature, 'Temperature', 0, 2, 0.1)}
              </div>

              <div className="bg-surface-secondary/50 rounded-lg p-3 space-y-1">
                <p className="text-xs text-text-secondary mb-2">Fallback Role (when errors occur)</p>
                {renderNestedModelSelect('multiModel', ['roles', 'fallback', 'primaryModel'], multiModel.roles.fallback.primaryModel, 'Primary Model')}
                {renderNestedNumberInput('multiModel', ['roles', 'fallback', 'temperature'], multiModel.roles.fallback.temperature, 'Temperature', 0, 2, 0.1)}
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="text-sm font-medium text-text-primary mb-2">Routing</h4>
              {renderNestedNumberInput('multiModel', ['routing', 'complexityThreshold'], multiModel.routing.complexityThreshold, 'Complexity Threshold', 0, 100)}
              {renderNestedNumberInput('multiModel', ['routing', 'maxHandoffs'], multiModel.routing.maxHandoffs, 'Max Handoffs', 1, 20)}
            </div>
          </div>
        );

      case 'toolExecution':
        const toolExec = stageConfig as ToolExecutionConfig;
        return (
          <div className="space-y-1">
            <div className="py-3 px-4 bg-warning-500/10 rounded-lg mb-3">
              <div className="flex items-center gap-2 ap-text-warning">
                <Icons.Info size={16} />
                <span className="text-xs font-medium">Key Setting</span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                Max Tool Call Rounds controls how many times the LLM can call tools before forcing a final response.
              </p>
            </div>
            {renderNumberInput('toolExecution', 'maxToolCallRounds', toolExec.maxToolCallRounds, 'Max Tool Call Rounds', 1, 50)}
            {renderToggle('toolExecution', 'enableToolResultCaching', toolExec.enableToolResultCaching, 'Enable Tool Result Caching')}
            {renderNumberInput('toolExecution', 'toolResultCacheTtlHours', toolExec.toolResultCacheTtlHours, 'Cache TTL (hours)', 1, 168)}
            {renderToggle('toolExecution', 'enableCrossUserCaching', toolExec.enableCrossUserCaching, 'Enable Cross-User Caching')}
          </div>
        );

      case 'response':
        const response = stageConfig as ResponseStageConfig;
        return (
          <div className="space-y-1">
            {renderToggle('response', 'enableDeduplication', response.enableDeduplication, 'Enable Deduplication')}
            {renderToggle('response', 'enableAutoSummary', response.enableAutoSummary, 'Enable Auto Summary')}
            {renderNumberInput('response', 'autoSummaryThreshold', response.autoSummaryThreshold, 'Auto Summary Threshold', 1, 1000)}
          </div>
        );

      default:
        return <p className="text-text-secondary text-sm">Configuration not available</p>;
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader
          crumbs={['Admin', 'Content', 'Pipeline Settings']}
          title="Pipeline Settings"
          explainer="Configure chat pipeline stages in order of execution (left → right)."
        />
        <div className="flex items-center justify-center h-64">
          <Icons.Loader2 size={32} className="text-primary-500" />
          <span className="ml-3 text-text-secondary">Loading pipeline configuration...</span>
        </div>
      </div>
    );
  }

  const activeStageInfo = STAGES.find(s => s.id === activeStage);

  return (
    <div className="space-y-4">
      <PageHeader
        crumbs={['Admin', 'Content', 'Pipeline Settings']}
        title="Pipeline Settings"
        explainer={
          config
            ? `Configure chat pipeline stages in order of execution (left → right). v${config.version} · Updated ${new Date(config.updatedAt).toLocaleString()} by ${config.updatedBy}`
            : 'Configure chat pipeline stages in order of execution (left → right).'
        }
        actions={[
          { label: 'Refresh', onClick: () => { void fetchConfig(); }, disabled: loading },
          { label: 'Reset', onClick: () => { void resetToDefaults(); }, disabled: saving },
          { label: saving ? 'Saving…' : 'Save', primary: true, onClick: () => { void saveConfig(); }, disabled: saving || !hasChanges },
        ]}
      />

      {/* Status Messages */}
      {error && (
        <div className="p-3 rounded-lg bg-error-500/10 border border-error/20 flex items-center gap-3">
          <Icons.AlertCircle className="ap-text-error" size={18} />
          <span className="ap-text-error text-sm">{error}</span>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-success-500/10 border border-success/20 flex items-center gap-3">
          <Icons.CheckCircle className="ap-text-success" size={18} />
          <span className="ap-text-success text-sm">{success}</span>
        </div>
      )}

      {/* View Mode Toggle */}
      <div className="flex gap-2 p-1 bg-surface-secondary/50 rounded-xl w-fit">
        <button
          onClick={() => setViewMode('pipeline')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'pipeline'
              ? 'bg-primary-500 text-on-accent shadow-md'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <Icons.Layers size={16} />
          Pipeline Stages
        </button>
        <button
          onClick={() => setViewMode('skills')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            viewMode === 'skills'
              ? 'bg-primary-500 text-on-accent shadow-md'
              : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <Icons.Sparkles size={16} />
          Skills
          {activeSkillIds.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-success-500 ap-text-success text-xs font-bold">
              {activeSkillIds.length}
            </span>
          )}
        </button>
      </div>

      {/* Skills Manager View */}
      {viewMode === 'skills' && (
        <div className="glass-card p-6">
          <SkillsManager
            skills={allSkills}
            activeSkillIds={activeSkillIds}
            onToggleSkill={handleToggleSkill}
            onSaveSkill={handleSaveSkill}
            onDeleteSkill={handleDeleteSkill}
          />
        </div>
      )}

      {/* Pipeline View */}
      {viewMode === 'pipeline' && config && (
        <>
          {/* Pipeline Visualization Diagram */}
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Icons.Layers size={16} className="text-primary-500" />
              Chat Pipeline Flow
              <span className="text-xs text-text-secondary font-normal">(click a stage to configure)</span>
            </h3>
            <PipelineVisualization
              activeStage={activeStage}
              onStageClick={setActiveStage}
            />
          </div>
        </>
      )}

      {/* Horizontal Tabs */}
      {viewMode === 'pipeline' && config && (
        <div className="glass-card overflow-hidden">
          {/* Tab Bar */}
          <div className="flex overflow-x-auto border-b border-border bg-surface-secondary/30">
            {STAGES.map((stage, index) => {
              const Icon = stage.icon;
              const isActive = activeStage === stage.id;
              return (
                <button
                  key={stage.id}
                  onClick={() => setActiveStage(stage.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? 'border-primary-500 text-primary-500 bg-primary-500/5'
                      : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                  }`}
                >
                  <div className={`p-1 rounded ${stage.color}`}>
                    <Icon size={14} />
                  </div>
                  <span className="hidden sm:inline">{stage.shortLabel}</span>
                  <span className="text-xs text-text-secondary hidden lg:inline">({index + 1})</span>
                </button>
              );
            })}
          </div>

          {/* Active Stage Content */}
          <div className="p-6">
            {activeStageInfo && (
              <>
                <div className="mb-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className={`p-2 rounded-lg ${activeStageInfo.color}`}>
                      <activeStageInfo.icon size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary">{activeStageInfo.label}</h3>
                      <p className="text-sm text-text-secondary">{activeStageInfo.description}</p>
                    </div>
                  </div>
                </div>
                {renderStageContent(activeStage)}
              </>
            )}
          </div>
        </div>
      )}

      {/* Models Loading Indicator */}
      {loadingModels && (
        <div className="text-xs text-text-secondary flex items-center gap-2">
          <Icons.Loader2 size={12} />
          Loading available models...
        </div>
      )}
    </div>
  );
};

export default PipelineSettingsView;
