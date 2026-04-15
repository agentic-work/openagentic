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
 * StarterPrompts - Clickable example prompts for empty chat state
 * Eliminates "blank chat paralysis" by giving users quick actions
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  Cloud,
  BarChart3,
  Search,
  Code2,
  FileText,
  Lightbulb,
  HelpCircle,
  Server,
} from '@/shared/icons';

interface StarterPrompt {
  id: string;
  icon: React.ReactNode;
  title: string;
  prompt: string;
  category: 'cloud' | 'code' | 'data' | 'general';
  accentColor: string;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  // Cloud Operations
  {
    id: 'azure-resources',
    icon: <Cloud className="w-5 h-5" />,
    title: 'List my Azure resources',
    prompt: 'Show me all my Azure resources grouped by resource group with their current status and estimated monthly cost',
    category: 'cloud',
    accentColor: '#3b82f6',
  },
  {
    id: 'k8s-pods',
    icon: <Server className="w-5 h-5" />,
    title: 'Check Kubernetes health',
    prompt: 'Show me all pods across my Kubernetes clusters, highlight any that are failing or restarting frequently',
    category: 'cloud',
    accentColor: '#06b6d4',
  },

  // Data & Analysis
  {
    id: 'cost-analysis',
    icon: <BarChart3 className="w-5 h-5" />,
    title: 'Analyze cloud costs',
    prompt: 'Analyze my cloud spending for the last 30 days. Show me the top 5 cost drivers and suggest ways to optimize',
    category: 'data',
    accentColor: '#00D26A',
  },
  {
    id: 'web-research',
    icon: <Search className="w-5 h-5" />,
    title: 'Research a topic',
    prompt: 'Search the web for the latest best practices on [your topic] and summarize the key findings',
    category: 'data',
    accentColor: '#8b5cf6',
  },

  // Code & Development
  {
    id: 'debug-error',
    icon: <Code2 className="w-5 h-5" />,
    title: 'Debug an error',
    prompt: 'Help me debug this error:\n\n[paste your error here]',
    category: 'code',
    accentColor: '#ef4444',
  },
  {
    id: 'write-script',
    icon: <FileText className="w-5 h-5" />,
    title: 'Write a script',
    prompt: 'Write a Python script that [describe what you need]',
    category: 'code',
    accentColor: '#f59e0b',
  },

  // General
  {
    id: 'capabilities',
    icon: <Lightbulb className="w-5 h-5" />,
    title: 'What can you do?',
    prompt: 'What can you help me with? Show me your capabilities and the tools available.',
    category: 'general',
    accentColor: '#ec4899',
  },
  {
    id: 'help',
    icon: <HelpCircle className="w-5 h-5" />,
    title: 'Get help',
    prompt: '/help',
    category: 'general',
    accentColor: '#6366f1',
  },
];

interface StarterPromptsProps {
  onSelect: (prompt: StarterPrompt) => void;
  className?: string;
}

export const StarterPrompts: React.FC<StarterPromptsProps> = ({
  onSelect,
  className = '',
}) => {
  return (
    <div className={`w-full max-w-2xl mx-auto ${className}`}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="text-center mb-8"
      >
        <h2
          className="text-xl font-medium mb-2"
          style={{ color: 'var(--color-text)' }}
        >
          How can I help you today?
        </h2>
        <p
          className="text-sm"
          style={{ color: 'var(--color-textMuted)' }}
        >
          Click a suggestion or type your own message
        </p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STARTER_PROMPTS.map((prompt, index) => (
          <motion.button
            key={prompt.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            onClick={() => onSelect(prompt)}
            className="group p-4 rounded-xl text-left transition-all duration-200 hover:scale-[1.02]"
            style={{
              backgroundColor: 'var(--color-surfaceSecondary)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = prompt.accentColor;
              e.currentTarget.style.backgroundColor = `${prompt.accentColor}10`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-border)';
              e.currentTarget.style.backgroundColor = 'var(--color-surfaceSecondary)';
            }}
          >
            {/* Icon */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mb-3 transition-colors"
              style={{
                backgroundColor: `${prompt.accentColor}20`,
                color: prompt.accentColor,
              }}
            >
              {prompt.icon}
            </div>

            {/* Title */}
            <p
              className="text-sm font-medium line-clamp-2"
              style={{ color: 'var(--color-text)' }}
            >
              {prompt.title}
            </p>
          </motion.button>
        ))}
      </div>
    </div>
  );
};

// Export the prompt type for use elsewhere
export type { StarterPrompt };
export { STARTER_PROMPTS };

export default StarterPrompts;
