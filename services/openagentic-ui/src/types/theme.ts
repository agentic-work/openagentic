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

export interface ColorSwatch {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
  950: string;
}

export interface ThemeColors {
  primary: ColorSwatch;
  neutral: ColorSwatch;
  accent?: ColorSwatch;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  cssVariables: Record<string, string>;
  preview: {
    background: string;
    card: string;
    text: string;
    accent: string;
  };
}

export interface ThemeSettings {
  currentTheme: string;
  mode: 'light' | 'dark' | 'auto';
  customColors?: Partial<ThemeColors>;
  reducedMotion: boolean;
  highContrast: boolean;
}

export type ThemeMode = 'light' | 'dark' | 'auto';