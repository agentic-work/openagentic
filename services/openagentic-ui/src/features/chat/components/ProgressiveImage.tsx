import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ProgressiveImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholderSrc?: string;
  blurAmount?: number;
}

/**
 * ProgressiveImage Component
 *
 * Progressive blur-up image loading inspired by Medium
 * Provides smooth, professional image loading experience
 *
 * Features:
 * - Blurred placeholder while loading
 * - Smooth fade-in when loaded
 * - Automatic blur removal
 * - Error state handling
 *
 * @example
 * <ProgressiveImage
 *   src="/high-res-image.jpg"
 *   alt="Description"
 *   placeholderSrc="/low-res-image.jpg"
 * />
 */
export const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  src,
  alt,
  className = '',
  placeholderSrc,
  blurAmount = 20,
}) => {
  const [imgSrc, setImgSrc] = useState(placeholderSrc || src);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // Create a new image to preload the full resolution
    const img = new Image();

    img.onload = () => {
      setImgSrc(src);
      setIsLoading(false);
    };

    img.onerror = () => {
      setHasError(true);
      setIsLoading(false);
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-bg-tertiary rounded ${className}`}
        style={{ minHeight: '200px' }}
      >
        <div className="text-center text-text-tertiary">
          <p className="text-sm">Failed to load image</p>
          <p className="text-xs mt-1">{alt}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <AnimatePresence mode="wait">
        <motion.img
          key={imgSrc}
          src={imgSrc}
          alt={alt}
          className="w-full h-full object-cover"
          style={{
            filter: isLoading ? `blur(${blurAmount}px)` : 'blur(0px)',
            transition: 'filter 0.3s ease-out',
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        />
      </AnimatePresence>

      {/* Loading overlay with shimmer */}
      {isLoading && (
        <motion.div
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          initial={{ x: '-100%' }}
          animate={{ x: '100%' }}
          transition={{
            repeat: Infinity,
            duration: 1.5,
            ease: 'linear',
          }}
        />
      )}
    </div>
  );
};

export default ProgressiveImage;
