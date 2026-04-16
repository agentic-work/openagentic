/**
 * OnboardingTour - Lightweight guided discovery for first-time users
 *
 * Shows a 4-step tooltip tour highlighting key features:
 * 1. Chat input area
 * 2. Intelligence Slider (cost/quality tradeoff)
 * 3. MCP Tools toggle
 * 4. Flows tab (visual workflow builder)
 *
 * Checks localStorage for `onboarding_completed` to determine first visit.
 * Uses absolute positioning with a backdrop highlight effect.
 * Auto-dismisses on "Skip" or after completing all steps.
 * */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, MessageSquare, Zap, PuzzleIcon, Workflow } from '@/shared/icons';

const STORAGE_KEY = 'onboarding_completed';
// Legacy keys from removed components — set on completion to prevent any re-trigger
const LEGACY_KEYS = ['ac-welcome-shown', 'ac-onboarding-completed'];

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  /** CSS selector to locate the target element (for highlight positioning) */
  targetSelector: string;
  /** Fallback position if element not found */
  fallbackPosition: { top: string; left: string };
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'chat-input',
    title: 'Chat with AI',
    description:
      'Type your questions or tasks here. The AI will respond with intelligent answers, run tools, and generate content.',
    icon: <MessageSquare size={20} />,
    targetSelector: 'textarea',
    fallbackPosition: { top: '80%', left: '50%' },
  },
  {
    id: 'intelligence-slider',
    title: 'Intelligence Slider',
    description:
      'Adjust the cost/quality tradeoff. Low = fast & economical (Haiku, GPT-4o-mini). High = powerful & precise (Opus, o1).',
    icon: <Zap size={20} />,
    targetSelector: '[data-testid="intelligence-slider"], input[type="range"]',
    fallbackPosition: { top: '85%', left: '30%' },
  },
  {
    id: 'mcp-tools',
    title: 'MCP Tools',
    description:
      'Enable tool augmentation to let the AI search the web, query databases, manage Azure resources, and more.',
    icon: <PuzzleIcon size={20} />,
    targetSelector: '[data-testid="mcp-tools-toggle"], button[title*="MCP"], button[title*="Tool"]',
    fallbackPosition: { top: '85%', left: '15%' },
  },
  {
    id: 'flows-tab',
    title: 'Workflows',
    description:
      'Build visual AI workflows with the Flows tab. Drag-and-drop nodes to create multi-step automations.',
    icon: <Workflow size={20} />,
    targetSelector: 'button[title*="Flows"], button[title*="Flow"]',
    fallbackPosition: { top: '40%', left: '32px' },
  },
];

export const OnboardingTour: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipPosition, setTooltipPosition] = useState<{
    top: number;
    left: number;
    arrowDirection: 'up' | 'down' | 'left' | 'right';
  }>({ top: 0, left: 0, arrowDirection: 'down' });
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Check if onboarding was already completed
  useEffect(() => {
    try {
      const completed = localStorage.getItem(STORAGE_KEY);
      if (!completed) {
        // Delay showing tour to let the UI settle
        const timer = setTimeout(() => setIsVisible(true), 1500);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage unavailable, skip tour
    }
  }, []);

  // Position tooltip near the target element
  const positionTooltip = useCallback(() => {
    const step = TOUR_STEPS[currentStep];
    if (!step) return;

    const targetEl = document.querySelector(step.targetSelector);

    if (targetEl) {
      const rect = targetEl.getBoundingClientRect();
      setHighlightRect(rect);

      const tooltipWidth = 320;
      const tooltipHeight = 180;
      const padding = 16;

      // Determine best position (prefer below, then above, then right)
      let top = rect.bottom + padding;
      let left = rect.left + rect.width / 2 - tooltipWidth / 2;
      let arrowDirection: 'up' | 'down' | 'left' | 'right' = 'up';

      // If tooltip would go below viewport, position above
      if (top + tooltipHeight > window.innerHeight - 20) {
        top = rect.top - tooltipHeight - padding;
        arrowDirection = 'down';
      }

      // If tooltip would go above viewport, position to the right
      if (top < 20) {
        top = rect.top + rect.height / 2 - tooltipHeight / 2;
        left = rect.right + padding;
        arrowDirection = 'left';
      }

      // Clamp horizontal position
      left = Math.max(20, Math.min(left, window.innerWidth - tooltipWidth - 20));
      top = Math.max(20, top);

      setTooltipPosition({ top, left, arrowDirection });
    } else {
      // Use fallback position
      setHighlightRect(null);
      setTooltipPosition({
        top: window.innerHeight * 0.4,
        left: window.innerWidth / 2 - 160,
        arrowDirection: 'up',
      });
    }
  }, [currentStep]);

  useEffect(() => {
    if (isVisible) {
      positionTooltip();
      // Re-position on resize
      window.addEventListener('resize', positionTooltip);
      return () => window.removeEventListener('resize', positionTooltip);
    }
  }, [isVisible, currentStep, positionTooltip]);

  const handleNext = useCallback(() => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  }, [currentStep]);

  const handleComplete = useCallback(() => {
    setIsVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
      // Also set legacy keys so removed modals never re-trigger
      LEGACY_KEYS.forEach(key => localStorage.setItem(key, 'true'));
    } catch {
      // localStorage unavailable
    }
  }, []);

  if (!isVisible) return null;

  const step = TOUR_STEPS[currentStep];

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[9998]"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
            onClick={handleComplete}
          />

          {/* Highlight cutout (if target element found) */}
          {highlightRect && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed z-[9999] rounded-lg"
              style={{
                top: highlightRect.top - 4,
                left: highlightRect.left - 4,
                width: highlightRect.width + 8,
                height: highlightRect.height + 8,
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                border: '2px solid var(--color-primary, #0A84FF)',
                pointerEvents: 'none',
              }}
            />
          )}

          {/* Tooltip card */}
          <motion.div
            ref={tooltipRef}
            key={step.id}
            initial={{ opacity: 0, scale: 0.9, y: tooltipPosition.arrowDirection === 'up' ? -10 : 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed z-[10000]"
            style={{
              top: tooltipPosition.top,
              left: tooltipPosition.left,
              width: 320,
            }}
          >
            <div
              className="rounded-xl p-4 shadow-2xl border"
              style={{
                background: 'var(--color-bg-primary)',
                borderColor: 'var(--color-border)',
              }}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-lg"
                  style={{
                    background: 'var(--color-primary)',
                    color: 'white',
                  }}
                >
                  {step.icon}
                </div>
                <div className="flex-1">
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {step.title}
                  </h3>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Step {currentStep + 1} of {TOUR_STEPS.length}
                  </span>
                </div>
                <button
                  onClick={handleComplete}
                  className="p-1 rounded-md transition-colors hover:bg-[var(--color-bg-secondary)]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Description */}
              <p
                className="text-sm leading-relaxed mb-4"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {step.description}
              </p>

              {/* Progress dots and actions */}
              <div className="flex items-center justify-between">
                {/* Step dots */}
                <div className="flex gap-1.5">
                  {TOUR_STEPS.map((_, idx) => (
                    <div
                      key={idx}
                      className="rounded-full transition-all duration-200"
                      style={{
                        width: idx === currentStep ? 16 : 6,
                        height: 6,
                        backgroundColor:
                          idx === currentStep
                            ? 'var(--color-primary)'
                            : idx < currentStep
                              ? 'var(--color-primary)'
                              : 'var(--color-border)',
                        opacity: idx <= currentStep ? 1 : 0.5,
                      }}
                    />
                  ))}
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleComplete}
                    className="px-3 py-1.5 text-xs rounded-md transition-colors hover:bg-[var(--color-bg-secondary)]"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    Skip
                  </button>
                  <button
                    onClick={handleNext}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: 'white',
                    }}
                  >
                    {currentStep < TOUR_STEPS.length - 1 ? (
                      <>
                        Next
                        <ChevronRight size={12} />
                      </>
                    ) : (
                      'Get Started'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default OnboardingTour;
