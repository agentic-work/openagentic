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