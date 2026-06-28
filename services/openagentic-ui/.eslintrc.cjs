/* eslint-env node */
/**
 * openagentic-ui ESLint config (legacy / .eslintrc format).
 *
 * Converted from .eslintrc.json so we can wire in the local
 * `eslint-plugin-admin-tokens` plugin (resolved via the file: dep declared
 * in this package's package.json -> node_modules symlink).
 */
const path = require('path');

// Touch the local plugin so module-not-found surfaces here, not deep in eslint.
// path.resolve is intentional even though we reference the plugin by its
// installed name below — keeps the "where does this plugin live?" answer
// obvious to future maintainers.
require(path.resolve(__dirname, 'eslint-plugin-admin-tokens'));

module.exports = {
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:react/jsx-runtime',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
    project: './tsconfig.json',
  },
  plugins: [
    '@typescript-eslint',
    'react',
    'react-hooks',
    'import',
    'admin-tokens',
  ],
  env: {
    browser: true,
    es2020: true,
    node: true,
  },
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      typescript: {
        alwaysTryTypes: true,
        project: './tsconfig.json',
      },
    },
  },
  rules: {
    // ===== ASYNC PATTERN CONSISTENCY =====
    'no-async-promise-executor': 'error',
    'require-await': 'error',
    'no-return-await': 'error',
    'prefer-promise-reject-errors': 'error',
    '@typescript-eslint/promise-function-async': 'error',
    '@typescript-eslint/await-thenable': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',

    // ===== ERROR HANDLING CONSISTENCY =====
    'no-throw-literal': 'off',
    '@typescript-eslint/no-throw-literal': 'error',

    // ===== NAMING CONVENTIONS =====
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'interface',
        format: ['PascalCase'],
        custom: {
          regex: '^I?[A-Z][a-zA-Z0-9]*$',
          match: true,
        },
      },
      {
        selector: 'typeAlias',
        format: ['PascalCase'],
      },
      {
        selector: 'enum',
        format: ['PascalCase'],
      },
      {
        selector: 'enumMember',
        format: ['UPPER_CASE', 'PascalCase'],
      },
      {
        selector: 'class',
        format: ['PascalCase'],
      },
      {
        selector: 'function',
        format: ['camelCase', 'PascalCase'],
      },
      {
        selector: 'variable',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
      },
      {
        selector: 'parameter',
        format: ['camelCase'],
        leadingUnderscore: 'allow',
      },
    ],

    // ===== TYPESCRIPT BEST PRACTICES =====
    '@typescript-eslint/explicit-function-return-type': 'warn',
    // no-explicit-any RATCHET. Promoted from 'warn' to 'error' so NEW `any`
    // fails the lint. The large existing burden is grandfathered: CI only lints
    // files CHANGED in a PR/push (see the eslint-ratchet job in
    // .github/workflows/ci.yml), so untouched legacy files never trip this and
    // the count can only go down.
    //
    // Burndown baseline (services/openagentic-ui/src, 2026-06-21):
    //   ~917 `as any` casts and ~2651 total `any` occurrences. Of those, 339
    //   `as any` lived in NodePropertiesPanel.tsx alone; this pass cut that file
    //   to well under 40 (see its updateData<K> helper). Do NOT add `any` to new code.
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/prefer-optional-chain': 'error',
    '@typescript-eslint/no-non-null-assertion': 'warn',
    '@typescript-eslint/strict-boolean-expressions': 'warn',

    // ===== GENERAL CODE QUALITY =====
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'prefer-const': 'error',
    'no-var': 'error',
    'no-duplicate-imports': 'error',
    'no-unused-expressions': 'error',
    'no-unreachable': 'error',
    'no-constant-condition': 'error',
    eqeqeq: ['error', 'always'],

    // ===== REACT SPECIFIC RULES =====
    'react/prop-types': 'off',
    'react/display-name': 'off',
    'react/jsx-uses-react': 'off',
    'react/react-in-jsx-scope': 'off',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'react/jsx-no-bind': ['warn', { allowArrowFunctions: true }],
    'react/jsx-key': 'error',

    // ===== IMPORT ORGANIZATION =====
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-duplicates': 'error',
    'import/no-unresolved': 'error',

    // ===== PREVENT AI-GENERATED DUPLICATION =====
    'no-duplicate-case': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',

    // ===== THEME CONSISTENCY RULES =====
    // Prevent hardcoded theme colors - use theme utilities or CSS variables
    // See: src/utils/theme.ts for utilities
    'no-restricted-syntax': [
      'warn',
      {
        selector: 'Literal[value=/rgba\\(124,\\s*58,\\s*237/]',
        message:
          'Use theme.bgPrimary() from @/utils/theme instead of hardcoded rgba(124, 58, 237, ...)',
      },
      {
        selector: 'Literal[value=/rgba\\(99,\\s*102,\\s*241/]',
        message:
          'Use theme utilities from @/utils/theme instead of hardcoded rgba(99, 102, 241, ...)',
      },
      {
        selector: 'Literal[value=/rgba\\(139,\\s*92,\\s*246/]',
        message:
          'Use theme.bgPrimary() from @/utils/theme instead of hardcoded rgba(139, 92, 246, ...)',
      },
      {
        selector: 'TemplateLiteral[quasis.0.value.raw=/rgba\\(124,\\s*58,\\s*237/]',
        message:
          'Use theme.bgPrimary() from @/utils/theme instead of hardcoded rgba in template',
      },
      {
        selector: 'TemplateLiteral[quasis.0.value.raw=/rgba\\(99,\\s*102,\\s*241/]',
        message:
          'Use theme utilities from @/utils/theme instead of hardcoded rgba in template',
      },
      {
        selector: 'Literal[value=/#7C3AED/i]',
        message: 'Use cssVar.primary from @/utils/theme instead of hardcoded #7C3AED',
      },
      {
        selector: 'Literal[value=/#8B5CF6/i]',
        message: 'Use CSS variable var(--color-primary) instead of hardcoded #8B5CF6',
      },
      {
        selector: 'Literal[value=/#6D28D9/i]',
        message: 'Use CSS variable var(--color-primaryDark) instead of hardcoded #6D28D9',
      },
      {
        selector: 'TemplateLiteral[quasis.0.value.raw=/style jsx/]',
        message:
          'style jsx is Next.js syntax - use standard CSS, Tailwind, or CSS-in-JS instead',
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        'no-console': 'off',
      },
    },
    {
      files: ['vite.config.ts', 'tailwind.config.js', 'postcss.config.js'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // Admin migration (PR #139 / #140) replaced 394 hex literals with --ap-*
      // CSS variables. Prevent regressions inside the admin tree only —
      // chart palettes / brand colors elsewhere are intentionally exempt.
      files: ['src/features/admin/**/*.{ts,tsx}'],
      rules: {
        'admin-tokens/no-hardcoded-admin-color': 'error',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    '*.generated.ts',
    'vite-env.d.ts',
  ],
};
