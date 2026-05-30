module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are not allowed',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Files not imported by any other file (except entry points)',
      from: {
        orphan: true,
        pathNot: [
          '\\.test\\.(js|ts|tsx)$',
          '\\.spec\\.(js|ts|tsx)$',
          '(^|/)server\\.ts$',
          '(^|/)index\\.ts$',
          '(^|/)_app\\.tsx$',
          '(^|/)_document\\.tsx$',
          '(^|/)pages/',
          '\\.config\\.(js|ts)$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-imports',
      severity: 'warn',
      comment: 'Importing deprecated modules is not recommended',
      from: {},
      to: {
        dependencyTypes: ['deprecated'],
      },
    },
    {
      name: 'not-to-test',
      severity: 'error',
      comment: 'Production code should not import test files',
      from: {
        pathNot: '\\.test\\.(js|ts|tsx)$|\\.spec\\.(js|ts|tsx)$',
      },
      to: {
        path: '\\.test\\.(js|ts|tsx)$|\\.spec\\.(js|ts|tsx)$',
      },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment: "Don't allow dependencies that are not in package.json",
      from: {},
      to: {
        dependencyTypes: ['npm-no-pkg', 'npm-unknown'],
      },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      comment: 'Dependencies should not be both in dependencies and devDependencies',
      from: {},
      to: {
        moreThanOneDependencyType: true,
      },
    },
    {
      name: 'api-not-to-ui',
      severity: 'error',
      comment: 'API service should not import from UI service',
      from: {
        path: '^services/openagenticchat-api',
      },
      to: {
        path: '^services/openagenticchat-ui',
      },
    },
    {
      name: 'ui-not-to-mcp',
      severity: 'error',
      comment: 'UI service should not directly import from MCP orchestrator',
      from: {
        path: '^services/openagenticchat-ui',
      },
      to: {
        path: '^services/mcp-orchestrator',
      },
    },
    {
      name: 'mcp-not-to-ui',
      severity: 'error',
      comment: 'MCP orchestrator should not import from UI service',
      from: {
        path: '^services/mcp-orchestrator',
      },
      to: {
        path: '^services/openagenticchat-ui',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: [
        'node_modules',
        '\\.generated\\.',
        'coverage',
        'dist',
        'build',
        '\\.next',
      ],
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: './tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
    reporterOptions: {
      dot: {
        collapsePattern: '^node_modules/(@[^/]+/[^/]+|[^/]+)',
        theme: {
          graph: {
            bgcolor: 'transparent',
            color: '#333333',
            fontcolor: '#333333',
            fillcolor: '#ffffff',
            splines: 'ortho',
          },
          node: {
            fillcolor: '#f7f7f7',
            color: '#333333',
            fontcolor: '#333333',
          },
          edge: {
            color: '#666666',
            fontcolor: '#333333',
          },
          modules: [
            {
              criteria: { source: '^services/openagenticchat-api' },
              attributes: { fillcolor: '#e8f4fd' },
            },
            {
              criteria: { source: '^services/openagenticchat-ui' },
              attributes: { fillcolor: '#f0e6ff' },
            },
            {
              criteria: { source: '^services/mcp-orchestrator' },
              attributes: { fillcolor: '#ffe6e6' },
            },
          ],
          dependencies: [
            {
              criteria: { resolved: '^node_modules/' },
              attributes: { fillcolor: '#f0f0f0' },
            },
            {
              criteria: { circular: true },
              attributes: { fillcolor: '#ff6666', color: '#ff0000', penwidth: 2 },
            },
          ],
        },
      },
      archi: {
        collapsePattern: '^(node_modules|packages|src|lib|app|test)',
        theme: {
          modules: [
            {
              criteria: { source: '\\.(test|spec)\\.' },
              attributes: { fillcolor: '#ffcccc' },
            },
            {
              criteria: { source: '\\.d\\.ts$' },
              attributes: { fillcolor: '#ccccff' },
            },
          ],
        },
      },
    },
  },
};