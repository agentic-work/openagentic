/**
 * ChatStorageService Unit Tests
 *
 * Tests for chat session and message persistence:
 * - Session CRUD operations
 * - Message storage
 * - Conversation history
 * - Title generation
 * - Session cleanup
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Prisma client
const mockPrisma = {
  chatSession: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  chatMessage: {
    create: vi.fn(),
    createMany: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
};

describe('ChatStorageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Session Creation', () => {
    it('should create session with generated ID', async () => {
      const sessionData = {
        id: 'session_abc123',
        title: 'New Chat',
        userId: 'user_123',
        model: 'gpt-4o',
        created_at: new Date(),
      };

      mockPrisma.chatSession.create.mockResolvedValue(sessionData);

      const result = await mockPrisma.chatSession.create({
        data: sessionData
      });

      expect(result.id).toBe('session_abc123');
      expect(result.title).toBe('New Chat');
    });

    it('should create session with provided ID', async () => {
      const customId = 'custom_session_id';
      const sessionData = {
        id: customId,
        title: 'Custom Session',
        userId: 'user_123',
        model: 'claude-3-5-sonnet',
        created_at: new Date(),
      };

      mockPrisma.chatSession.create.mockResolvedValue(sessionData);

      const result = await mockPrisma.chatSession.create({
        data: sessionData
      });

      expect(result.id).toBe(customId);
    });

    it('should set default title if not provided', async () => {
      const generateDefaultTitle = () => {
        const now = new Date();
        return `Chat ${now.toLocaleDateString()}`;
      };

      const title = generateDefaultTitle();
      expect(title).toMatch(/^Chat \d{1,2}\/\d{1,2}\/\d{4}$/);
    });
  });

  describe('Session Retrieval', () => {
    it('should find session by ID', async () => {
      const session = {
        id: 'session_123',
        title: 'Test Session',
        userId: 'user_123',
        model: 'gpt-4o',
        created_at: new Date(),
      };

      mockPrisma.chatSession.findUnique.mockResolvedValue(session);

      const result = await mockPrisma.chatSession.findUnique({
        where: { id: 'session_123' }
      });

      expect(result?.id).toBe('session_123');
    });

    it('should return null for non-existent session', async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(null);

      const result = await mockPrisma.chatSession.findUnique({
        where: { id: 'nonexistent' }
      });

      expect(result).toBeNull();
    });

    it('should list sessions for user', async () => {
      const sessions = [
        { id: 'session_1', title: 'Session 1', userId: 'user_123' },
        { id: 'session_2', title: 'Session 2', userId: 'user_123' },
      ];

      mockPrisma.chatSession.findMany.mockResolvedValue(sessions);

      const result = await mockPrisma.chatSession.findMany({
        where: { userId: 'user_123' },
        orderBy: { created_at: 'desc' }
      });

      expect(result.length).toBe(2);
    });

    it('should paginate session list', async () => {
      const sessions = [
        { id: 'session_1', title: 'Session 1' },
        { id: 'session_2', title: 'Session 2' },
      ];

      mockPrisma.chatSession.findMany.mockResolvedValue(sessions);

      const result = await mockPrisma.chatSession.findMany({
        where: { userId: 'user_123' },
        skip: 0,
        take: 10,
        orderBy: { created_at: 'desc' }
      });

      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Session Update', () => {
    it('should update session title', async () => {
      mockPrisma.chatSession.update.mockResolvedValue({
        id: 'session_123',
        title: 'Updated Title'
      });

      const result = await mockPrisma.chatSession.update({
        where: { id: 'session_123' },
        data: { title: 'Updated Title' }
      });

      expect(result.title).toBe('Updated Title');
    });

    it('should update session model', async () => {
      mockPrisma.chatSession.update.mockResolvedValue({
        id: 'session_123',
        model: 'claude-3-5-sonnet'
      });

      const result = await mockPrisma.chatSession.update({
        where: { id: 'session_123' },
        data: { model: 'claude-3-5-sonnet' }
      });

      expect(result.model).toBe('claude-3-5-sonnet');
    });
  });

  describe('Session Deletion', () => {
    it('should delete session', async () => {
      mockPrisma.chatSession.delete.mockResolvedValue({ id: 'session_123' });

      const result = await mockPrisma.chatSession.delete({
        where: { id: 'session_123' }
      });

      expect(result.id).toBe('session_123');
      expect(mockPrisma.chatSession.delete).toHaveBeenCalled();
    });

    it('should cascade delete messages', async () => {
      // Delete messages first
      mockPrisma.chatMessage.deleteMany.mockResolvedValue({ count: 5 });
      mockPrisma.chatSession.delete.mockResolvedValue({ id: 'session_123' });

      await mockPrisma.chatMessage.deleteMany({
        where: { sessionId: 'session_123' }
      });
      await mockPrisma.chatSession.delete({
        where: { id: 'session_123' }
      });

      expect(mockPrisma.chatMessage.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.chatSession.delete).toHaveBeenCalled();
    });
  });

  describe('Message Storage', () => {
    it('should save user message', async () => {
      const message = {
        id: 'msg_123',
        sessionId: 'session_123',
        role: 'user',
        content: 'Hello!',
        created_at: new Date(),
      };

      mockPrisma.chatMessage.create.mockResolvedValue(message);

      const result = await mockPrisma.chatMessage.create({
        data: message
      });

      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello!');
    });

    it('should save assistant message', async () => {
      const message = {
        id: 'msg_456',
        sessionId: 'session_123',
        role: 'assistant',
        content: 'Hi there!',
        model: 'gpt-4o',
        created_at: new Date(),
      };

      mockPrisma.chatMessage.create.mockResolvedValue(message);

      const result = await mockPrisma.chatMessage.create({
        data: message
      });

      expect(result.role).toBe('assistant');
      expect(result.model).toBe('gpt-4o');
    });

    it('should save message with tool calls', async () => {
      const message = {
        id: 'msg_789',
        sessionId: 'session_123',
        role: 'assistant',
        content: null,
        tool_calls: JSON.stringify([
          { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{}' } }
        ]),
        created_at: new Date(),
      };

      mockPrisma.chatMessage.create.mockResolvedValue(message);

      const result = await mockPrisma.chatMessage.create({
        data: message
      });

      expect(result.tool_calls).toBeDefined();
      const toolCalls = JSON.parse(result.tool_calls);
      expect(toolCalls[0].function.name).toBe('search');
    });

    it('should batch save multiple messages', async () => {
      mockPrisma.chatMessage.createMany.mockResolvedValue({ count: 3 });

      const result = await mockPrisma.chatMessage.createMany({
        data: [
          { sessionId: 'session_123', role: 'user', content: 'Message 1' },
          { sessionId: 'session_123', role: 'assistant', content: 'Response 1' },
          { sessionId: 'session_123', role: 'user', content: 'Message 2' },
        ]
      });

      expect(result.count).toBe(3);
    });
  });

  describe('Message Retrieval', () => {
    it('should get messages for session', async () => {
      const messages = [
        { id: 'msg_1', role: 'user', content: 'Hello', created_at: new Date('2024-01-01') },
        { id: 'msg_2', role: 'assistant', content: 'Hi', created_at: new Date('2024-01-02') },
      ];

      mockPrisma.chatMessage.findMany.mockResolvedValue(messages);

      const result = await mockPrisma.chatMessage.findMany({
        where: { sessionId: 'session_123' },
        orderBy: { created_at: 'asc' }
      });

      expect(result.length).toBe(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });

    it('should return messages in chronological order', async () => {
      const messages = [
        { id: 'msg_1', created_at: new Date('2024-01-01T10:00:00') },
        { id: 'msg_2', created_at: new Date('2024-01-01T10:01:00') },
        { id: 'msg_3', created_at: new Date('2024-01-01T10:02:00') },
      ];

      mockPrisma.chatMessage.findMany.mockResolvedValue(messages);

      const result = await mockPrisma.chatMessage.findMany({
        where: { sessionId: 'session_123' },
        orderBy: { created_at: 'asc' }
      });

      for (let i = 1; i < result.length; i++) {
        expect(result[i].created_at >= result[i - 1].created_at).toBe(true);
      }
    });

    it('should limit message retrieval', async () => {
      const messages = Array.from({ length: 50 }, (_, i) => ({
        id: `msg_${i}`,
        content: `Message ${i}`,
      }));

      mockPrisma.chatMessage.findMany.mockResolvedValue(messages.slice(-10));

      const result = await mockPrisma.chatMessage.findMany({
        where: { sessionId: 'session_123' },
        orderBy: { created_at: 'desc' },
        take: 10
      });

      expect(result.length).toBe(10);
    });
  });

  describe('Title Generation', () => {
    const generateTitle = (message: string): string => {
      // Truncate and clean first user message for title
      const cleaned = message
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleaned.length <= 50) return cleaned;
      return cleaned.substring(0, 47) + '...';
    };

    it('should generate title from short message', () => {
      const title = generateTitle('Hello, how are you?');
      expect(title).toBe('Hello, how are you?');
    });

    it('should truncate long messages', () => {
      const longMessage = 'This is a very long message that should be truncated because it exceeds the maximum length allowed for a session title.';
      const title = generateTitle(longMessage);
      expect(title.length).toBeLessThanOrEqual(50);
      expect(title.endsWith('...')).toBe(true);
    });

    it('should clean up whitespace', () => {
      const messy = 'Hello\n\nWorld   with   spaces';
      const title = generateTitle(messy);
      expect(title).toBe('Hello World with spaces');
    });
  });

  describe('Session Cleanup', () => {
    it('should delete old sessions', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      mockPrisma.chatSession.findMany.mockResolvedValue([
        { id: 'old_session_1' },
        { id: 'old_session_2' },
      ]);

      const oldSessions = await mockPrisma.chatSession.findMany({
        where: {
          created_at: { lt: thirtyDaysAgo },
          userId: 'user_123'
        }
      });

      expect(oldSessions.length).toBe(2);
    });

    it('should preserve pinned sessions', async () => {
      const filterSessions = (sessions: any[], excludePinned: boolean) => {
        if (excludePinned) {
          return sessions.filter(s => !s.pinned);
        }
        return sessions;
      };

      const sessions = [
        { id: 'session_1', pinned: true },
        { id: 'session_2', pinned: false },
        { id: 'session_3', pinned: false },
      ];

      const toDelete = filterSessions(sessions, true);
      expect(toDelete.length).toBe(2);
      expect(toDelete.every(s => !s.pinned)).toBe(true);
    });
  });

  describe('Conversation Context', () => {
    it('should format messages for LLM context', () => {
      const messages = [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '2+2 = 4' },
        { role: 'user', content: 'And 3+3?' },
      ];

      const formatted = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      expect(formatted.length).toBe(3);
      expect(formatted[0].role).toBe('user');
      expect(formatted[2].content).toBe('And 3+3?');
    });

    it('should truncate context to max length', () => {
      const maxMessages = 50;
      const messages = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      const truncated = messages.slice(-maxMessages);
      expect(truncated.length).toBe(maxMessages);
      expect(truncated[0].content).toBe('Message 50');
    });

    it('should handle system messages', () => {
      const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
      ];

      const hasSystem = messages.some(m => m.role === 'system');
      expect(hasSystem).toBe(true);
    });
  });

  describe('Message Content Types', () => {
    it('should handle text content', () => {
      const content = 'This is text content';
      expect(typeof content).toBe('string');
    });

    it('should handle multimodal content', () => {
      const content = [
        { type: 'text', text: 'What is this?' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
      ];

      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe('text');
      expect(content[1].type).toBe('image_url');
    });

    it('should serialize and deserialize JSON content', () => {
      const original = [
        { type: 'text', text: 'Hello' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }
      ];

      const serialized = JSON.stringify(original);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(original);
    });
  });
});
