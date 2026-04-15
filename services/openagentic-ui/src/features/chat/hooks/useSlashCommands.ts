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
 * useSlashCommands - Slash command parsing and handling
 * Provides self-documenting AI via /help and related commands
 */

import { useState, useCallback, useMemo } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface SlashCommand {
  command: string;
  description: string;
  showInAutocomplete: boolean;
}

export interface SlashCommandsReturn {
  commands: SlashCommand[];
  matchingCommands: SlashCommand[];
  isSlashCommand: (input: string) => boolean;
  getMatchingCommands: (input: string) => SlashCommand[];
  executeCommand: (command: string, handlers: CommandHandlers) => boolean;
  helpResponse: string;
}

export interface CommandHandlers {
  sendSystemMessage?: (message: string) => void;
  clearMessages?: () => void;
  createNewSession?: () => void;
  openFeedbackModal?: () => void;
  toggleKeyboardShortcuts?: () => void;
  generateCapabilitiesMessage?: () => string;
  openHITLPanel?: () => void;
}

// ============================================================================
// /help Response Content
// ============================================================================

export const HELP_RESPONSE = `# Welcome to OpenAgentic!

I'm your AI assistant with access to powerful enterprise tools. Here's what I can help you with:

## Cloud Operations
- **Azure**: Manage resources, VMs, resource groups, ARM deployments
- **AWS**: EC2, S3, Lambda, cost analysis, CloudWatch logs
- **GCP**: Compute, Storage, BigQuery, Vertex AI
- **Kubernetes**: Pod management, deployments, logs, cluster health

**Try:** "Show me all my Azure VMs and their costs"

## Business Intelligence
- Pull real data from your cloud accounts
- Generate cost reports and trend analysis
- Identify optimization opportunities
- Create dashboards and visualizations

**Try:** "Analyze my Azure costs for the last 3 months"

## Workflow Automation
- Build visual workflows with the native flow builder
- Chain API calls with conditional logic
- Set up monitoring and alerts
- Automate recurring tasks

**Try:** "Help me create a workflow that monitors costs"

## Code & Development
Switch to **Code Mode** (tab above) for:
- Full application development with AI
- Live code execution in sandboxed environment
- Debugging with real-time tool execution
- Git operations and file management

**Try:** "Build a Python script to analyze my logs"

## Show Me What You Got
- See all platform capabilities in action
- Generate data visualizations (Sankey diagrams, charts)
- Watch MCP tools working together in real-time
- Understand how the AI orchestrates complex tasks

**Try:** "Create a Sankey diagram of my Azure resources and explain the MCPs you use"

---

## Quick Commands
- \`/help\` - Show this message
- \`/capabilities\` - List available tools
- \`/clear\` - Clear chat history
- \`/new\` - Start a new session
- \`/shortcuts\` - Keyboard shortcuts
- \`/hitl\` - Human-in-the-Loop approval log & mode

## Tips
- **Intelligence Slider** (left panel): Slide right for smarter responses, left for faster/cheaper
- **MCP Tools** (toolbar): Click the wrench icon to see available integrations
- **Code Mode** (tab): For building applications with live execution

Just describe what you want to accomplish - I'll figure out the best approach!`;

// ============================================================================
// Available Commands
// ============================================================================

const COMMANDS: SlashCommand[] = [
  {
    command: '/help',
    description: 'Show what I can do',
    showInAutocomplete: true,
  },
  {
    command: '/capabilities',
    description: 'List available MCP tools',
    showInAutocomplete: true,
  },
  {
    command: '/clear',
    description: 'Clear chat history',
    showInAutocomplete: true,
  },
  {
    command: '/new',
    description: 'Start a new chat session',
    showInAutocomplete: true,
  },
  {
    command: '/feedback',
    description: 'Send feedback to the team',
    showInAutocomplete: true,
  },
  {
    command: '/shortcuts',
    description: 'Show keyboard shortcuts',
    showInAutocomplete: true,
  },
  {
    command: '/hitl',
    description: 'Human-in-the-Loop: view approval log & mode',
    showInAutocomplete: true,
  },
];

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSlashCommands(): SlashCommandsReturn {
  const [inputValue, setInputValue] = useState('');

  const isSlashCommand = useCallback((input: string): boolean => {
    const trimmed = input.trim();
    return trimmed.startsWith('/') && !trimmed.includes(' ');
  }, []);

  const getMatchingCommands = useCallback((input: string): SlashCommand[] => {
    const trimmed = input.trim().toLowerCase();
    if (!trimmed.startsWith('/')) return [];

    return COMMANDS.filter(
      cmd => cmd.showInAutocomplete && cmd.command.toLowerCase().startsWith(trimmed)
    );
  }, []);

  const matchingCommands = useMemo(() => {
    return getMatchingCommands(inputValue);
  }, [inputValue, getMatchingCommands]);

  const executeCommand = useCallback((
    command: string,
    handlers: CommandHandlers
  ): boolean => {
    const trimmed = command.trim().toLowerCase();
    const cmd = COMMANDS.find(c => c.command === trimmed);

    if (!cmd) return false;

    switch (trimmed) {
      case '/help':
        handlers.sendSystemMessage?.(HELP_RESPONSE);
        return true;

      case '/capabilities':
        const capsMessage = handlers.generateCapabilitiesMessage?.() ||
          'Use the MCP Tools panel on the left to see available integrations.';
        handlers.sendSystemMessage?.(capsMessage);
        return true;

      case '/clear':
        handlers.clearMessages?.();
        return true;

      case '/new':
        handlers.createNewSession?.();
        return true;

      case '/feedback':
        handlers.openFeedbackModal?.();
        return true;

      case '/shortcuts':
        handlers.toggleKeyboardShortcuts?.();
        return true;

      case '/hitl':
        handlers.openHITLPanel?.();
        return true;

      default:
        return false;
    }
  }, []);

  return {
    commands: COMMANDS,
    matchingCommands,
    isSlashCommand,
    getMatchingCommands,
    executeCommand,
    helpResponse: HELP_RESPONSE,
  };
}

export default useSlashCommands;
