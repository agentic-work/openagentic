/**
 * Shared configuration for all tests
 */

const config = {
  // API Configuration
  apiUrl: process.env.API_URL || 'http://localhost:8000',
  // Override via $API_KEY env var; placeholder is non-functional.
  apiKey: process.env.API_KEY || 'oa_test_PLACEHOLDER_REPLACE_WITH_REAL_KEY',

  // UI Configuration
  uiUrl: process.env.UI_URL || 'http://localhost',

  // Local Admin Credentials
  localAdmin: {
    username: process.env.LOCAL_ADMIN_USER || 'admin@local.test',
    password: process.env.LOCAL_ADMIN_PASS || 'admin123'
  },

  // Timeouts
  timeouts: {
    api: parseInt(process.env.API_TIMEOUT) || 30000,
    streaming: parseInt(process.env.STREAMING_TIMEOUT) || 120000,
    mcp: parseInt(process.env.MCP_TIMEOUT) || 60000,
    ui: parseInt(process.env.UI_TIMEOUT) || 30000
  },

  // Test Output Directory
  outputDir: process.env.TEST_OUTPUT_DIR || './test-results',

  // Headless mode for UI tests
  headless: process.env.HEADLESS !== 'false',

  // Default model for chat tests
  defaultModel: process.env.DEFAULT_MODEL || 'gemini-2.0-flash-001'
};

// Helper function to make API requests
async function apiRequest(endpoint, options = {}) {
  const url = `${config.apiUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': config.apiKey,
    ...options.headers
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  return response;
}

// Helper function for streaming chat
async function streamChat(message, conversationId = null, onChunk = null) {
  const body = {
    model: config.defaultModel,
    messages: [{ role: 'user', content: message }],
    stream: true
  };

  if (conversationId) {
    body.conversationId = conversationId;
  }

  const response = await apiRequest('/api/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  let fullContent = '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          fullContent += content;
          if (onChunk) onChunk(content, parsed);
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }

  return fullContent;
}

// Helper function for non-streaming chat
async function chat(message, conversationId = null) {
  const body = {
    model: config.defaultModel,
    messages: [{ role: 'user', content: message }],
    stream: false
  };

  if (conversationId) {
    body.conversationId = conversationId;
  }

  const response = await apiRequest('/api/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// Test result helper
function createTestResult(name, passed, duration, error = null, details = {}) {
  return {
    name,
    passed,
    duration,
    error: error ? error.message || String(error) : null,
    timestamp: new Date().toISOString(),
    ...details
  };
}

// Console logging helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function logPass(msg) {
  console.log(`${colors.green}PASS${colors.reset} ${msg}`);
}

function logFail(msg) {
  console.log(`${colors.red}FAIL${colors.reset} ${msg}`);
}

function logInfo(msg) {
  console.log(`${colors.blue}INFO${colors.reset} ${msg}`);
}

function logSection(title) {
  console.log(`\n${colors.cyan}=== ${title} ===${colors.reset}\n`);
}

module.exports = {
  config,
  apiRequest,
  streamChat,
  chat,
  createTestResult,
  logPass,
  logFail,
  logInfo,
  logSection,
  colors
};
