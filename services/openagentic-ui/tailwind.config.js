/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // Enable dark mode with 'dark' class on html element
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  safelist: [
    // Preserve background color overrides
    { pattern: /^bg-(white|gray|slate|zinc)(-\d+)?$/ },
    { pattern: /^hover:bg-(gray|slate)(-\d+)?$/, variants: ['hover'] },
  ],
  theme: {
    extend: {
      colors: {
        // Theme-aware CSS variables
        background: 'var(--color-background)',
        'surface': {
          DEFAULT: 'var(--color-surface)',
          primary: 'var(--color-surface)',
          secondary: 'var(--color-surfaceSecondary, var(--color-surfaceHover))',
          tertiary: 'var(--color-surfaceTertiary, var(--color-surface))',
          hover: 'var(--color-surfaceHover)',
        },
        // Semantic 'bg' colors (alias for surface - used as bg-bg-*)
        'bg': {
          DEFAULT: 'var(--color-background)',
          primary: 'var(--color-background)',
          secondary: 'var(--color-surface)',
          tertiary: 'var(--color-surfaceSecondary)',
          hover: 'var(--color-surfaceHover)',
        },
        'text': {
          DEFAULT: 'var(--color-text)',
          primary: 'var(--text-primary, var(--color-text))',
          secondary: 'var(--text-secondary, var(--color-textSecondary))',
          tertiary: 'var(--text-tertiary, var(--color-textMuted))',
          muted: 'var(--text-muted, var(--color-textMuted))',
        },
        'border': {
          DEFAULT: 'var(--color-border)',
          primary: 'var(--color-border)',
          hover: 'var(--color-borderHover)',
        },
        'primary': {
          500: 'var(--color-primary, #0A84FF)',  // Apple Blue fallback
          600: 'var(--color-primary, #007AFF)',
        },
        glass: {
          light: 'rgba(255, 255, 255, 0.1)',
          DEFAULT: 'rgba(255, 255, 255, 0.05)',
          dark: 'rgba(0, 0, 0, 0.1)',
        },
        blue: {
          glow: '#0A84FF',   // Apple Blue
          deep: '#007AFF',
          dark: '#0056CC',
        },
        // Semantic status colors - Apple-style real colors (not neon)
        success: {
          DEFAULT: 'var(--color-success, #30D158)',
          light: 'var(--color-success, #30D158)',
          bg: 'var(--callout-success-bg, rgba(48, 209, 88, 0.1))',
        },
        error: {
          DEFAULT: 'var(--color-error, #FF453A)',
          light: 'var(--color-error, #FF453A)',
          bg: 'var(--callout-error-bg, rgba(255, 69, 58, 0.1))',
        },
        warning: {
          DEFAULT: 'var(--color-warning, #FF9F0A)',
          light: 'var(--color-warning, #FF9F0A)',
          bg: 'var(--callout-warning-bg, rgba(255, 159, 10, 0.1))',
        },
        info: {
          DEFAULT: 'var(--accent-info, #0A84FF)',
          light: 'var(--accent-info, #0A84FF)',
          bg: 'var(--callout-info-bg, rgba(10, 132, 255, 0.1))',
        },
        // Accent color (user-selectable)
        accent: {
          DEFAULT: 'var(--color-primary)',
          primary: 'var(--user-accent-primary)',
          secondary: 'var(--user-accent-secondary)',
        },
        // Neutral grays using CSS vars
        muted: {
          DEFAULT: 'var(--color-textMuted, #8E8E93)',
          light: 'var(--color-textMuted, #8E8E93)',
          bg: 'var(--color-surfaceSecondary)',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%)',
      },
      backdropBlur: {
        xs: '2px',
        '3xl': '64px',
      },
      animation: {
        'float': 'float 20s ease-in-out infinite',
        'glow': 'glow 4s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.5s ease-out',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        glow: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: 0 },
          '100%': { transform: 'translateY(0)', opacity: 1 },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.15)',  // Neutral shadow, not purple
        'glow': '0 0 30px rgba(10, 132, 255, 0.5)',   // Apple Blue glow
        'glow-blue': '0 0 30px rgba(10, 132, 255, 0.5)',
      },
      borderRadius: {
        'glass': '12px',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
}
