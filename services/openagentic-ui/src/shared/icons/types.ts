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
