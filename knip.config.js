module.exports = {
  // Entry points for the application
  entry: [
    'services/openagenticchat-api/src/server.ts',
    'services/openagenticchat-ui/src/pages/**/*.{ts,tsx}',
    'services/mcp-orchestrator/src/index.ts',
  ],
  
  // Project files to analyze
  project: [
    'services/**/*.{ts,tsx}',
    '!services/**/*.test.{ts,tsx}',
    '!services/**/*.spec.{ts,tsx}',
    '!services/**/*.d.ts',
  ],
  
  // Ignore patterns
  ignore: [
    'node_modules/**',
    'dist/**',
    'build/**',
    '.next/**',
    'coverage/**',
    'scripts/**',
    'migrations/**',
    '**/*.config.{js,ts}',
    '**/*.generated.{ts,js}',
    'prisma/**',
  ],
  
  // Known unused exports that are okay to keep
  ignoreExportsUsedInFile: true,
  
  // Workspace configuration
  workspaces: {
    'services/openagenticchat-api': {
      entry: ['src/server.ts'],
      project: ['src/**/*.ts'],
    },
    'services/openagenticchat-ui': {
      entry: ['src/pages/**/*.{ts,tsx}', 'src/pages/_app.tsx', 'src/pages/_document.tsx'],
      project: ['src/**/*.{ts,tsx}'],
    },
    'services/mcp-orchestrator': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
    },
  },
  
  // Rules configuration
  rules: {
    // Files
    files: 'error',
    
    // Dependencies
    dependencies: 'warn',
    devDependencies: 'warn',
    optionalPeerDependencies: 'warn',
    
    // Exports
    exports: 'warn',
    types: 'warn',
    duplicates: 'warn',
    
    // Specific rules
    enumMembers: 'warn',
    classMembers: 'warn',
    unlisted: 'warn',
  },
  
  // Ignore specific dependencies that are used indirectly
  ignoreDependencies: [
    '@types/node', // Used by TypeScript
    'typescript', // Used by build process
    'eslint', // Used by linting
    'prettier', // Used by formatting
    'jest', // Used by testing
    '@testing-library/*', // Used by testing
  ],
  
  // Ignore specific binaries
  ignoreBinaries: [
    'husky',
    'lint-staged',
    'prisma',
    'tsx',
    'nodemon',
  ],
  
  // Report settings
  reporter: 'symbols',
  
  // Performance
  cache: true,
  
  // Include configuration files in analysis
  includeEntryExports: false,
};