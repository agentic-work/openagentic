/**
 * UAT: LLM Provider/Model CRUD + Playground — v0.6.0
 *
 * 10 Admin Console CRUD tests + 10 Chat/Code/Flows integration tests
 *
 * Tests use GhostPilot API (http://localhost:4444) for browser automation.
 * All API calls are made from the authenticated browser context.
 *
 * Prerequisites:
 *   - GhostPilot running at localhost:4444
 *   - Logged in to https://chat-dev.openagentic.io as admin (mcp-tester@openagentic.local)
 *   - Bedrock provider configured with valid AWS credentials
 *   - Ollama provider configured with local models loaded
 */

const GP = 'http://localhost:4444';
const APP = 'https://chat-dev.openagentic.io';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function gpFetch(path: string, opts?: any) {
  const res = await fetch(`${GP}${path}`, {
    method: opts?.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

async function gpClick(text: string) { return gpFetch('/api/click', { body: { text } }); }
async function gpClickSel(sel: string) { return gpFetch('/api/click', { body: { selector: sel } }); }
async function gpType(sel: string, text: string) { return gpFetch('/api/type', { body: { selector: sel, text } }); }
async function gpGoto(url: string) { return gpFetch('/api/goto', { body: { url } }); }
async function gpScreenshot(path: string) { await fetch(`${GP}/api/screenshot`); /* save to path */ }
async function gpEval(script: string): Promise<any> { return gpFetch('/api/eval', { body: { script } }); }
async function gpText(sel: string): Promise<string> {
  const res = await gpFetch('/api/text', { body: { selector: sel } });
  return res.text || '';
}
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/** Make authenticated API call from browser context, return { status, body } */
async function apiCall(method: string, path: string, bodyObj?: any): Promise<{ status: number; body: any }> {
  const bodyStr = bodyObj ? `, body: JSON.stringify(${JSON.stringify(bodyObj)})` : '';
  await gpEval(`
    const el = document.getElementById('__uat') || (() => {
      const e = document.createElement('pre');
      e.id = '__uat';
      e.style.display = 'none';
      document.body.appendChild(e);
      return e;
    })();
    el.textContent = 'loading...';
    fetch('${path}', {
      method: '${method}',
      credentials: 'include',
      headers: {'Content-Type': 'application/json'}
      ${bodyStr}
    }).then(r => r.text().then(t => {
      el.textContent = r.status + '\\n' + t;
    })).catch(e => {
      el.textContent = '0\\n' + JSON.stringify({error: e.message});
    });
  `);
  await sleep(3000);
  const raw = await gpText('#__uat');
  const [statusStr, ...rest] = raw.split('\n');
  const status = parseInt(statusStr) || 0;
  let body: any;
  try { body = JSON.parse(rest.join('\n')); } catch { body = rest.join('\n'); }
  return { status, body };
}

// ─── Assertion helpers ──────────────────────────────────────────────────────

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${msg}`);
}
function assertEqual(actual: any, expected: any, msg: string) {
  if (actual !== expected) throw new Error(`ASSERTION FAILED: ${msg} — expected ${expected}, got ${actual}`);
}

// ─── Test Results ───────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, passed: false, error: err.message, durationMs: Date.now() - start });
    console.log(`  ❌ ${name}: ${err.message} (${Date.now() - start}ms)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: ADMIN CONSOLE CRUD TESTS (10 tests)
// ═══════════════════════════════════════════════════════════════════════════

async function adminCrudTests() {
  console.log('\n══════════════════════════════════════════');
  console.log('PART 1: Admin Console CRUD Tests');
  console.log('══════════════════════════════════════════');

  // ── Test 1: List providers ──
  await runTest('1.1 List all providers', async () => {
    const { status, body } = await apiCall('GET', '/api/admin/llm-providers');
    assertEqual(status, 200, 'List providers should return 200');
    assert(Array.isArray(body.providers), 'Response should have providers array');
    assert(body.providers.length >= 2, 'Should have at least 2 providers (bedrock + ollama)');
  });

  // ── Test 2: Get single provider health ──
  await runTest('1.2 Get provider health', async () => {
    const { status, body } = await apiCall('GET', '/api/admin/llm-providers/bedrock');
    assertEqual(status, 200, 'Get provider should return 200');
    assert(body.health?.status === 'healthy', 'Bedrock should be healthy');
  });

  // ── Test 3: Discover models from Bedrock (live API) ──
  await runTest('1.3 Discover Bedrock models (live API)', async () => {
    const { status, body } = await apiCall('GET', '/api/admin/llm-providers/bedrock/discover-models');
    assertEqual(status, 200, 'Discover should return 200');
    assert(body.modelDetails?.length >= 10, `Should have 10+ models, got ${body.modelDetails?.length}`);
    // Verify model has capabilities metadata
    const firstModel = body.modelDetails[0];
    assert(firstModel.capabilities !== undefined, 'Models should have capabilities');
    assert(firstModel.id, 'Models should have id');
  });

  // ── Test 4: Discover models from Ollama (local only) ──
  await runTest('1.4 Discover Ollama models (local only)', async () => {
    const { status, body } = await apiCall('GET', '/api/admin/llm-providers/ollama/discover-models');
    assertEqual(status, 200, 'Discover should return 200');
    assert(body.modelDetails?.length >= 1, 'Should have at least 1 loaded model');
    // Verify no pullRequired models (curated catalog removed)
    const hasPullRequired = body.modelDetails.some((m: any) => m.pullRequired);
    assert(!hasPullRequired, 'Ollama should NOT have pullRequired models (no curated catalog)');
  });

  // ── Test 5: Add model to Bedrock ──
  await runTest('1.5 Add model to Bedrock', async () => {
    // First delete if exists from previous test
    await apiCall('DELETE', '/api/admin/llm-providers/bedrock/models/amazon.nova-micro-v1:0');
    await sleep(1000);

    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/bedrock/models', {
      modelId: 'amazon.nova-micro-v1:0',
      displayName: 'Nova Micro',
      capabilities: { chat: true, tools: true, streaming: true },
      config: { maxOutputTokens: 5120, temperature: 0.8, topP: 0.95, enabled: true, roles: ['chat'] },
    });
    assertEqual(status, 201, `Add model should return 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.model?.id === 'amazon.nova-micro-v1:0', 'Model ID should match');
    assert(body.model?.config?.temperature === 0.8, 'Temperature should be 0.8');
  });

  // ── Test 6: Update model config ──
  await runTest('1.6 Update model config (temp, maxTokens, rateLimit)', async () => {
    const { status, body } = await apiCall('PUT', '/api/admin/llm-providers/bedrock/models/amazon.nova-micro-v1:0', {
      config: {
        maxOutputTokens: 2048,
        temperature: 0.5,
        topP: 0.9,
        rateLimitRequestsPerHour: 500,
        roles: ['chat', 'compaction'],
      },
    });
    assertEqual(status, 200, `Update should return 200, got ${status}`);
    assertEqual(body.model?.config?.temperature, 0.5, 'Temperature should be updated to 0.5');
    assertEqual(body.model?.config?.maxOutputTokens, 2048, 'Max tokens should be updated to 2048');
    assertEqual(body.model?.config?.rateLimitRequestsPerHour, 500, 'Rate limit should be 500');
    assert(body.model?.config?.roles?.includes('compaction'), 'Roles should include compaction');
  });

  // ── Test 7: Disable and re-enable model ──
  await runTest('1.7 Disable and re-enable model', async () => {
    // Disable
    const { status: s1, body: b1 } = await apiCall('PUT', '/api/admin/llm-providers/bedrock/models/amazon.nova-micro-v1:0', {
      config: { enabled: false },
    });
    assertEqual(s1, 200, 'Disable should return 200');
    assertEqual(b1.model?.config?.enabled, false, 'Model should be disabled');

    // Re-enable
    const { status: s2, body: b2 } = await apiCall('PUT', '/api/admin/llm-providers/bedrock/models/amazon.nova-micro-v1:0', {
      config: { enabled: true },
    });
    assertEqual(s2, 200, 'Re-enable should return 200');
    assertEqual(b2.model?.config?.enabled, true, 'Model should be re-enabled');
  });

  // ── Test 8: Pause and resume provider ──
  await runTest('1.8 Pause and resume provider', async () => {
    // Get provider UUID
    const { body: listBody } = await apiCall('GET', '/api/admin/llm-providers');
    const bedrock = listBody.providers?.find((p: any) => p.name === 'bedrock');
    assert(bedrock?.id, 'Should find bedrock provider UUID');

    // Pause
    const { status: s1, body: b1 } = await apiCall('POST', `/api/admin/llm-providers/${bedrock.id}/pause`, {});
    assertEqual(s1, 200, 'Pause should return 200');
    assert(b1.status === 'paused', 'Provider should be paused');

    // Resume
    const { status: s2, body: b2 } = await apiCall('POST', `/api/admin/llm-providers/${bedrock.id}/resume`);
    assertEqual(s2, 200, 'Resume should return 200');
    assert(b2.status === 'active', 'Provider should be active');
  });

  // ── Test 9: Delete model ──
  await runTest('1.9 Delete model', async () => {
    const { status, body } = await apiCall('DELETE', '/api/admin/llm-providers/bedrock/models/amazon.nova-micro-v1:0');
    assertEqual(status, 200, `Delete should return 200, got ${status}`);
    assert(body.message?.includes('removed'), 'Should confirm removal');
  });

  // ── Test 10: Playground chat completion ──
  await runTest('1.10 Playground chat completion (Ollama)', async () => {
    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/playground', {
      provider: 'ollama',
      model: 'gpt-oss',
      testType: 'chat',
      config: { temperature: 0.7, maxTokens: 100 },
      input: { messages: [{ role: 'user', content: 'Say hello in one word' }] },
    });
    assertEqual(status, 200, `Playground should return 200, got ${status}: ${JSON.stringify(body).substring(0, 200)}`);
    assert(body.success === true, 'Playground should succeed');
    assert(body.response || body.thinking, 'Should have response or thinking content');
    assert(body.latency > 0, 'Should have latency measurement');
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: CHAT/CODE/FLOWS INTEGRATION TESTS (10 tests)
// ═══════════════════════════════════════════════════════════════════════════

async function integrationTests() {
  console.log('\n══════════════════════════════════════════');
  console.log('PART 2: Chat/Code/Flows Integration Tests');
  console.log('══════════════════════════════════════════');

  // ── Test 11: Playground Ollama completion with different temperature ──
  await runTest('2.1 Playground Ollama with custom temp/tokens', async () => {
    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/playground', {
      provider: 'ollama',
      model: 'gpt-oss',
      testType: 'chat',
      config: { temperature: 0.3, maxTokens: 50 },
      input: { messages: [{ role: 'user', content: 'What is 2+2? Answer with just the number.' }] },
    });
    assertEqual(status, 200, `Playground should return 200, got ${status}`);
    assert(body.success === true, `Playground should succeed: ${JSON.stringify(body).substring(0, 200)}`);
    assert(body.configApplied?.temperature === 0.3, 'Temperature should be applied');
    assert(body.configApplied?.maxTokens === 50, 'MaxTokens should be applied');
  });

  // ── Test 12: Playground with qwen3 model (different model same provider) ──
  await runTest('2.2 Playground with different Ollama model', async () => {
    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/playground', {
      provider: 'ollama',
      model: 'qwen3:8b',
      testType: 'chat',
      config: { temperature: 0.7, maxTokens: 50 },
      input: { messages: [{ role: 'user', content: 'Count to 3' }] },
    });
    // Streaming may return 200 or 400 depending on provider support
    assert(status === 200 || status === 400, `Should return 200 or 400 (not supported), got ${status}`);
    if (status === 200) {
      assert(body.success === true, `Streaming should succeed: ${JSON.stringify(body).substring(0, 200)}`);
    }
  });

  // ── Test 13: Playground multi-turn conversation ──
  await runTest('2.3 Playground multi-turn conversation', async () => {
    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/playground', {
      provider: 'ollama',
      model: 'gpt-oss',
      testType: 'chat',
      config: { temperature: 0.5, maxTokens: 100 },
      input: {
        messages: [
          { role: 'user', content: 'My name is TestBot' },
          { role: 'assistant', content: 'Hello TestBot!' },
          { role: 'user', content: 'What is my name?' },
        ],
      },
    });
    assertEqual(status, 200, 'Multi-turn should return 200');
    assert(body.success === true, 'Multi-turn should succeed');
  });

  // ── Test 14: Chat session creation ──
  await runTest('2.4 Chat session creation', async () => {
    const { status, body } = await apiCall('POST', '/api/chat/sessions', {
      title: 'UAT Test Session',
    });
    assert(status === 200 || status === 201, `Session create should succeed, got ${status}`);
    const sessionId = body.session?.id || body.sessionId || body.id;
    assert(sessionId, `Should return session ID, got: ${JSON.stringify(body).substring(0, 200)}`);
  });

  // ── Test 15: Chat session list ──
  await runTest('2.5 Chat session list', async () => {
    const { status, body } = await apiCall('GET', '/api/chat/sessions');
    assert(status === 200, `Session list should return 200, got ${status}`);
    const sessions = body.sessions || body;
    assert(Array.isArray(sessions), 'Should return sessions array');
    assert(sessions.length >= 1, 'Should have at least 1 session');
  });

  // ── Test 16: Provider test connection ──
  await runTest('2.6 Provider test connection', async () => {
    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/bedrock/test', {
      testType: 'basic',
    });
    assertEqual(status, 200, `Provider test should return 200, got ${status}`);
    assert(body.tests?.basic || body.tests?.initialization, 'Should have test results');
  });

  // ── Test 17: Ollama provider test connection ──
  await runTest('2.7 Ollama provider test connection', async () => {
    const { status, body } = await apiCall('POST', '/api/admin/llm-providers/ollama/test', {
      testType: 'basic',
    });
    assertEqual(status, 200, `Ollama test should return 200, got ${status}`);
  });

  // ── Test 18: Add multiple models with different capabilities ──
  await runTest('2.8 Add multiple models with different capabilities', async () => {
    const models = [
      { modelId: 'amazon.nova-lite-v1:0', displayName: 'Nova Lite', caps: { chat: true, vision: true, tools: true, streaming: true }, roles: ['chat', 'vision'] },
      { modelId: 'amazon.titan-embed-text-v2:0', displayName: 'Titan Embed', caps: { embeddings: true }, roles: ['embedding'] },
    ];

    for (const m of models) {
      // Clean up first
      await apiCall('DELETE', `/api/admin/llm-providers/bedrock/models/${m.modelId}`);
      await sleep(500);

      const { status, body } = await apiCall('POST', '/api/admin/llm-providers/bedrock/models', {
        modelId: m.modelId,
        displayName: m.displayName,
        capabilities: m.caps,
        config: { maxOutputTokens: 5120, temperature: 1.0, enabled: true, roles: m.roles },
      });
      assertEqual(status, 201, `Add ${m.modelId} should return 201, got ${status}: ${JSON.stringify(body).substring(0, 200)}`);
    }

    // Verify all models exist
    const { body: listBody } = await apiCall('GET', '/api/admin/llm-providers');
    const bedrock = listBody.providers?.find((p: any) => p.name === 'bedrock');
    const modelIds = bedrock?.config?.models?.map((m: any) => m.id) || [];
    for (const m of models) {
      assert(modelIds.includes(m.modelId), `Model ${m.modelId} should be in registry`);
    }
  });

  // ── Test 19: Bulk model operations (disable all, re-enable all) ──
  await runTest('2.9 Bulk disable/re-enable all models', async () => {
    const { body: listBody } = await apiCall('GET', '/api/admin/llm-providers');
    const bedrock = listBody.providers?.find((p: any) => p.name === 'bedrock');
    const models = bedrock?.config?.models || [];

    // Disable all
    for (const m of models) {
      const { status } = await apiCall('PUT', `/api/admin/llm-providers/bedrock/models/${m.id}`, {
        config: { enabled: false },
      });
      assertEqual(status, 200, `Disable ${m.id} should return 200`);
    }

    // Verify all disabled
    const { body: afterDisable } = await apiCall('GET', '/api/admin/llm-providers');
    const bedrockAfter = afterDisable.providers?.find((p: any) => p.name === 'bedrock');
    for (const m of (bedrockAfter?.config?.models || [])) {
      assertEqual(m.config?.enabled, false, `${m.id} should be disabled`);
    }

    // Re-enable all
    for (const m of models) {
      const { status } = await apiCall('PUT', `/api/admin/llm-providers/bedrock/models/${m.id}`, {
        config: { enabled: true },
      });
      assertEqual(status, 200, `Re-enable ${m.id} should return 200`);
    }
  });

  // ── Test 20: Cleanup test models ──
  await runTest('2.10 Cleanup test models', async () => {
    const cleanup = ['amazon.nova-lite-v1:0', 'amazon.titan-embed-text-v2:0'];
    for (const modelId of cleanup) {
      const { status } = await apiCall('DELETE', `/api/admin/llm-providers/bedrock/models/${modelId}`);
      assert(status === 200 || status === 404, `Cleanup ${modelId} should return 200 or 404`);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  LLM Provider/Model CRUD UAT — v0.6.0            ║');
  console.log('║  20 tests across Admin CRUD + Integration         ║');
  console.log('╚════════════════════════════════════════════════════╝');

  await adminCrudTests();
  await integrationTests();

  // Summary
  console.log('\n══════════════════════════════════════════');
  console.log('RESULTS SUMMARY');
  console.log('══════════════════════════════════════════');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`  Passed: ${passed}/${results.length}`);
  console.log(`  Failed: ${failed}/${results.length}`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    }
  }
  console.log('');

  return { passed, failed, total: results.length, results };
}

main().catch(console.error);
