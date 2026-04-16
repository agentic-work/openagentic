/**
 * Performance Monitoring Hook
 * Tracks component re-renders and warns about excessive re-rendering
 */

import { useEffect, useRef } from 'react';

export const usePerformanceMonitoring = (componentName: string = 'Component', warnThreshold: number = 10) => {
  const renderCount = useRef(0);
  const lastWarnTime = useRef(0);

  useEffect(() => {
    renderCount.current += 1;

    // Warn about excessive re-renders, but not more than once per 5 seconds
    const now = Date.now();
    if (
      renderCount.current > 0 &&
      renderCount.current % warnThreshold === 0 &&
      now - lastWarnTime.current > 5000
    ) {
      // Performance warning disabled for production
      // console.warn(
      //   `[Performance] ${componentName} has re-rendered ${renderCount.current} times. Consider optimization.`,
      //   {
      //     renderCount: renderCount.current,
      //     component: componentName,
      //     timestamp: new Date().toISOString()
      //   }
      // );
      lastWarnTime.current = now;
    }
  });

  return renderCount.current;
};

export const useRenderCounter = (componentName?: string) => {
  return usePerformanceMonitoring(componentName || 'Unknown Component');
};