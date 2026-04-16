/**
 * ThinkingIcon - Custom SVG icon for extended thinking mode
 * Unique design: Abstract neural/thought bubbles pattern
 */

import React from 'react';

interface ThinkingIconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean;
}

export const ThinkingIcon: React.FC<ThinkingIconProps> = ({
  size = 24,
  className,
  style,
  'aria-hidden': ariaHidden = true,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden={ariaHidden}
    >
      {/* Main thought cloud */}
      <path
        d="M12 3C8.5 3 5.5 5.5 5 9C3.3 9.5 2 11 2 13C2 15.2 3.8 17 6 17H18C20.2 17 22 15.2 22 13C22 11 20.7 9.5 19 9C18.5 5.5 15.5 3 12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Neural connection dots */}
      <circle cx="8" cy="11" r="1.5" fill="currentColor" opacity="0.8" />
      <circle cx="12" cy="9" r="1.5" fill="currentColor" opacity="0.9" />
      <circle cx="16" cy="11" r="1.5" fill="currentColor" opacity="0.8" />
      <circle cx="10" cy="13" r="1" fill="currentColor" opacity="0.6" />
      <circle cx="14" cy="13" r="1" fill="currentColor" opacity="0.6" />
      {/* Connection lines */}
      <path
        d="M8 11L10 13M12 9L10 13M12 9L14 13M16 11L14 13"
        stroke="currentColor"
        strokeWidth="0.75"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* Small thinking bubbles below */}
      <circle cx="8" cy="19.5" r="1.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <circle cx="5" cy="21" r="1" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );
};

export default ThinkingIcon;
