/**
 * ChatContainer types
 * Prop/state/local interfaces extracted verbatim from ChatContainer.tsx so the
 * container body stays focused on behavior. Pure type declarations — no runtime
 * code, no behavior change. Import sites in ChatContainer.tsx are unchanged.
 */

// App mode type.
export type AppMode = 'chat' | 'flows' | 'codemode';

// Personality type for AI response styling
export interface Personality {
  id: string;
  name: string;
  emoji: string;
  description: string;
  systemPrompt: string;
  isBuiltIn: boolean;
}

// Additional type interfaces to replace 'any' types
export interface MCPFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface MCPToolsResponse {
  tools: {
    functions: MCPFunction[];
  };
}

export interface SessionApiResponse {
  sessions: Array<{
    id: string;
    userId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messageCount?: number;
    messages?: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      timestamp: string;
    }>;
  }>;
  lastActiveSessionId?: string;
}

export interface UsageDataPoint {
  date: string;
  tokens: number;
  cost: number;
}

export interface ImageAnalysisResult {
  text?: string;
  description?: string;
  objects?: Array<{
    name: string;
    confidence: number;
  }>;
  tags?: string[];
}

export interface FileWithPreview extends File {
  previewUrl?: string;
}

export interface ChatProps {
  // `theme` prop removed: the parent no longer feeds a JS color palette. The
  // app theme is the CSS SOT (theme.css flips every --color-* off [data-theme]);
  // Chat reads settings.theme (a 'light' | 'dark' string) internally and the
  // CSS vars do the rest. onThemeChange persists the user's light/dark choice.
  onThemeChange?: (theme: 'light' | 'dark') => void;
  onFunctionsReady?: (functions: {
    createNewSession: () => void;
    toggleMetrics: () => void;
    openMonitor: () => void;
    toggleSidebar: () => void;
  }) => void;
  showMetricsPanel?: boolean;
}
