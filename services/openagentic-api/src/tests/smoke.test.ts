/**
 * Smoke Tests for SSE Implementation
 * High-level integration tests to ensure the SSE system works end-to-end
 */

import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { setTimeout } from 'timers/promises';

describe('SSE Smoke Tests', () => {
  let apiProcess: ChildProcess;
  const API_PORT = 8001; // Use different port for testing
  const API_URL = `http://localhost:${API_PORT}`;

  beforeAll(async () => {
    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.PORT = API_PORT.toString();
    process.env.API_SECRET_KEY = 'test-secret';
    process.env.FRONTEND_SECRET = 'test-frontend';
    process.env.SIGNING_SECRET = 'test-signing';
    process.env.AZURE_OPENAI_API_KEY = 'test-azure-key';
    process.env.AZURE_DALLE_API_KEY = 'test-dalle-key';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test.openai.azure.com';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'test-deployment';
    process.env.POSTGRES_URL = 'postgresql://test:test@localhost:5433/test';

    // Start API server for smoke tests
    apiProcess = spawn('node', ['dist/server.js'], {
      cwd: '/app',
      env: { ...process.env },
      stdio: 'pipe'
    });

    // Wait for server to start
    await setTimeout(3000);
  }, 30000);

  afterAll(async () => {
    if (apiProcess) {
      apiProcess.kill();
    }
  });

  describe('API Health', () => {
    test('should respond to health check', async () => {
      const response = await fetch(`${API_URL}/health`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data.status).toBe('ok');
    });
  });

  describe('SSE Endpoint', () => {
    test('should reject unauthenticated requests', async () => {
      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sessionId: 'test-session',
          message: 'Hello'
        })
      });

      expect(response.status).toBe(401);
    });

    test('should accept authenticated requests and return SSE stream', async () => {
      // Create a valid test JWT token
      const testToken = createTestJWT({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      });

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
          sessionId: 'smoke-test-session',
          message: 'Hello, this is a smoke test'
        })
      });

      expect(response.status).toBe(200);
      // v0.6.7: chat stream is NDJSON-only (Phase E SSE cleanup).
      expect(response.headers.get('content-type')).toBe('application/x-ndjson');
      expect(response.headers.get('cache-control')).toContain('no-cache');
      expect(response.headers.get('connection')).toBe('keep-alive');
    });

    test('should stream real SSE events', async () => {
      const testToken = createTestJWT({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      });

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
          sessionId: 'smoke-test-session-2',
          message: 'Generate a simple response'
        })
      });

      expect(response.status).toBe(200);

      // Read the first few chunks of the stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let chunks = '';
      let chunkCount = 0;
      const maxChunks = 10; // Read first 10 chunks

      if (reader) {
        while (chunkCount < maxChunks) {
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks += decoder.decode(value, { stream: true });
          chunkCount++;
          
          // Stop if we have enough data
          if (chunks.includes('event: done')) {
            break;
          }
        }
        reader.releaseLock();
      }

      // Verify SSE format
      expect(chunks).toContain('event: message_received');
      expect(chunks).toContain('event: cot_step');
      expect(chunks).toContain('data: {');
      
      // Parse events
      const events = parseSSEEventsFromString(chunks);
      expect(events.length).toBeGreaterThan(0);
      
      // Should have at least message_received and cot_step events
      const eventTypes = events.map(e => e.event);
      expect(eventTypes).toContain('message_received');
      expect(eventTypes).toContain('cot_step');
    });
  });

  describe('CoT Integration', () => {
    test('should generate Chain of Thought steps', async () => {
      const testToken = createTestJWT({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      });

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
          sessionId: 'cot-test-session',
          message: 'Explain the process of photosynthesis step by step'
        })
      });

      expect(response.status).toBe(200);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let chunks = '';
      let chunkCount = 0;

      if (reader) {
        while (chunkCount < 20) { // Read more chunks for CoT
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks += decoder.decode(value, { stream: true });
          chunkCount++;
          
          if (chunks.includes('event: done')) {
            break;
          }
        }
        reader.releaseLock();
      }

      const events = parseSSEEventsFromString(chunks);
      const cotEvents = events.filter(e => e.event === 'cot_step');
      
      expect(cotEvents.length).toBeGreaterThan(0);
      
      // Verify CoT step structure
      cotEvents.forEach(event => {
        expect(event.data).toHaveProperty('step');
        expect(event.data.step).toHaveProperty('id');
        expect(event.data.step).toHaveProperty('type');
        expect(event.data.step).toHaveProperty('title');
        expect(event.data.step).toHaveProperty('content');
        expect(event.data.step).toHaveProperty('timestamp');
        expect(event.data.step).toHaveProperty('confidence');
      });
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed requests gracefully', async () => {
      const testToken = createTestJWT({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      });

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: 'invalid-json'
      });

      // Should handle gracefully, not crash
      expect([400, 500]).toContain(response.status);
    });

    test('should handle missing session ID', async () => {
      const testToken = createTestJWT({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      });

      const response = await fetch(`${API_URL}/api/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
          message: 'Hello without session ID'
        })
      });

      // Should handle gracefully
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});

// Helper functions
function createTestJWT(payload: any): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${headerB64}.${payloadB64}.test-signature`;
}

function parseSSEEventsFromString(str: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const lines = str.split('\n');
  
  let currentEvent = '';
  let currentData = '';
  
  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.substring(7).trim();
    } else if (line.startsWith('data: ')) {
      currentData = line.substring(6);
      try {
        const data = JSON.parse(currentData);
        events.push({ event: currentEvent, data });
      } catch (e) {
        // Skip invalid JSON
      }
      currentEvent = '';
      currentData = '';
    }
  }
  
  return events;
}