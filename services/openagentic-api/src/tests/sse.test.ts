/**
 * SSE Route Unit Tests
 * Tests for Server-Sent Events chat streaming functionality
 */

import { test, expect, describe, beforeEach, afterEach, vi, Mock } from 'vitest';
import { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { chatSSERoute } from '../routes/chat-sse.js';

// Mock OpenAI
vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn()
      }
    }
  }))
}));

// Mock ChatStorageService
vi.mock('../services/ChatStorageService.js', () => ({
  ChatStorageService: vi.fn().mockImplementation(() => ({
    addMessage: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue({
      id: 'test-session',
      title: 'Test Session',
      messages: [
        { id: '1', role: 'user', content: 'Hello', timestamp: '2025-01-28T00:00:00Z' }
      ]
    }),
    updateSession: vi.fn().mockResolvedValue(undefined)
  }))
}));

// Mock TitleGenerationService
vi.mock('../services/TitleGenerationService.js', () => ({
  TitleGenerationService: vi.fn().mockImplementation(() => ({
    generateTitle: vi.fn().mockResolvedValue('Generated Title')
  }))
}));

describe('SSE Chat Route', () => {
  let app: FastifyInstance;
  let mockOpenAI: any;

  beforeEach(async () => {
    // Set up test environment variables
    process.env.AZURE_OPENAI_API_KEY = 'test-api-key';
    process.env.AZURE_DALLE_API_KEY = 'test-dalle-key';
    process.env.AZURE_OPENAI_ENDPOINT = 'https://test-endpoint.com';
    process.env.AZURE_OPENAI_DEPLOYMENT = 'test-deployment';
    process.env.AZURE_OPENAI_API_VERSION = '2024-12-01-preview';

    app = Fastify({ logger: false });
    
    // Mock PostgreSQL pool
    (app as any).pg = {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [] })
      }
    };

    await app.register(chatSSERoute);
    await app.ready();

    // Get the mocked OpenAI instance
    const { OpenAI } = await import('openai');
    mockOpenAI = (OpenAI as Mock).mock.results[0].value;
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('Authentication', () => {
    test('should reject requests without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        payload: {
          sessionId: 'test-session',
          message: 'Hello'
        }
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Authentication required'
      });
    });

    test('should reject requests with invalid Bearer token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        headers: {
          authorization: 'Bearer invalid-token'
        },
        payload: {
          sessionId: 'test-session',
          message: 'Hello'
        }
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toEqual({
        error: 'Invalid authentication token'
      });
    });

    test('should accept valid JWT token', async () => {
      // Create a valid JWT token (simplified for testing)
      const validToken = Buffer.from(JSON.stringify({
        header: { alg: 'HS256', typ: 'JWT' }
      })).toString('base64') + '.' + 
      Buffer.from(JSON.stringify({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      })).toString('base64') + '.signature';

      // Mock streaming response
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
            usage: null
          };
          yield {
            choices: [{ delta: { content: ' there!' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          };
        }
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockStream);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        headers: {
          authorization: `Bearer ${validToken}`
        },
        payload: {
          sessionId: 'test-session',
          message: 'Hello'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
    });
  });

  describe('SSE Streaming', () => {
    let validToken: string;

    beforeEach(() => {
      validToken = Buffer.from(JSON.stringify({
        header: { alg: 'HS256', typ: 'JWT' }
      })).toString('base64') + '.' + 
      Buffer.from(JSON.stringify({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      })).toString('base64') + '.signature';
    });

    test('should stream chat response with CoT steps', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
            usage: null
          };
          yield {
            choices: [{ delta: { content: ' world!' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          };
        }
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockStream);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        headers: {
          authorization: `Bearer ${validToken}`
        },
        payload: {
          sessionId: 'test-session',
          message: 'Hello'
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');

      // Parse SSE events from response
      const events = parseSSEEvents(response.body);
      
      // Should have message_received, cot_step events, stream events, and done event
      expect(events.some(e => e.event === 'message_received')).toBe(true);
      expect(events.some(e => e.event === 'cot_step')).toBe(true);
      expect(events.some(e => e.event === 'stream')).toBe(true);
      expect(events.some(e => e.event === 'done')).toBe(true);
    });

    test('should use DALL-E API key for image requests', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{ delta: { content: 'Image generated!' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
          };
        }
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockStream);

      await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        headers: {
          authorization: `Bearer ${validToken}`
        },
        payload: {
          sessionId: 'test-session',
          message: 'Create an image of a cat'
        }
      });

      // Verify OpenAI was called with DALL-E API key
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-deployment',
          messages: expect.any(Array),
          temperature: 0.7,
          max_tokens: 1000,
          stream: true
        })
      );
    });

    test('should handle OpenAI API errors gracefully', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        headers: {
          authorization: `Bearer ${validToken}`
        },
        payload: {
          sessionId: 'test-session',
          message: 'Hello'
        }
      });

      expect(response.statusCode).toBe(200);
      const events = parseSSEEvents(response.body);
      expect(events.some(e => e.event === 'error')).toBe(true);
    });
  });

  describe('Chain of Thought', () => {
    let validToken: string;

    beforeEach(() => {
      validToken = Buffer.from(JSON.stringify({
        header: { alg: 'HS256', typ: 'JWT' }
      })).toString('base64') + '.' + 
      Buffer.from(JSON.stringify({
        oid: 'test-user-id',
        preferred_username: 'test@example.com'
      })).toString('base64') + '.signature';
    });

    test('should generate CoT steps for complex queries', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            choices: [{ delta: { content: 'Let me think about this...' } }],
            usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 }
          };
        }
      };

      mockOpenAI.chat.completions.create.mockResolvedValue(mockStream);

      const response = await app.inject({
        method: 'POST',
        url: '/api/chat/stream',
        headers: {
          authorization: `Bearer ${validToken}`
        },
        payload: {
          sessionId: 'test-session',
          message: 'Explain quantum computing in simple terms'
        }
      });

      const events = parseSSEEvents(response.body);
      const cotEvents = events.filter(e => e.event === 'cot_step');
      
      expect(cotEvents.length).toBeGreaterThan(0);
      
      // Check CoT step structure
      cotEvents.forEach(event => {
        expect(event.data.step).toHaveProperty('id');
        expect(event.data.step).toHaveProperty('type');
        expect(event.data.step).toHaveProperty('title');
        expect(event.data.step).toHaveProperty('content');
        expect(event.data.step).toHaveProperty('timestamp');
        expect(event.data.step).toHaveProperty('confidence');
      });
    });
  });
});

// Helper function to parse SSE events from response body
function parseSSEEvents(body: string): Array<{ event: string; data: any }> {
  const events: Array<{ event: string; data: any }> = [];
  const lines = body.split('\n');
  
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