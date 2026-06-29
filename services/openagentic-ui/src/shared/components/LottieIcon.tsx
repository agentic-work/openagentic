/**
 * LottieIcon - Animated icon component using lottie-react
 *
 * Renders Lottie animation data at a given size.
 * Supports hover-to-play and auto-loop modes.
 * Used for workflow node icons and admin console icons.
 */

import React, { useRef, useMemo } from 'react';
import Lottie, { LottieRefCurrentProps } from 'lottie-react';
import type { LottieAnimationData } from '../animations/lottieBuilder';

interface LottieIconProps {
  animationData: LottieAnimationData;
  size?: number;
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
  /** If true, only plays on hover */
  hoverPlay?: boolean;
}

export const LottieIcon: React.FC<LottieIconProps> = ({
  animationData,
  size = 24,
  loop = true,
  autoplay = true,
  speed = 1,
  className,
  style,
  hoverPlay = false,
}) => {
  const lottieRef = useRef<LottieRefCurrentProps>(null);

  // Memoize to prevent re-renders from recreating animation data
  const memoizedData = useMemo(() => animationData, [animationData]);

  const handleMouseEnter = () => {
    if (hoverPlay && lottieRef.current) {
      lottieRef.current.play();
    }
  };

  const handleMouseLeave = () => {
    if (hoverPlay && lottieRef.current) {
      lottieRef.current.pause();
    }
  };

  return (
    <div
      role="presentation"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={className}
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <Lottie
        lottieRef={lottieRef}
        animationData={memoizedData}
        loop={loop}
        autoplay={hoverPlay ? false : autoplay}
        style={{ width: size, height: size }}
        rendererSettings={{
          preserveAspectRatio: 'xMidYMid slice',
        }}
      />
    </div>
  );
};

export default LottieIcon;
