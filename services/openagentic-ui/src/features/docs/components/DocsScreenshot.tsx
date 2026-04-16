/**
 * DocsScreenshot - Reusable screenshot display component with lightbox.
 *
 * Renders documentation screenshots with rounded corners, subtle border,
 * shadow, optional caption, and click-to-expand lightbox modal.
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ============================================================================
// TYPES
// ============================================================================

interface DocsScreenshotProps {
  src: string;
  alt: string;
  caption?: string;
  maxWidth?: number;
}

// ============================================================================
// COMPONENT
// ============================================================================

const DocsScreenshot: React.FC<DocsScreenshotProps> = ({
  src,
  alt,
  caption,
  maxWidth = 800,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true);
  }, []);

  const handleOpen = useCallback(() => {
    if (!hasError) setIsExpanded(true);
  }, [hasError]);

  const handleClose = useCallback(() => {
    setIsExpanded(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    },
    []
  );

  return (
    <>
      {/* Inline screenshot */}
      <figure
        style={{
          margin: 0,
          maxWidth,
          width: '100%',
        }}
      >
        <div
          style={{
            position: 'relative',
            borderRadius: '12px',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
            background: 'var(--color-surfaceSecondary)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
            cursor: hasError ? 'default' : 'zoom-in',
          }}
          onClick={handleOpen}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleOpen();
          }}
        >
          {/* Loading skeleton */}
          {!isLoaded && (
            <div
              style={{
                width: '100%',
                height: '240px',
                background: 'var(--color-surfaceSecondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  border: '3px solid var(--color-border)',
                  borderTopColor: 'var(--color-primary)',
                  animation: 'docsScreenshotSpin 0.8s linear infinite',
                }}
              />
            </div>
          )}

          {hasError ? (
            <div
              style={{
                width: '100%',
                height: '160px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-textMuted)',
                fontSize: '13px',
              }}
            >
              Image could not be loaded
            </div>
          ) : (
            <img
              src={src}
              alt={alt}
              onLoad={handleLoad}
              onError={handleError}
              style={{
                width: '100%',
                height: 'auto',
                display: isLoaded ? 'block' : 'none',
                borderRadius: '12px',
              }}
            />
          )}
        </div>

        {caption && (
          <figcaption
            style={{
              marginTop: '10px',
              fontSize: '13px',
              color: 'var(--color-textMuted)',
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            {caption}
          </figcaption>
        )}
      </figure>

      {/* Lightbox modal */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="dialog"
            aria-label={`Expanded view: ${alt}`}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0, 0, 0, 0.85)',
              backdropFilter: 'blur(8px)',
              cursor: 'zoom-out',
              padding: '40px',
            }}
          >
            <motion.img
              src={src}
              alt={alt}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              style={{
                maxWidth: '95vw',
                maxHeight: '90vh',
                borderRadius: '8px',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                objectFit: 'contain',
              }}
              onClick={(e) => e.stopPropagation()}
            />

            {/* Close hint */}
            <div
              style={{
                position: 'absolute',
                top: '20px',
                right: '24px',
                fontSize: '13px',
                color: 'rgba(255, 255, 255, 0.6)',
                fontWeight: 500,
              }}
            >
              Click or press Esc to close
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spinner animation */}
      <style>{`
        @keyframes docsScreenshotSpin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export default DocsScreenshot;
