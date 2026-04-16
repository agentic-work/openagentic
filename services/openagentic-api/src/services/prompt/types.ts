export type ModuleCategory = 'core' | 'domain' | 'mode' | 'capability';
export type AdapterFamily = 'claude' | 'gemini' | 'openai' | 'local';
export type ContextMode = 'chat' | 'code' | 'flow';

/**
 * Explicit user-intent signals derived from the request message.
 *
 * Intents are an additional injection gate so that modules whose content
 * only makes sense for a specific kind of ask (e.g. artifact / visualization
 * guidance) can be conditionally included. Without this gate, modules ride
 * along on every request and bias the model toward unwanted output shapes —
 * see openagentic-omhs#327 for the cost/artifact-injection regression that
 * prompted introducing this.
 */
export type UserIntent = 'visualization';

export interface ModuleInjectionRules {
  alwaysInject?: boolean;
  requiresTools?: string[];        // Glob patterns: "azure_*"
  requiresCapabilities?: string[];
  requiresMode?: ContextMode[];
  semanticMatch?: boolean;
  /**
   * If set, the module is only injected when the request's evaluated user
   * intent matches one of these values. Combined AND with other gates.
   */
  requiresUserIntent?: UserIntent[];
  /**
   * Inverse of `requiresUserIntent` — the module is injected only when
   * the request's intent does NOT match any of these values. Used for
   * "inhibitor" modules that should fire only when a particular intent
   * is absent (e.g. tell the model "don't create unsolicited artifacts"
   * when the user hasn't asked for one). Combined AND with other gates.
   */
  excludesUserIntent?: UserIntent[];
}

export interface PromptModule {
  id: string;
  name: string;
  category: ModuleCategory;
  content: string;
  description: string;
  priority: number;
  tokenCost: number;
  enabled: boolean;
  injection: ModuleInjectionRules;
  variants?: Partial<Record<AdapterFamily, string>>;
  version: number;
}

export interface ModelCapabilities {
  thinking: boolean;
  tools: boolean;
  vision: boolean;
  longContext: boolean;
  audio: boolean;
  video: boolean;
  documents: boolean;
  streaming: boolean;
  imageGen: boolean;
  audioGen: boolean;
  videoGen: boolean;
  embedding: boolean;
  codeExecution: boolean;
  grounding: boolean;
}

export interface ComposeContext {
  message: string;
  mode: ContextMode;
  model: string;
  availableTools: any[];
  structuredSummary?: any;  // StructuredSummary from ContextManagerService
  userId: string;
  sessionId: string;
  sliderPosition?: number;
  isAdmin?: boolean;  // Caller can pass this to avoid DB lookup; defaults to DB check
  // Agent-specific: when set, PromptComposer uses these modules instead of auto-selecting domain modules
  agentRole?: string;        // e.g. "reasoning", "data_query"
  agentModules?: string[];   // Explicit module names from agent DB config
  modelFamily?: string;      // Override model family (openai, claude, gemini, local)
  /**
   * Pre-evaluated user intent. If omitted, PromptComposer evaluates from the
   * message via ArtifactIntentGate. Tests / agent paths can pass this directly
   * to skip the gate.
   */
  userIntent?: UserIntent | null;
}

export interface ComposedPrompt {
  systemPrompt: string;
  modulesUsed: string[];
  tokenCount: number;
  budgetUsed: number;
  budgetRemaining: number;
  modelFamily: AdapterFamily;
  capabilitiesDetected: string[];
}

export interface ModuleScore {
  module: PromptModule;
  score: number;
  breakdown: {
    semantic: number;
    toolRule: number;
    historyBoost: number;
    effectiveness: number;
  };
}
