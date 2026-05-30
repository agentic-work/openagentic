/**
 * Scroll to Bottom Button
 * Floats at bottom right of chat and scrolls to latest message when clicked
 * Only shows when user has scrolled up from bottom
 */

import React, { useState, useEffect } from 'react';
import { ChevronDown } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';

interface ScrollToBottomButtonProps {
  containerId?: string;
}

export const ScrollToBottomButton: React.FC<ScrollToBottomButtonProps> = ({
  containerId = 'chat-messages-container',
}) => {
  const [showButton, setShowButton] = useState(false);

  // Check if user is scrolled away from bottom
  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);

      // Show button if more than 100px from bottom
      setShowButton(distanceFromBottom > 100);
    };

    container.addEventListener('scroll', handleScroll);

    // Initial check
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerId]);

  const scrollToBottom = () => {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: 'smooth'
    });
  };

  return (
    <AnimatePresence>
      {showButton && (
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          onClick={scrollToBottom}
          className="
            fixed bottom-24 right-8 z-50
            w-12 h-12 rounded-full
            flex items-center justify-center
            shadow-lg hover:shadow-xl
            transition-all duration-150 ease-out
            hover:scale-110 active:scale-95
            bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-500 text-white
          "
          aria-label="Scroll to bottom"
          title="Jump to bottom"
        >
          <ChevronDown size={24} />
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default ScrollToBottomButton;
