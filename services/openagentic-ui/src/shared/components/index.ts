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
 * Shared Components Index
 * Export all shared UI components
 */

// Background components
export { default as MinimalBackground } from './MinimalBackground';
export { default as CSSBackground } from './CSSBackground';
export { default as WebGLBackground } from './WebGLBackground';

// Core components
export { ArtifactErrorBoundary } from './ArtifactErrorBoundary';
export { default as CanvasPanel } from './CanvasPanel';
export { default as ErrorBoundary } from './ErrorBoundary';
export { default as NotFound } from './NotFound';
export { default as RippleButton } from './RippleButton';
export { default as SkeletonLoader } from './SkeletonLoader';
export { default as SSEErrorBoundary } from './SSEErrorBoundary';

// Re-export ImageAnalysis from chat components for build compatibility
export { default as ImageAnalysis } from './ImageAnalysis';

// Panel components
export { default as SlideInPanel } from './SlideInPanel';
export {
  SlideInPanelFooter,
  SlideInPanelSection,
  SlideInPanelField,
  PANEL_CONFIG,
} from './SlideInPanel';
export type { SlideInPanelProps, PanelWidth } from './SlideInPanel';

// Modal components
export { default as BaseModal } from './BaseModal';
export { ConfirmModal, MODAL_CONFIG } from './BaseModal';
export type { BaseModalProps, ConfirmModalProps, ModalSize } from './BaseModal';

// Thinking block component - unified for chat and code modes
export { default as CollapsedThinkingBlock } from './CollapsedThinkingBlock';
export { CollapsedThinkingBlock as UnifiedThinkingBlock } from './CollapsedThinkingBlock';

// Lottie icon component
export { LottieIcon } from './LottieIcon';