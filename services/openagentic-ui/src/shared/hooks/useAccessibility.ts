import { useState, useCallback, useEffect, useRef } from 'react';

export interface AccessibilitySettings {
  reduceMotion: boolean;
  highContrast: boolean;
  largeText: boolean;
  screenReaderOptimized: boolean;
}

export interface AriaOptions {
  label?: string;
  description?: string;
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  live?: 'off' | 'polite' | 'assertive';
}

export interface KeyboardHandlers {
  [key: string]: (event: KeyboardEvent) => void;
}

export const useAccessibility = () => {
  const announcerRef = useRef<HTMLElement | null>(null);
  const focusHistoryRef = useRef<HTMLElement[]>([]);

  // Initialize settings from system preferences and localStorage
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    const saved = typeof window !== 'undefined' 
      ? localStorage.getItem('openagentic-accessibility-settings')
      : null;
    
    if (saved) {
      return JSON.parse(saved);
    }

    // Detect system preferences
    const prefersReducedMotion = typeof window !== 'undefined' 
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    return {
      reduceMotion: prefersReducedMotion,
      highContrast: false,
      largeText: false,
      screenReaderOptimized: false
    };
  });

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: AccessibilitySettings) => {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('openagentic-accessibility-settings', JSON.stringify(newSettings));
    }
  }, []);

  // Toggle reduce motion
  const toggleReduceMotion = useCallback(() => {
    const newSettings = { ...settings, reduceMotion: !settings.reduceMotion };
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Toggle high contrast
  const toggleHighContrast = useCallback(() => {
    const newSettings = { ...settings, highContrast: !settings.highContrast };
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Toggle large text
  const toggleLargeText = useCallback(() => {
    const newSettings = { ...settings, largeText: !settings.largeText };
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Toggle screen reader optimization
  const toggleScreenReaderOptimized = useCallback(() => {
    const newSettings = { ...settings, screenReaderOptimized: !settings.screenReaderOptimized };
    setSettings(newSettings);
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Generate ARIA attributes
  const getAriaProps = useCallback((role?: string, options: AriaOptions = {}) => {
    const props: Record<string, any> = {};

    if (role) {
      props.role = role;
    }

    if (options.label) {
      props['aria-label'] = options.label;
    }

    if (options.description) {
      const descriptionId = `desc-${Math.random().toString(36).substr(2, 9)}`;
      props['aria-describedby'] = descriptionId;
      
      // Create description element if it doesn't exist
      if (typeof window !== 'undefined') {
        setTimeout(() => {
          if (!document.getElementById(descriptionId)) {
            const descElement = document.createElement('div');
            descElement.id = descriptionId;
            descElement.className = 'sr-only';
            descElement.textContent = options.description!;
            document.body.appendChild(descElement);
          }
        });
      }
    }

    if (typeof options.expanded === 'boolean') {
      props['aria-expanded'] = options.expanded;
    }

    if (typeof options.selected === 'boolean') {
      props['aria-selected'] = options.selected;
    }

    if (typeof options.disabled === 'boolean') {
      props['aria-disabled'] = options.disabled;
    }

    if (options.live) {
      props['aria-live'] = options.live;
    }

    return props;
  }, []);

  // Focus management
  const manageFocus = useCallback((element: HTMLElement, options?: { remember?: boolean }) => {
    if (!element) return;

    if (options?.remember) {
      focusHistoryRef.current.push(document.activeElement as HTMLElement);
    }

    element.focus();
  }, []);

  // Return focus to previous element
  const returnFocus = useCallback(() => {
    const lastFocused = focusHistoryRef.current.pop();
    if (lastFocused && lastFocused.focus) {
      lastFocused.focus();
    }
  }, []);

  // Screen reader announcements
  const announceToScreenReader = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (typeof window === 'undefined') return;

    // Remove existing announcer
    if (announcerRef.current) {
      document.body.removeChild(announcerRef.current);
    }

    // Create new announcer
    const announcer = document.createElement('div');
    announcer.setAttribute('aria-live', priority);
    announcer.setAttribute('aria-atomic', 'true');
    announcer.className = 'sr-only';
    announcer.textContent = message;

    document.body.appendChild(announcer);
    announcerRef.current = announcer;

    // Clean up after announcement
    setTimeout(() => {
      if (announcer.parentNode) {
        announcer.parentNode.removeChild(announcer);
      }
      if (announcerRef.current === announcer) {
        announcerRef.current = null;
      }
    }, 1000);
  }, []);

  // Keyboard navigation handler
  const createKeyboardHandler = useCallback((handlers: KeyboardHandlers) => {
    return (event: KeyboardEvent) => {
      const handler = handlers[event.key];
      if (handler) {
        handler(event);
      }
    };
  }, []);

  // Skip to content link
  const createSkipLink = useCallback((targetId: string, label: string = 'Skip to main content') => {
    if (typeof window === 'undefined') return null;

    const skipLink = document.createElement('a');
    skipLink.href = `#${targetId}`;
    skipLink.textContent = label;
    skipLink.className = 'sr-only focus:not-sr-only focus:absolute focus:top-0 focus:left-0 bg-accent text-on-accent p-2 z-50';
    
    skipLink.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(targetId);
      if (target) {
        target.focus();
        target.scrollIntoView();
      }
    });

    return skipLink;
  }, []);

  // Listen for system preference changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    
    const handleChange = (e: MediaQueryListEvent) => {
      setSettings(prev => {
        const newSettings = { ...prev, reduceMotion: e.matches };
        saveSettings(newSettings);
        return newSettings;
      });
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [saveSettings]);

  // Apply accessibility classes to body
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const body = document.body;
    
    // Reduce motion
    if (settings.reduceMotion) {
      body.classList.add('reduce-motion');
    } else {
      body.classList.remove('reduce-motion');
    }

    // High contrast
    if (settings.highContrast) {
      body.classList.add('high-contrast');
    } else {
      body.classList.remove('high-contrast');
    }

    // Large text
    if (settings.largeText) {
      body.classList.add('large-text');
    } else {
      body.classList.remove('large-text');
    }

    // Screen reader optimized
    if (settings.screenReaderOptimized) {
      body.classList.add('screen-reader-optimized');
    } else {
      body.classList.remove('screen-reader-optimized');
    }

    return () => {
      body.classList.remove('reduce-motion', 'high-contrast', 'large-text', 'screen-reader-optimized');
    };
  }, [settings]);

  return {
    settings,
    toggleReduceMotion,
    toggleHighContrast,
    toggleLargeText,
    toggleScreenReaderOptimized,
    getAriaProps,
    manageFocus,
    returnFocus,
    announceToScreenReader,
    createKeyboardHandler,
    createSkipLink
  };
};

export default useAccessibility;