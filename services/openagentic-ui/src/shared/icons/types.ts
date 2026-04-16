/**
 * Icon Types
 * Base types for the OpenAgentic icon library
 */

import React, { SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  /**
   * Icon size in pixels. Can also pass width/height separately.
   * @default 24
   */
  size?: number | string;
  /**
   * Icon color. Inherits from currentColor by default.
   */
  color?: string;
  /**
   * Stroke width for outlined icons.
   * @default 2
   */
  strokeWidth?: number | string;
  /**
   * Accessibility label for the icon.
   */
  'aria-label'?: string;
}

export type IconComponent = React.FC<IconProps>;

/**
 * LucideIcon type alias for backwards compatibility.
 * Use IconComponent for new code.
 */
export type LucideIcon = React.ForwardRefExoticComponent<
  IconProps & React.RefAttributes<SVGSVGElement>
>;
