#!/usr/bin/env node
/**
 * Feedback Load Test — Generates chat sessions, messages, and feedback
 *
 * Creates realistic chat sessions across multiple models,
 * evaluates response quality with heuristics,
 * and submits thumbs_up/thumbs_down feedback.
 *
 * Usage: node scripts/feedback-load-test.mjs [--count 100] [--concurrency 5]
 */

const API_BASE = process.env.API_BASE || 'http://openagentic-api:8000';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || 'openagentic-internal-svc-k3s-2026-feb';
const USER_ID = process.env.USER_ID || 'azure_696cf712-372c-4bb0-94c6-a881d8d033d9';

const TOTAL = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--count') || '100');
const CONCURRENCY = parseInt(process.argv.find((a, i) => process.argv[i-1] === '--concurrency') || '5');

// Models to distribute across (simulates multi-model deployment)
const MODELS = [
  { name: 'gpt-oss', weight: 40 },        // Local Ollama — most usage
  { name: 'claude-sonnet', weight: 25 },   // Bedrock Sonnet
  { name: 'claude-opus', weight: 10 },     // Bedrock Opus (expensive)
  { name: 'gpt-4o', weight: 15 },          // Azure GPT-4o
  { name: 'gpt-4o-mini', weight: 10 },     // Azure GPT-4o-mini (cheap)
];

// Diverse prompts across task types
const PROMPTS = [
  // Code tasks
  { text: 'Write a Python function to merge two sorted linked lists', type: 'code' },
  { text: 'Create a TypeScript REST API endpoint with Fastify that handles file uploads', type: 'code' },
  { text: 'Write a Bash script to monitor disk usage and send alerts', type: 'code' },
  { text: 'Implement a Redis-based rate limiter in Node.js', type: 'code' },
  { text: 'Write a SQL query to find the top 5 customers by revenue per quarter', type: 'code' },
  // Analysis tasks
  { text: 'Explain the differences between Kubernetes Deployments, StatefulSets, and DaemonSets', type: 'analysis' },
  { text: 'Compare AWS Lambda vs Azure Functions vs Google Cloud Functions for a microservices architecture', type: 'analysis' },
  { text: 'What are the security implications of using JWT tokens vs session cookies?', type: 'analysis' },
  { text: 'Analyze the pros and cons of event-driven architecture vs request-response', type: 'analysis' },
  // Writing tasks
  { text: 'Write a professional email to a client explaining a 2-week project delay', type: 'writing' },
  { text: 'Create a README.md for an open-source CLI tool that converts CSV to JSON', type: 'writing' },
  { text: 'Draft release notes for v2.0 of a workflow automation platform', type: 'writing' },
  // Tool-use tasks (would trigger MCP)
  { text: 'List all pods in the agentic-dev namespace', type: 'tool' },
  { text: 'What is the current CPU usage of the openagentic-api deployment?', type: 'tool' },
  { text: 'Show me the last 10 error logs from the openagentic-api service', type: 'tool' },
  // Simple tasks
  { text: 'What is the capital of France?', type: 'simple' },
  { text: 'Convert 72 degrees Fahrenheit to Celsius', type: 'simple' },
  { text: 'What is the time complexity of quicksort?', type: 'simple' },
];

// Quality heuristics for feedback decisions
function evaluateResponse(content, prompt, model, responseTimeMs) {
  let score = 0.5; // neutral baseline

  // Length heuristic — too short is bad, reasonable length is good
  if (content.length < 20) score -= 0.3;        // Very short = bad
  else if (content.length > 100) score += 0.1;   // Decent length
  else if (content.length > 500) score += 0.2;   // Good detail

  // Code block detection for code prompts
  if (prompt.type === 'code') {
    if (content.includes('```') || content.includes('function') || content.includes('def ')) {
      score += 0.2; // Has code = good for code prompts
    } else {
      score -= 0.2; // No code for code prompt = bad
    }
  }

  // Error/refusal detection
  if (content.includes('I cannot') || content.includes('I apologize') || content.includes('error')) {
    score -= 0.15;
  }

  // Response time penalty — over 10s is bad UX
  if (responseTimeMs > 10000) score -= 0.1;
  if (responseTimeMs > 20000) score -= 0.2;

  // Model-specific bias (simulates real-world where premium models score better)
  if (model === 'claude-opus') score += 0.1;
  if (model === 'gpt-4o-mini') score -= 0.05; // Slightly worse quality

  // Add some randomness (real feedback is noisy)
  score += (Math.random() - 0.5) * 0.3;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
}

function pickModel() {
  const total = MODELS.reduce((s, m) => s + m.weight, 0);
  let r = Math.random() * total;
  for (const m of MODELS) {
    r -= m.weight;
    if (r <= 0) return m.name;
  }
  return MODELS[0].name;
}

function pickPrompt() {
  return PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
}

const headers = {
  'Content-Type': 'application/json',
  'X-Request-From': 'internal',
  'x-internal-secret': INTERNAL_SECRET,
  'x-user-id': USER_ID,
};

async function createSession(title) {
  const res = await fetch(`${API_BASE}/api/chat/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  return data.session?.id || data.id;
}

async function sendMessageAndGetResponse(sessionId, message, model) {
  const startTime = Date.now();

  const res = await fetch(`${API_BASE}/api/chat/stream`, {
    method: 'POST',
    headers: { ...headers, Accept: 'text/event-stream' },
    body: JSON.stringify({
      message,
      sessionId,
      model,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stream failed: ${res.status} ${err.substring(0, 200)}`);
  }

  // Parse SSE stream
  const text = await res.text();
  let messageId = null;
  let content = '';

  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try {
        const data = JSON.parse(line.substring(6));
        if (data.messageId) messageId = data.messageId;
        if (data.content) content += data.content;
        if (data.sessionId && !messageId) messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      } catch {}
    }
  }

  // Fallback messageId
  if (!messageId) {
    messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  return {
    messageId,
    content,
    responseTimeMs: Date.now() - startTime,
  };
}

async function submitFeedback(messageId, sessionId, feedbackType, model, responseTime, tokenCount) {
  const res = await fetch(`${API_BASE}/api/feedback`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messageId,
      sessionId,
      feedbackType,
      model,
      responseTime,
      tokenCount: tokenCount || Math.floor(Math.random() * 2000) + 100,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return { success: false, error: err.substring(0, 100) };
  }
  return await res.json();
}

// Stats tracking
const stats = {
  total: 0,
  success: 0,
  failed: 0,
  thumbsUp: 0,
  thumbsDown: 0,
  byModel: {},
  byType: {},
  errors: [],
};

async function runSingle(index) {
  const model = pickModel();
  const prompt = pickPrompt();

  try {
    // Create session
    const sessionId = await createSession(`Load Test #${index} - ${prompt.type}`);
    if (!sessionId) throw new Error('No session ID returned');

    // Send message
    const { messageId, content, responseTimeMs } = await sendMessageAndGetResponse(
      sessionId, prompt.text, model
    );

    // Evaluate quality
    const score = evaluateResponse(content, prompt, model, responseTimeMs);
    const feedbackType = score > 0.5 ? 'thumbs_up' : 'thumbs_down';

    // Submit feedback
    const fbResult = await submitFeedback(
      messageId, sessionId, feedbackType, model, responseTimeMs
    );

    // Track stats
    stats.total++;
    if (fbResult.success !== false) {
      stats.success++;
      if (feedbackType === 'thumbs_up') stats.thumbsUp++;
      else stats.thumbsDown++;
    } else {
      stats.failed++;
      stats.errors.push(fbResult.error);
    }

    // Per-model stats
    if (!stats.byModel[model]) stats.byModel[model] = { up: 0, down: 0, total: 0, avgTime: 0 };
    stats.byModel[model].total++;
    stats.byModel[model][feedbackType === 'thumbs_up' ? 'up' : 'down']++;
    stats.byModel[model].avgTime = (stats.byModel[model].avgTime * (stats.byModel[model].total - 1) + responseTimeMs) / stats.byModel[model].total;

    // Per-type stats
    if (!stats.byType[prompt.type]) stats.byType[prompt.type] = { up: 0, down: 0 };
    stats.byType[prompt.type][feedbackType === 'thumbs_up' ? 'up' : 'down']++;

    if (stats.total % 10 === 0) {
      console.log(`[${stats.total}/${TOTAL}] ${feedbackType} | ${model} | ${responseTimeMs}ms | ${content.length} chars`);
    }

  } catch (err) {
    stats.total++;
    stats.failed++;
    stats.errors.push(`${model}: ${err.message.substring(0, 100)}`);
    if (stats.failed <= 5) console.error(`  ERROR #${index}: ${err.message.substring(0, 150)}`);
  }
}

async function runBatch(startIdx, count) {
  for (let i = startIdx; i < startIdx + count; i++) {
    await runSingle(i);
  }
}

async function main() {
  console.log(`\n🔬 Feedback Load Test`);
  console.log(`   Target: ${TOTAL} requests, ${CONCURRENCY} concurrent`);
  console.log(`   API: ${API_BASE}`);
  console.log(`   Models: ${MODELS.map(m => m.name).join(', ')}`);
  console.log('');

  const startTime = Date.now();

  // Run with concurrency
  const batchSize = Math.ceil(TOTAL / CONCURRENCY);
  const batches = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const start = i * batchSize;
    const count = Math.min(batchSize, TOTAL - start);
    if (count > 0) batches.push(runBatch(start, count));
  }

  await Promise.all(batches);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 RESULTS (${elapsed}s)`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Total:     ${stats.total}`);
  console.log(`Success:   ${stats.success} (${((stats.success/stats.total)*100).toFixed(1)}%)`);
  console.log(`Failed:    ${stats.failed}`);
  console.log(`Thumbs Up: ${stats.thumbsUp} (${((stats.thumbsUp/stats.success)*100).toFixed(1)}%)`);
  console.log(`Thumbs Dn: ${stats.thumbsDown} (${((stats.thumbsDown/stats.success)*100).toFixed(1)}%)`);

  console.log(`\n📈 BY MODEL:`);
  for (const [model, s] of Object.entries(stats.byModel)) {
    const rate = s.total > 0 ? ((s.up / s.total) * 100).toFixed(1) : '0';
    console.log(`  ${model.padEnd(20)} ${rate}% satisfaction  (${s.up}↑ ${s.down}↓)  avg ${Math.round(s.avgTime)}ms`);
  }

  console.log(`\n📋 BY TASK TYPE:`);
  for (const [type, s] of Object.entries(stats.byType)) {
    const total = s.up + s.down;
    const rate = total > 0 ? ((s.up / total) * 100).toFixed(1) : '0';
    console.log(`  ${type.padEnd(15)} ${rate}% satisfaction  (${s.up}↑ ${s.down}↓)`);
  }

  if (stats.errors.length > 0) {
    console.log(`\n❌ UNIQUE ERRORS (${stats.errors.length} total):`);
    const unique = [...new Set(stats.errors)].slice(0, 5);
    unique.forEach(e => console.log(`  - ${e}`));
  }

  console.log('');
}

main().catch(console.error);
