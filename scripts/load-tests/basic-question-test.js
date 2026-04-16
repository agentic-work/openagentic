/**
 * Basic Question Test - Verifies LLM doesn't call unnecessary MCPs
 *
 * Tests that basic questions (math, greetings, general knowledge) are answered
 * directly WITHOUT tool calls, while cloud/infrastructure questions DO use tools.
 */

const EventSource = require('eventsource');

const API_URL = 'http://localhost:8000';
const API_KEY = 'awc_dev_3485594b357440d5fc3d4217f4846b501d7f05719a2cd7e08debf606e0e0a394';

// Test cases
const TEST_CASES = [
  // Basic questions - should NOT call tools
  {
    query: "What is 2+2?",
    expectTools: false,
    description: "Basic math question"
  },
  {
    query: "Hello, how are you?",
    expectTools: false,
    description: "Greeting"
  },
  {
    query: "What is the capital of France?",
    expectTools: false,
    description: "General knowledge"
  },
  {
    query: "Explain how async/await works in JavaScript",
    expectTools: false,
    description: "Coding explanation"
  },
  {
    query: "Write a function to reverse a string in Python",
    expectTools: false,
    description: "Code generation"
  },
  // Tool-required questions - SHOULD call tools (skip for now, just test basic)
  // {
  //   query: "List my Azure subscriptions",
  //   expectTools: true,
  //   description: "Azure infrastructure query"
  // },
];

async function createConversation() {
  const response = await fetch(`${API_URL}/api/conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify({
      title: 'Basic Question Test',
      model: 'gemini-2.0-flash-001'
    })
  });

  if (!response.ok) {
    throw new Error(`Failed to create conversation: ${response.status}`);
  }

  return response.json();
}

async function sendMessage(conversationId, message) {
  return new Promise((resolve, reject) => {
    const result = {
      content: '',
      toolCalls: [],
      mcpCalls: [],
      stages: [],
      error: null
    };

    const url = `${API_URL}/api/chat/${conversationId}/stream`;
    console.log(`  📤 Sending: "${message.substring(0, 50)}..."`);

    const es = new EventSource(url, {
      headers: {
        'X-API-Key': API_KEY
      }
    });

    // Send the actual message via POST
    fetch(`${API_URL}/api/chat/${conversationId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
      },
      body: JSON.stringify({
        content: message,
        model: 'gemini-2.0-flash-001'
      })
    }).catch(err => {
      console.error('Error sending message:', err);
    });

    const timeout = setTimeout(() => {
      es.close();
      resolve(result);
    }, 60000);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'content' && data.content) {
          result.content += data.content;
        }

        if (data.type === 'stage') {
          result.stages.push(data.stage);
          if (data.stage === 'mcp') {
            console.log(`    ⚙️ MCP stage triggered`);
          }
        }

        if (data.type === 'mcp_call' || data.type === 'tool_call') {
          result.toolCalls.push(data);
          console.log(`    🔧 Tool call: ${data.name || data.tool || 'unknown'}`);
        }

        if (data.type === 'done') {
          clearTimeout(timeout);
          es.close();
          resolve(result);
        }

        if (data.type === 'error') {
          result.error = data.error;
          clearTimeout(timeout);
          es.close();
          resolve(result);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    es.onerror = (error) => {
      // Don't treat as error, might just be end of stream
      clearTimeout(timeout);
      es.close();
      resolve(result);
    };
  });
}

async function runTests() {
  console.log('\n🧪 BASIC QUESTION TEST');
  console.log('=' .repeat(60));
  console.log('Testing that basic questions are answered WITHOUT tool calls\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const testCase of TEST_CASES) {
    console.log(`\n📋 Test: ${testCase.description}`);
    console.log(`   Query: "${testCase.query}"`);
    console.log(`   Expect tools: ${testCase.expectTools ? 'YES' : 'NO'}`);

    try {
      const conversation = await createConversation();
      const result = await sendMessage(conversation.id, testCase.query);

      const hasToolCalls = result.toolCalls.length > 0;
      const testPassed = hasToolCalls === testCase.expectTools;

      if (testPassed) {
        console.log(`   ✅ PASSED - ${hasToolCalls ? 'Tools used as expected' : 'No tools used (correct)'}`);
        passed++;
      } else {
        console.log(`   ❌ FAILED - ${hasToolCalls ? 'Tools used unexpectedly!' : 'Tools NOT used but expected'}`);
        if (result.toolCalls.length > 0) {
          console.log(`   Tool calls: ${result.toolCalls.map(t => t.name || t.tool || 'unknown').join(', ')}`);
        }
        failed++;
      }

      // Show response preview
      const preview = result.content.substring(0, 150).replace(/\n/g, ' ');
      console.log(`   Response preview: "${preview}..."`);

      results.push({
        name: testCase.description,
        query: testCase.query,
        passed: testPassed,
        toolCalls: result.toolCalls.length,
        responseLength: result.content.length,
        stages: result.stages
      });

    } catch (error) {
      console.log(`   ❌ ERROR - ${error.message}`);
      failed++;
      results.push({
        name: testCase.description,
        query: testCase.query,
        passed: false,
        error: error.message
      });
    }
  }

  console.log('\n' + '=' .repeat(60));
  console.log(`📊 RESULTS: ${passed}/${TEST_CASES.length} tests passed`);

  if (failed > 0) {
    console.log(`\n⚠️ ${failed} test(s) failed - LLM may be calling unnecessary tools`);
  } else {
    console.log('\n✅ All tests passed! LLM is not calling unnecessary tools.');
  }

  // Save results
  const fs = require('fs');
  const reportPath = `/tmp/basic-question-test-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify({ passed, failed, results }, null, 2));
  console.log(`\n📁 Report saved to: ${reportPath}`);

  return { passed, failed, results };
}

runTests().catch(console.error);
