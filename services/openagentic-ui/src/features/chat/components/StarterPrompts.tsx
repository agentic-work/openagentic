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
        {/* Mono tight-tracked display heading (field-guide brand signature). */}
        <h2 className="display text-xl mb-2 text-fg">
          How can I help you today?
        </h2>
        {/* Mono uppercase tracked eyebrow marker. */}
        <p className="eyebrow text-fg-subtle">
          Click a suggestion or type your own message
        </p>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {STARTER_PROMPTS.map((prompt, index) => (
          // Sharp brutalist suggestion card: 2px ink border + sharp corners +
          // hard zero-blur offset shadow (tightens with a 2px press nudge on
          // hover). Accent on hover comes from the brand accent token — no
          // per-prompt raw color literal in the render path.
          <motion.button
            key={prompt.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
            onClick={() => onSelect(prompt)}
            className="group p-4 rounded-none border-2 border-rule-strong bg-surface text-fg shadow-hard-sm text-left transition-all duration-150 hover:border-accent hover:shadow-hard-xs hover:translate-x-[2px] hover:translate-y-[2px]"
          >
            {/* Icon — accent-tinted square chip (sharp corners). */}
            <div className="w-8 h-8 rounded-none border-2 border-rule-strong bg-accent-soft text-accent flex items-center justify-center mb-3 transition-colors">
              {prompt.icon}
            </div>

            {/* Title — mono uppercase tracked label. */}
            <p className="btn-label text-xs line-clamp-2 text-fg">
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
