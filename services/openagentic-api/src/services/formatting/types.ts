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
 * Type Definitions for Formatting Capabilities Service
 */

export interface FormattingCapability {
  id: string;
  name: string;
  category: 'markdown' | 'math' | 'code' | 'diagram' | 'chart' | 'visual' | 'structure' | 'interactive';
  syntax: string | string[];
  example: string;
  output?: string;
  engine?: 'markdown' | 'katex' | 'prism' | 'reactflow' | 'native' | 'iframe-sandbox' | 'babel-iframe';
  supportLevel: 'full' | 'partial' | 'experimental';
  usageRules: string[];
  antiPatterns?: string[];
  requiresBlock?: boolean;
  minVersion?: string;
}

export interface FormattingPreset {
  id: string;
  name: string;
  description: string;
  capabilityIds: string[];
  template: string;
  triggers: string[];
  examples: Array<{
    input: string;
    output: string;
  }>;
}

export interface FormattingGuidance {
  recommendedCapabilities: string[];
  discouragedCapabilities: string[];
  preset?: FormattingPreset;
  tips: string[];
  warnings?: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  suggestions: Enhancement[];
  usedCapabilities: string[];
  antiPatternsDetected: AntiPattern[];
}

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
  capability?: string;
}

export interface Enhancement {
  original: string;
  suggested: string;
  reason: string;
  capability: string;
}

export interface AntiPattern {
  pattern: string;
  found: string;
  suggestion: string;
  severity: 'high' | 'medium' | 'low';
}

export interface CapabilityCategory {
  id: string;
  name: string;
  description: string;
}
