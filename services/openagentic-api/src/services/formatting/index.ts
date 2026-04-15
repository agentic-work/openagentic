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
 * Formatting Capabilities Service - Public API
 *
 * Exports all formatting-related functionality for use across the application
 */

// Core service
export { FormattingCapabilitiesService, getFormattingCapabilitiesService } from './FormattingCapabilitiesService.js';

// Type definitions
export type {
  FormattingCapability,
  FormattingPreset,
  FormattingGuidance,
  ValidationResult,
  ValidationError,
  Enhancement,
  AntiPattern,
  CapabilityCategory
} from './types.js';

// Data exports
export { FORMATTING_CAPABILITIES, CAPABILITY_CATEGORIES, LANGUAGE_SUPPORT } from './capabilities.js';
export { FORMATTING_PRESETS } from './presets.js';
export { validateMarkdown, detectAntiPatterns } from './validators.js';
