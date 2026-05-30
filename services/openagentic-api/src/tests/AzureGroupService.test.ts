import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Azure Identity - must be hoisted
vi.mock('@azure/identity', () => {
  const mockGetToken = vi.fn();
  const mockDefaultAzureCredential = vi.fn().mockImplementation(() => ({
    getToken: mockGetToken
  }));
  
  return {
    DefaultAzureCredential: mockDefaultAzureCredential,
    mockGetToken // Export for use in tests
  };
});

// Mock fetch
global.fetch = vi.fn();

import { AzureGroupService } from '../services/AzureGroupService.js';

describe('AzureGroupService', () => {
  let azureGroupService: AzureGroupService;
  let mockGetToken: any;

  beforeEach(async () => {
    // Get the mocked function from the module
    const azureIdentityModule = await vi.importMock('@azure/identity');
    mockGetToken = azureIdentityModule.mockGetToken;
    
    azureGroupService = new AzureGroupService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getUserGroups', () => {
    it('should return user groups from Microsoft Graph API', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const mockToken = 'mock-access-token';
      const mockGroups = {
        value: [
          {
            id: 'group1-id',
            displayName: 'Developers',
            mail: 'developers@company.com'
          },
          {
            id: 'group2-id', 
            displayName: 'Admins',
            mail: 'admins@company.com'
          }
        ]
      };

      mockGetToken.mockResolvedValueOnce({ token: mockToken });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      // Act
      const result = await azureGroupService.getUserGroups(userId);

      // Assert
      expect(result).toEqual([
        {
          id: 'group1-id',
          displayName: 'Developers',
          mail: 'developers@company.com'
        },
        {
          id: 'group2-id',
          displayName: 'Admins', 
          mail: 'admins@company.com'
        }
      ]);

      expect(global.fetch).toHaveBeenCalledWith(
        `https://graph.microsoft.com/v1.0/users/${userId}/memberOf/microsoft.graph.group?$select=id,displayName,mail`,
        {
          headers: {
            'Authorization': `Bearer ${mockToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const mockToken = 'mock-access-token';

      mockGetToken.mockResolvedValueOnce({ token: mockToken });
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      // Act
      const result = await azureGroupService.getUserGroups(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle authentication errors', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const error = new Error('Authentication failed');

      mockGetToken.mockRejectedValueOnce(error);

      // Act
      const result = await azureGroupService.getUserGroups(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle network errors', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const mockToken = 'mock-access-token';

      mockGetToken.mockResolvedValueOnce({ token: mockToken });
      (global.fetch as any).mockRejectedValueOnce(new Error('Network error'));

      // Act
      const result = await azureGroupService.getUserGroups(userId);

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array for null or undefined userId', async () => {
      // Act & Assert
      expect(await azureGroupService.getUserGroups(null as any)).toEqual([]);
      expect(await azureGroupService.getUserGroups(undefined as any)).toEqual([]);
      expect(await azureGroupService.getUserGroups('')).toEqual([]);
    });

    it('should cache results for the same user', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const mockToken = 'mock-access-token';
      const mockGroups = {
        value: [
          {
            id: 'group1-id',
            displayName: 'Developers',
            mail: 'developers@company.com'
          }
        ]
      };

      mockGetToken.mockResolvedValue({ token: mockToken });
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      // Act
      const result1 = await azureGroupService.getUserGroups(userId);
      const result2 = await azureGroupService.getUserGroups(userId);

      // Assert
      expect(result1).toEqual(result2);
      expect(global.fetch).toHaveBeenCalledTimes(1); // Should be cached
    });
  });

  describe('getGroupsByDisplayName', () => {
    it('should return groups filtered by display names', async () => {
      // Arrange
      const groupNames = ['Developers', 'Admins'];
      const mockToken = 'mock-access-token';
      const mockGroups = {
        value: [
          {
            id: 'group1-id',
            displayName: 'Developers',
            mail: 'developers@company.com'
          },
          {
            id: 'group2-id',
            displayName: 'Admins', 
            mail: 'admins@company.com'
          },
          {
            id: 'group3-id',
            displayName: 'Others',
            mail: 'others@company.com'
          }
        ]
      };

      mockGetToken.mockResolvedValueOnce({ token: mockToken });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      // Act
      const result = await azureGroupService.getGroupsByDisplayName(groupNames);

      // Assert
      expect(result).toEqual([
        {
          id: 'group1-id',
          displayName: 'Developers',
          mail: 'developers@company.com'
        },
        {
          id: 'group2-id',
          displayName: 'Admins',
          mail: 'admins@company.com'
        }
      ]);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/groups?$select=id,displayName,mail&$filter=' + 
        encodeURIComponent("displayName eq 'Developers' or displayName eq 'Admins'"),
        {
          headers: {
            'Authorization': `Bearer ${mockToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should handle empty group names array', async () => {
      // Act
      const result = await azureGroupService.getGroupsByDisplayName([]);

      // Assert
      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('isUserInGroup', () => {
    it('should return true if user is in the specified group', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const groupId = 'group1-id';

      // Mock getUserGroups to return groups containing the target group
      vi.spyOn(azureGroupService, 'getUserGroups').mockResolvedValueOnce([
        {
          id: 'group1-id',
          displayName: 'Developers',
          mail: 'developers@company.com'
        },
        {
          id: 'group2-id',
          displayName: 'Others',
          mail: 'others@company.com'
        }
      ]);

      // Act
      const result = await azureGroupService.isUserInGroup(userId, groupId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false if user is not in the specified group', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const groupId = 'group-not-member';

      // Mock getUserGroups to return groups not containing the target group  
      vi.spyOn(azureGroupService, 'getUserGroups').mockResolvedValueOnce([
        {
          id: 'group1-id',
          displayName: 'Developers',
          mail: 'developers@company.com'
        }
      ]);

      // Act
      const result = await azureGroupService.isUserInGroup(userId, groupId);

      // Assert
      expect(result).toBe(false);
    });

    it('should handle errors gracefully and return false', async () => {
      // Arrange
      const userId = 'test-user-oid';
      const groupId = 'group1-id';

      // Mock getUserGroups to throw an error
      vi.spyOn(azureGroupService, 'getUserGroups').mockRejectedValueOnce(new Error('API error'));

      // Act
      const result = await azureGroupService.isUserInGroup(userId, groupId);

      // Assert
      expect(result).toBe(false);
    });
  });
});