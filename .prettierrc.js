module.exports = {
  // Line length and wrapping
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  
  // Semicolons and quotes
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  
  // Trailing commas and brackets
  trailingComma: 'es5',
  bracketSpacing: true,
  bracketSameLine: false,
  
  // Arrow functions
  arrowParens: 'always',
  
  // Line endings
  endOfLine: 'lf',
  
  // JSX specific
  jsxSingleQuote: false,
  
  // Markdown
  proseWrap: 'preserve',
  
  // HTML
  htmlWhitespaceSensitivity: 'css',
  
  // Vue
  vueIndentScriptAndStyle: false,
  
  // Special handling for different file types
  overrides: [
    {
      files: '*.json',
      options: {
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        trailingComma: 'none',
      },
    },
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always',
        tabWidth: 2,
        useTabs: false,
      },
    },
    {
      files: '*.yml',
      options: {
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
      },
    },
    {
      files: ['*.tsx', '*.jsx'],
      options: {
        jsxSingleQuote: false,
        bracketSameLine: false,
      },
    },
  ],
};