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

/**
 * Icon Factory
 * Creates consistent icon components with standard props
 */

import React, { forwardRef } from 'react';
import { IconProps } from './types';

export function createIcon(
  displayName: string,
  path: React.ReactNode
): React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>> {
  const Icon = forwardRef<SVGSVGElement, IconProps>(
    (
      {
        size = 24,
        color = 'currentColor',
        strokeWidth = 2,
        className,
        style,
        ...props
      },
      ref
    ) => {
      return (
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={className}
          style={style}
          {...props}
        >
          {path}
        </svg>
      );
    }
  );

  Icon.displayName = displayName;
  return Icon;
}

// For filled icons (no stroke)
export function createFilledIcon(
  displayName: string,
  path: React.ReactNode
): React.ForwardRefExoticComponent<IconProps & React.RefAttributes<SVGSVGElement>> {
  const Icon = forwardRef<SVGSVGElement, IconProps>(
    (
      {
        size = 24,
        color = 'currentColor',
        className,
        style,
        ...props
      },
      ref
    ) => {
      return (
        <svg
          ref={ref}
          xmlns="http://www.w3.org/2000/svg"
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill={color}
          className={className}
          style={style}
          {...props}
        >
          {path}
        </svg>
      );
    }
  );

  Icon.displayName = displayName;
  return Icon;
}
