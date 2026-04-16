/**
 * Test Memory System
 *
 * This script tests the memory system by:
 * 1. Making a chat request that triggers MCP tools
 * 2. Creating a new session
 * 3. Asking about previous conversation to test memory retrieval
 */

const API_BASE_URL = 'http://localhost:8000';
const DEV_API_KEY = 'awc_dev_3485594b357440d5fc3d4217f4846b501d7f05719a2cd7e08debf606e0e0a394';

// Helper to make API requests
async function makeRequest(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': DEV_API_KEY,
    ...options.headers
  };

  console.log(`\n[REQUEST] ${options.method || 'GET'} ${url}`);

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return response;
}

// Helper to create a new session
async function createSession(title = 'Test Session') {
  const response = await makeRequest('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({
      title,
      model: 'gpt-4o'
    })
  });

  const data = await response.json();
  const session = data.session || data;
  console.log(`[SESSION CREATED] ID: ${session.id}, Title: ${session.title}`);
  return session;
}

// Helper to send a chat message and collect streaming response
async function sendChatMessage(sessionId, message) {
  console.log(`\n[CHAT MESSAGE] Session: ${sessionId}`);
  console.log(`[USER] ${message}`);

  const response = await makeRequest('/api/chat/stream', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      message: message,
      model: 'gpt-4o'
    })
  });

  // Parse SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';
  let toolCalls = [];
  let done = false;

  while (!done) {
    const { value, done: streamDone } = await reader.read();
    done = streamDone;

    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            done = true;
            break;
          }

          try {
            const parsed = JSON.parse(data);

            // Collect content
            if (parsed.choices?.[0]?.delta?.content) {
              fullResponse += parsed.choices[0].delta.content;
              process.stdout.write(parsed.choices[0].delta.content);
            }

            // Collect tool calls
            if (parsed.choices?.[0]?.delta?.tool_calls) {
              const newToolCalls = parsed.choices[0].delta.tool_calls;
              for (const tc of newToolCalls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) {
                    toolCalls[tc.index] = { id: tc.id, type: tc.type, function: { name: '', arguments: '' } };
                  }
                  if (tc.function?.name) {
                    toolCalls[tc.index].function.name += tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCalls[tc.index].function.arguments += tc.function.arguments;
                  }
                }
              }
            }

            // Log tool calls if present
            if (parsed.tool_calls) {
              console.log('\n[TOOL CALLS]', JSON.stringify(parsed.tool_calls, null, 2));
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    }
  }

  console.log('\n'); // New line after streaming

  return {
    content: fullResponse,
    toolCalls: toolCalls.filter(tc => tc.function.name)
  };
}

// Main test function
async function testMemorySystem() {
  console.log('='.repeat(80));
  console.log('MEMORY SYSTEM TEST');
  console.log('='.repeat(80));

  try {
    // Step 1: Create first session and ask about Azure/AWS
    console.log('\n--- STEP 1: First Chat Session ---');
    const session1 = await createSession('Memory Test - Session 1');

    const response1 = await sendChatMessage(
      session1.id,
      'Show me my Azure subscriptions and AWS account info'
    );

    console.log('\n[RESPONSE 1 SUMMARY]');
    console.log(`Content length: ${response1.content.length} chars`);
    console.log(`Tool calls: ${response1.toolCalls.length}`);
    if (response1.toolCalls.length > 0) {
      console.log('Tools called:');
      response1.toolCalls.forEach(tc => {
        console.log(`  - ${tc.function.name}`);
      });
    }

    // Wait a bit for memory indexing
    console.log('\n[WAITING] 5 seconds for memory indexing...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Step 2: Create new session and ask about previous conversation
    console.log('\n--- STEP 2: New Session - Test Memory Retrieval ---');
    const session2 = await createSession('Memory Test - Session 2');

    const response2 = await sendChatMessage(
      session2.id,
      'What Azure subscriptions did I have from our previous conversation?'
    );

    console.log('\n[RESPONSE 2 SUMMARY]');
    console.log(`Content length: ${response2.content.length} chars`);
    console.log(`Tool calls: ${response2.toolCalls.length}`);

    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Session 1 ID: ${session1.id}`);
    console.log(`Session 1 Tool Calls: ${response1.toolCalls.length}`);
    console.log(`Session 2 ID: ${session2.id}`);
    console.log(`Session 2 Tool Calls: ${response2.toolCalls.length}`);
    console.log('\nNOTE: Check docker logs to verify:');
    console.log('  1. Memory indexing occurred after Session 1');
    console.log('  2. Memory retrieval occurred in Session 2');
    console.log('  3. LLM used retrieved memories in response');
    console.log('\nRun: docker logs openagenticchat-api --tail 200');

  } catch (error) {
    console.error('\n[ERROR]', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the test
testMemorySystem();
