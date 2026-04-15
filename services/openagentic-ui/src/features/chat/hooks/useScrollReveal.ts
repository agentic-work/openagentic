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

import { useEffect, useRef, useState } from 'react';

export interface ScrollRevealOptions {
  threshold?: number;
  rootMargin?: string;
  triggerOnce?: boolean;
}

/**
 * useScrollReveal Hook
 *
 * Progressive reveal as elements enter viewport
 * Provides smooth, natural feel for long content
 * Reduces overwhelming feeling of large responses
 *
 * @example
 * const { ref, isVisible } = useScrollReveal();
 *
 * <motion.div
 *   ref={ref}
 *   initial={{ opacity: 0, y: 20 }}
 *   animate={isVisible ? { opacity: 1, y: 0 } : {}}
 * >
 *   Content
 * </motion.div>
 */
export const useScrollReveal = <T extends HTMLElement>(
  options: ScrollRevealOptions = {}
) => {
  const {
    threshold = 0.1,
    rootMargin = '0px 0px -50px 0px',
    triggerOnce = true,
  } = options;

  const ref = useRef<T>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (triggerOnce) {
            observer.unobserve(element);
          }
        } else if (!triggerOnce) {
          setIsVisible(false);
        }
      },
      {
        threshold,
        rootMargin,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [threshold, rootMargin, triggerOnce]);

  return { ref, isVisible };
};

/**
 * useStaggeredReveal Hook
 *
 * Reveals multiple child elements with stagger effect
 * Perfect for lists, table rows, code blocks
 *
 * @example
 * const { containerRef, getItemProps } = useStaggeredReveal(items.length);
 *
 * <div ref={containerRef}>
 *   {items.map((item, i) => (
 *     <motion.div key={i} {...getItemProps(i)}>
 *       {item}
 *     </motion.div>
 *   ))}
 * </div>
 */
export const useStaggeredReveal = (
  itemCount: number,
  staggerDelay: number = 0.05
) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Stagger reveal all items
          for (let i = 0; i < itemCount; i++) {
            setTimeout(() => {
              setVisibleItems(prev => new Set(prev).add(i));
            }, i * staggerDelay * 1000);
          }
          observer.unobserve(container);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px',
      }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [itemCount, staggerDelay]);

  const getItemProps = (index: number) => ({
    initial: { opacity: 0, y: 10 },
    animate: visibleItems.has(index)
      ? { opacity: 1, y: 0 }
      : { opacity: 0, y: 10 },
    transition: { duration: 0.3, ease: 'easeOut' },
  });

  return { containerRef, getItemProps, visibleItems };
};
