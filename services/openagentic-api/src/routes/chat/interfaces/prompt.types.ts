/**
 * Prompt engineering and template types
 */

export interface PromptTemplate {
  id: number;
  name: string;
  description?: string;
  content: string;
  category: string;
  tags: string[];
  isPublic: boolean;
  isDefault: boolean;
  isActive: boolean;
  modelPreferences?: ModelPreferences;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelPreferences {
  preferredModels?: string[];
  intentKeywords?: string[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
}

export interface PromptAssignment {
  id: number;
  userId: string;
  promptTemplateId?: number;
  groupId?: string;
  customPrompt?: string;
  assignedBy: string;
  assignedAt: Date;
  updatedAt: Date;
  isActive: boolean;
  priority: number;
}

export interface PromptContext {
  userId: string;
  userGroups?: string[];
  message?: string;
  sessionHistory?: any[];
  metadata?: Record<string, any>;
}

export interface PromptSelection {
  template?: PromptTemplate;
  content: string;
  recommendedModel?: string;
  confidence: number;
  source: 'user_assignment' | 'group_assignment' | 'global_assignment' | 'intelligent_routing' | 'default';
}

// Prompting Techniques Configuration
export interface PromptingTechniques {
  fewShot: FewShotConfig;
  react: ReActConfig;
  selfConsistency: SelfConsistencyConfig;
  rag: RAGConfig;
  directives: DirectivesConfig;
}

export interface FewShotConfig {
  enabled: boolean;
  maxExamples: number;
  includeExplanations: boolean;
  exampleFormat: 'conversation' | 'markdown' | 'numbered';
  examples?: FewShotExample[];
}

export interface FewShotExample {
  id: string;
  input: string;
  output: string;
  explanation?: string;
  category?: string;
  relevanceScore?: number;
}

export interface ReActConfig {
  enabled: boolean;
  showSteps: boolean;
  includeReflections: boolean;
  maxIterations?: number;
  stepFormats?: {
    thought: string;
    action: string;
    observation: string;
    reflection: string;
  };
}

export interface SelfConsistencyConfig {
  enabled: boolean;
  samples: number;
  temperature: number;
  threshold: number;
  showAlternatives: boolean;
  criticalOnly: boolean;
  criticalKeywords?: string[];
}

export interface RAGConfig {
  enabled: boolean;
  similarityThreshold: number;
  topK: number;
  hybridSearch: boolean;
  embeddingModel?: string;
  vectorStore?: string;
}

export interface DirectivesConfig {
  style: 'concise' | 'detailed' | 'technical' | 'conversational' | 'balanced';
  includeExamples: boolean;
  includeReferences: boolean;
  customDirectives: string[];
}

// Prompt Engineering Results
export interface PromptEngineeringResult {
  systemPrompt: string;
  techniques: AppliedTechnique[];
  examples?: FewShotExample[];
  appliedTechniques?: string[];
  messageModifications?: PromptModification[];
  systemPromptAdditions?: string[];
  tokensAdded?: number;
  metadata: {
    selectionReason: string;
    confidence: number;
    processingTime: number;
    cacheHit: boolean;
  };
}

export interface PromptModification {
  type: 'prepend' | 'append' | 'replace';
  content: string;
  technique?: string;
}

export interface PromptTechnique {
  id: string;
  name: string;
  description: string;
  category: 'reasoning' | 'formatting' | 'context' | 'behavior';
  enabled: boolean;
  configuration?: {
    instruction?: string;
    placement?: 'system_prompt' | 'before_content' | 'after_content';
    parameters?: Record<string, any>;
    examples?: FewShotExample[];
  };
  priority?: number;
}

export interface UserPromptAssignment {
  id: string;
  userId: string;
  promptTemplateId: string;
  promptTemplate?: PromptTemplate;
  assignedBy: string;
  assignedAt: Date;
  isActive: boolean;
  customizations?: Record<string, any>;
}

export interface AppliedTechnique {
  name: string;
  enabled: boolean;
  config: any;
  result?: any;
}

// Few-shot example matching
export interface ExampleMatchResult {
  example: FewShotExample;
  similarity: number;
  reason: string;
}

// RAG results
export interface RAGResult {
  documents: RAGDocument[];
  query: string;
  totalResults: number;
  processingTime: number;
}

export interface RAGDocument {
  id: string;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
  source: string;
}