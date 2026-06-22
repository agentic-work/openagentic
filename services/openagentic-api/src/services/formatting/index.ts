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
