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