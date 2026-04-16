import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import pino from 'pino';
import { PromptService } from '../services/PromptService.js';

// Mock dependencies
const mockPool = {
  query: vi.fn(),
  end: vi.fn()
} as unknown as Pool;

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn()
} as unknown as pino.Logger;

describe('PromptService', () => {
  let promptService: PromptService;

  beforeEach(() => {
    promptService = new PromptService(mockPool, mockLogger);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getSystemPromptForUser', () => {
    it('should return user-specific assignment when available', async () => {
      // Arrange
      const userId = 'test-user-123';
      const userMessage = 'Hello, help me with coding';
      
      const mockAssignment = {
        template_id: '1',
        template_name: 'Code Assistant',
        template_content: 'You are a coding assistant.',
        category: 'development',
        description: 'Helps with coding',
        is_default: false,
        custom_prompt: null,
        model_preferences: {
          preferredModels: ['gpt-4o'],
          temperature: 0.3
        }
      };

      (mockPool.query as any).mockResolvedValueOnce({
        rows: [mockAssignment]
      });

      // Act
      const result = await promptService.getSystemPromptForUser(userId, userMessage);

      // Assert
      expect(result.content).toBe('You are a coding assistant.');
      expect(result.promptTemplate?.name).toBe('Code Assistant');
      expect(result.recommendedModel).toBe('gpt-4o');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('user_prompt_assignments'),
        [userId]
      );
    });

    it('should return group assignment when no user assignment exists', async () => {
      // Arrange
      const userId = 'test-user-123';
      const userGroups = ['developers', 'senior-devs'];
      const userMessage = 'Help me debug this code';

      const mockGroupAssignment = {
        template_id: '2',
        template_name: 'Engineering Assistant',
        template_content: 'You are an expert engineer.',
        category: 'engineering',
        description: 'Expert engineering help',
        is_default: false,
        custom_prompt: null,
        model_preferences: {
          preferredModels: ['gpt-4o'],
          temperature: 0.2
        }
      };

      // Mock user assignment query (no results)
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      
      // Mock group assignment query
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [mockGroupAssignment]
      });

      // Act
      const result = await promptService.getSystemPromptForUser(userId, userMessage, userGroups);

      // Assert
      expect(result.content).toBe('You are an expert engineer.');
      expect(result.promptTemplate?.name).toBe('Engineering Assistant');
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(mockPool.query).toHaveBeenNthCalledWith(2,
        expect.stringContaining('group_id = ANY'),
        [userGroups]
      );
    });

    it('should return global assignment when no user or group assignments exist', async () => {
      // Arrange
      const userId = 'test-user-123';
      const userMessage = 'General question';

      const mockGlobalAssignment = {
        template_id: '3',
        template_name: 'Default System Prompt',
        template_content: 'You are a helpful assistant.',
        category: 'system',
        description: 'Default prompt',
        is_default: true,
        custom_prompt: null,
        model_preferences: {
          preferredModels: ['gpt-4o-mini'],
          temperature: 0.7
        }
      };

      // Mock user assignment query (no results)
      (mockPool.query as any).mockResolvedValueOnce({ rows: [] });
      
      // Mock global assignment query
      (mockPool.query as any).mockResolvedValueOnce({
        rows: [mockGlobalAssignment]
      });

      // Act
      const result = await promptService.getSystemPromptForUser(userId, userMessage);

      // Assert
      expect(result.content).toBe('You are a helpful assistant.');
      expect(result.promptTemplate?.name).toBe('Default System Prompt');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("user_id = '__all_users__'"),
        []
      );
    });

    it('should use intelligent routing based on message content when no assignments exist', async () => {
      // Arrange
      const userId = 'test-user-123';
      const userMessage = 'Help me write some code in Python';

      const mockCodeTemplate = {
        id: '4',
        name: 'Code Helper',
        content: 'You are a programming assistant.',
        category: 'development',
        description: 'Coding help',
        is_active: true,
        is_default: false,
        model_preferences: {
          preferredModels: ['gpt-4o'],
          intentKeywords: ['code', 'programming', 'python'],
          temperature: 0.3
        }
      };

      // Mock all assignment queries (no results)
      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [] }) // user assignment
        .mockResolvedValueOnce({ rows: [] }) // global assignment
        .mockResolvedValueOnce({ rows: [mockCodeTemplate] }); // templates for intelligent routing

      // Act
      const result = await promptService.getSystemPromptForUser(userId, userMessage);

      // Assert
      expect(result.content).toBe('You are a programming assistant.');
      expect(result.promptTemplate?.name).toBe('Code Helper');
    });

    it('should return default template as fallback', async () => {
      // Arrange
      const userId = 'test-user-123';
      
      const mockDefaultTemplate = {
        id: '5',
        name: 'System Default',
        content: 'You are a helpful assistant.',
        category: 'general',
        description: 'Default template',
        is_active: true,
        is_default: true,
        model_preferences: {
          preferredModels: ['gpt-4o-mini']
        }
      };

      // Mock all queries to return no results except default template
      (mockPool.query as any)
        .mockResolvedValueOnce({ rows: [] }) // user assignment
        .mockResolvedValueOnce({ rows: [] }) // global assignment
        .mockResolvedValueOnce({ rows: [] }) // intelligent routing templates
        .mockResolvedValueOnce({ rows: [mockDefaultTemplate] }); // default template

      // Act
      const result = await promptService.getSystemPromptForUser(userId);

      // Assert
      expect(result.content).toBe('You are a helpful assistant.');
      expect(result.promptTemplate?.name).toBe('System Default');
    });

    it('should return ultimate fallback when everything fails', async () => {
      // Arrange
      const userId = 'test-user-123';

      // Mock all queries to return no results
      (mockPool.query as any).mockResolvedValue({ rows: [] });

      // Act
      const result = await promptService.getSystemPromptForUser(userId);

      // Assert
      expect(result.content).toBe('You are a helpful assistant.');
      expect(result.promptTemplate).toBeUndefined();
      expect(result.recommendedModel).toBe('auto');
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      const userId = 'test-user-123';
      const error = new Error('Database connection failed');
      
      (mockPool.query as any).mockRejectedValue(error);

      // Act
      const result = await promptService.getSystemPromptForUser(userId);

      // Assert
      expect(result.content).toBe('You are a helpful assistant.');
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching system prompt:', error);
    });

    it('should prefer custom prompt over template content', async () => {
      // Arrange
      const userId = 'test-user-123';
      const customPrompt = 'Custom instructions for this user';
      
      const mockAssignment = {
        template_id: '1',
        template_name: 'Code Assistant',
        template_content: 'You are a coding assistant.',
        category: 'development',
        description: 'Helps with coding',
        is_default: false,
        custom_prompt: customPrompt,
        model_preferences: {}
      };

      (mockPool.query as any).mockResolvedValueOnce({
        rows: [mockAssignment]
      });

      // Act
      const result = await promptService.getSystemPromptForUser(userId);

      // Assert
      expect(result.content).toBe(customPrompt);
    });
  });

  describe('getAllTemplates', () => {
    it('should return all active templates ordered by category and name', async () => {
      // Arrange
      const mockTemplates = [
        {
          id: '1',
          name: 'Business Assistant',
          content: 'Business help',
          category: 'business',
          description: 'Helps with business',
          is_active: true,
          is_default: false,
          model_preferences: {}
        },
        {
          id: '2',
          name: 'Code Assistant',
          content: 'Coding help',
          category: 'development',
          description: 'Helps with coding',
          is_active: true,
          is_default: false,
          model_preferences: {}
        }
      ];

      (mockPool.query as any).mockResolvedValueOnce({
        rows: mockTemplates
      });

      // Act
      const result = await promptService.getAllTemplates();

      // Assert
      expect(result).toEqual(mockTemplates);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = true'),
        []
      );
    });

    it('should handle database errors gracefully', async () => {
      // Arrange
      const error = new Error('Database error');
      (mockPool.query as any).mockRejectedValue(error);

      // Act
      const result = await promptService.getAllTemplates();

      // Assert
      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith('Error fetching all templates:', error);
    });
  });

  describe('ensureDefaultTemplates', () => {
    it('should create default templates without errors', async () => {
      // Arrange
      (mockPool.query as any).mockResolvedValue({ rows: [] });

      // Act
      await promptService.ensureDefaultTemplates();

      // Assert
      // Should be called once for each default template (4 templates)
      expect(mockPool.query).toHaveBeenCalledTimes(4);
      
      // Check that each call includes the expected template data
      const calls = (mockPool.query as any).mock.calls;
      expect(calls[0][1]).toContain('General Assistant');
      expect(calls[1][1]).toContain('Engineering Assistant');
      expect(calls[2][1]).toContain('Business Analyst');
      expect(calls[3][1]).toContain('Creative Assistant');
    });

    it('should handle database errors for individual templates', async () => {
      // Arrange
      const error = new Error('Template creation failed');
      (mockPool.query as any).mockRejectedValue(error);

      // Act
      await promptService.ensureDefaultTemplates();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledTimes(4); // One error per template
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error creating default template'),
        error
      );
    });
  });
});