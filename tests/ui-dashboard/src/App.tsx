import React, { useState, useEffect } from 'react';

// Test suite definitions with all features
const testSuites = {
  api: {
    name: 'API Tests',
    icon: '🔌',
    tests: [
      { id: 'auth.health', name: 'Health Check', file: 'api/auth.spec.ts' },
      { id: 'auth.apikey', name: 'API Key Authentication', file: 'api/auth.spec.ts' },
      { id: 'auth.bearer', name: 'Bearer Token Auth', file: 'api/auth.spec.ts' },
      { id: 'chat.sessions', name: 'Session Management', file: 'api/chat.spec.ts' },
      { id: 'chat.stream', name: 'Chat Streaming', file: 'api/chat.spec.ts' },
      { id: 'chat.slider', name: 'Intelligence Slider', file: 'api/chat.spec.ts' },
      { id: 'chat.models', name: 'Model Selection', file: 'api/chat.spec.ts' },
      { id: 'chat.history', name: 'Message History', file: 'api/chat.spec.ts' },
      { id: 'chat.attachments', name: 'File Attachments', file: 'api/chat.spec.ts' },
    ]
  },
  mcp: {
    name: 'MCP Tests',
    icon: '🔧',
    tests: [
      { id: 'mcp.health', name: 'MCP Proxy Health', file: 'api/mcp.spec.ts' },
      { id: 'mcp.tools', name: 'Tool Discovery', file: 'api/mcp.spec.ts' },
      { id: 'mcp.execution', name: 'Tool Execution', file: 'api/mcp.spec.ts' },
      { id: 'mcp.memory', name: 'Memory MCP', file: 'api/mcp.spec.ts' },
      { id: 'mcp.admin', name: 'Admin MCP', file: 'api/mcp.spec.ts' },
      { id: 'mcp.diagram', name: 'Diagram MCP', file: 'api/mcp.spec.ts' },
      { id: 'mcp.web', name: 'Web Search MCP', file: 'api/mcp.spec.ts' },
    ]
  },
  ui: {
    name: 'UI Tests',
    icon: '🖥️',
    tests: [
      { id: 'ui.load', name: 'Page Load', file: 'ui/chat.spec.ts' },
      { id: 'ui.chat', name: 'Chat Interface', file: 'ui/chat.spec.ts' },
      { id: 'ui.sessions', name: 'Session List', file: 'ui/chat.spec.ts' },
      { id: 'ui.streaming', name: 'Response Streaming', file: 'ui/chat.spec.ts' },
      { id: 'ui.tools', name: 'Tool Display', file: 'ui/chat.spec.ts' },
      { id: 'ui.keyboard', name: 'Keyboard Shortcuts', file: 'ui/chat.spec.ts' },
      { id: 'ui.responsive', name: 'Responsive Design', file: 'ui/chat.spec.ts' },
    ]
  },
  admin: {
    name: 'Admin Portal Tests',
    icon: '⚙️',
    tests: [
      { id: 'admin.access', name: 'Access Control', file: 'ui/admin.spec.ts' },
      { id: 'admin.dashboard', name: 'Dashboard Metrics', file: 'ui/admin.spec.ts' },
      { id: 'admin.users', name: 'User Management', file: 'ui/admin.spec.ts' },
      { id: 'admin.settings', name: 'System Settings', file: 'ui/admin.spec.ts' },
      { id: 'admin.apikeys', name: 'API Key Management', file: 'ui/admin.spec.ts' },
      { id: 'admin.security', name: 'Security & Audit', file: 'ui/admin.spec.ts' },
      { id: 'admin.analytics', name: 'Analytics', file: 'ui/admin.spec.ts' },
    ]
  },
  load: {
    name: 'Load Tests',
    icon: '📈',
    tests: [
      { id: 'load.smoke', name: 'Smoke Test', file: 'load/scenarios/smoke.js' },
      { id: 'load.stress', name: 'Stress Test', file: 'load/scenarios/stress.js' },
    ]
  },
  integration: {
    name: 'Integration Tests',
    icon: '🔗',
    tests: [
      { id: 'int.database', name: 'Database Connection', file: 'integration/database.spec.ts' },
      { id: 'int.redis', name: 'Redis Cache', file: 'integration/redis.spec.ts' },
      { id: 'int.milvus', name: 'Milvus Vector DB', file: 'integration/milvus.spec.ts' },
      { id: 'int.providers', name: 'LLM Providers', file: 'integration/providers.spec.ts' },
      { id: 'int.flowise', name: 'Flowise Integration', file: 'integration/flowise.spec.ts' },
    ]
  }
};

type TestStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

interface TestResult {
  id: string;
  status: TestStatus;
  duration?: number;
  error?: string;
  logs?: string[];
}

function App() {
  const [selectedSuite, setSelectedSuite] = useState<string>('api');
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [environment, setEnvironment] = useState<'docker' | 'helm' | 'local'>('docker');
  const [logs, setLogs] = useState<string[]>([]);

  const runTest = async (testId: string) => {
    setTestResults(prev => ({
      ...prev,
      [testId]: { id: testId, status: 'running' }
    }));
    addLog(`Starting test: ${testId}`);

    // Simulate test execution (in real implementation, this would call the test runner API)
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    const passed = Math.random() > 0.2;
    setTestResults(prev => ({
      ...prev,
      [testId]: {
        id: testId,
        status: passed ? 'passed' : 'failed',
        duration: Math.floor(500 + Math.random() * 2000),
        error: passed ? undefined : 'Assertion failed: expected true but got false'
      }
    }));
    addLog(`Test ${testId}: ${passed ? 'PASSED' : 'FAILED'}`);
  };

  const runAllTests = async () => {
    setIsRunning(true);
    addLog('='.repeat(50));
    addLog(`Starting all tests in ${environment} environment`);
    addLog('='.repeat(50));

    for (const [suiteKey, suite] of Object.entries(testSuites)) {
      addLog(`\n--- ${suite.name} ---`);
      for (const test of suite.tests) {
        await runTest(test.id);
      }
    }

    setIsRunning(false);
    addLog('\n' + '='.repeat(50));
    addLog('All tests completed');
  };

  const runSuite = async (suiteKey: string) => {
    setIsRunning(true);
    const suite = testSuites[suiteKey as keyof typeof testSuites];
    addLog(`\n--- Running ${suite.name} ---`);

    for (const test of suite.tests) {
      await runTest(test.id);
    }

    setIsRunning(false);
  };

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  const getStatusColor = (status: TestStatus) => {
    switch (status) {
      case 'passed': return 'text-green-400';
      case 'failed': return 'text-red-400';
      case 'running': return 'text-yellow-400';
      case 'skipped': return 'text-gray-500';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: TestStatus) => {
    switch (status) {
      case 'passed': return '✓';
      case 'failed': return '✗';
      case 'running': return '⟳';
      case 'skipped': return '⊘';
      default: return '○';
    }
  };

  const passedCount = Object.values(testResults).filter(r => r.status === 'passed').length;
  const failedCount = Object.values(testResults).filter(r => r.status === 'failed').length;
  const totalTests = Object.values(testSuites).reduce((acc, s) => acc + s.tests.length, 0);

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">OpenAgentic Test Dashboard</h1>
            <p className="text-gray-400 mt-1">Comprehensive testing platform for UAT</p>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as any)}
              className="bg-gray-800 text-white px-4 py-2 rounded-lg border border-gray-700"
            >
              <option value="docker">Docker Compose</option>
              <option value="helm">Helm/Kubernetes</option>
              <option value="local">Local Development</option>
            </select>
            <button
              onClick={runAllTests}
              disabled={isRunning}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-2 rounded-lg font-semibold flex items-center gap-2"
            >
              {isRunning ? '⟳ Running...' : '▶ Run All Tests'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-400">{totalTests}</div>
            <div className="text-gray-400">Total Tests</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-green-400">{passedCount}</div>
            <div className="text-gray-400">Passed</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-red-400">{failedCount}</div>
            <div className="text-gray-400">Failed</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-3xl font-bold text-yellow-400">
              {passedCount + failedCount > 0
                ? Math.round((passedCount / (passedCount + failedCount)) * 100)
                : 0}%
            </div>
            <div className="text-gray-400">Pass Rate</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Test Suites */}
          <div className="col-span-2">
            {/* Suite Tabs */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {Object.entries(testSuites).map(([key, suite]) => (
                <button
                  key={key}
                  onClick={() => setSelectedSuite(key)}
                  className={`px-4 py-2 rounded-lg whitespace-nowrap ${
                    selectedSuite === key
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {suite.icon} {suite.name}
                </button>
              ))}
            </div>

            {/* Test List */}
            <div className="bg-gray-800 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between p-4 border-b border-gray-700">
                <h2 className="text-xl font-semibold">
                  {testSuites[selectedSuite as keyof typeof testSuites].icon}{' '}
                  {testSuites[selectedSuite as keyof typeof testSuites].name}
                </h2>
                <button
                  onClick={() => runSuite(selectedSuite)}
                  disabled={isRunning}
                  className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-1 rounded text-sm"
                >
                  Run Suite
                </button>
              </div>
              <div className="divide-y divide-gray-700">
                {testSuites[selectedSuite as keyof typeof testSuites].tests.map((test) => {
                  const result = testResults[test.id];
                  return (
                    <div
                      key={test.id}
                      className="flex items-center justify-between p-4 hover:bg-gray-750"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-xl ${getStatusColor(result?.status || 'pending')}`}>
                          {getStatusIcon(result?.status || 'pending')}
                        </span>
                        <div>
                          <div className="font-medium">{test.name}</div>
                          <div className="text-sm text-gray-500">{test.file}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {result?.duration && (
                          <span className="text-gray-500 text-sm">{result.duration}ms</span>
                        )}
                        <button
                          onClick={() => runTest(test.id)}
                          disabled={isRunning}
                          className="text-blue-400 hover:text-blue-300 disabled:text-gray-600"
                        >
                          ▶
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Logs Panel */}
          <div className="bg-gray-800 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h2 className="text-xl font-semibold">📋 Test Logs</h2>
              <button
                onClick={() => setLogs([])}
                className="text-gray-400 hover:text-white text-sm"
              >
                Clear
              </button>
            </div>
            <div className="p-4 h-[600px] overflow-y-auto font-mono text-sm">
              {logs.length === 0 ? (
                <div className="text-gray-500">No logs yet. Run some tests to see output.</div>
              ) : (
                logs.map((log, i) => (
                  <div
                    key={i}
                    className={`${
                      log.includes('PASSED') ? 'text-green-400' :
                      log.includes('FAILED') ? 'text-red-400' :
                      log.includes('Starting') ? 'text-yellow-400' :
                      'text-gray-400'
                    }`}
                  >
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>OpenAgentic Test Harness v1.0 | Environment: {environment}</p>
          <p className="mt-1">
            Commands: <code className="bg-gray-800 px-2 py-1 rounded">npm run test:e2e</code>{' '}
            <code className="bg-gray-800 px-2 py-1 rounded">npm run test:load</code>{' '}
            <code className="bg-gray-800 px-2 py-1 rounded">npm run report</code>
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
