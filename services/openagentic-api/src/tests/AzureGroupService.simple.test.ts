import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AzureGroupService } from '../services/AzureGroupService.js';

// Mock the Azure credential
const mockCredential = {
  getToken: vi.fn()
};

// Mock the constructor
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(() => mockCredential)
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('AzureGroupService', () => {
  let service: AzureGroupService;

  beforeEach(() => {
    service = new AzureGroupService();
    vi.resetAllMocks();
  });

  describe('getUserGroups', () => {
    it('should return empty array for invalid userId', async () => {
      expect(await service.getUserGroups('')).toEqual([]);
      expect(await service.getUserGroups(null as any)).toEqual([]);
      expect(await service.getUserGroups(undefined as any)).toEqual([]);
    });

    it('should return groups when API call succeeds', async () => {
      // Arrange
      const mockGroups = {
        value: [
          { id: 'group1', displayName: 'Developers', mail: 'dev@company.com' },
          { id: 'group2', displayName: 'Admins', mail: 'admin@company.com' }
        ]
      };

      mockCredential.getToken.mockResolvedValueOnce({ token: 'mock-token' });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      // Act
      const result = await service.getUserGroups('user123');

      // Assert
      expect(result).toEqual(mockGroups.value);
      expect(mockCredential.getToken).toHaveBeenCalledWith(['https://graph.microsoft.com/.default']);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/users/user123/memberOf/microsoft.graph.group?$select=id,displayName,mail',
        {
          headers: {
            'Authorization': 'Bearer mock-token',
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should return empty array when API call fails', async () => {
      // Arrange
      mockCredential.getToken.mockResolvedValueOnce({ token: 'mock-token' });
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });

      // Act
      const result = await service.getUserGroups('user123');

      // Assert
      expect(result).toEqual([]);
    });

    it('should return empty array when token acquisition fails', async () => {
      // Arrange
      mockCredential.getToken.mockRejectedValueOnce(new Error('Auth failed'));

      // Act
      const result = await service.getUserGroups('user123');

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('getGroupsByDisplayName', () => {
    it('should return empty array for empty input', async () => {
      expect(await service.getGroupsByDisplayName([])).toEqual([]);
    });

    it('should return filtered groups', async () => {
      // Arrange
      const mockGroups = {
        value: [
          { id: 'group1', displayName: 'Developers', mail: 'dev@company.com' },
          { id: 'group2', displayName: 'Admins', mail: 'admin@company.com' }
        ]
      };

      mockCredential.getToken.mockResolvedValueOnce({ token: 'mock-token' });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      // Act
      const result = await service.getGroupsByDisplayName(['Developers', 'Admins']);

      // Assert
      expect(result).toEqual(mockGroups.value);
      
      const expectedFilter = encodeURIComponent("displayName eq 'Developers' or displayName eq 'Admins'");
      expect(global.fetch).toHaveBeenCalledWith(
        `https://graph.microsoft.com/v1.0/groups?$select=id,displayName,mail&$filter=${expectedFilter}`,
        {
          headers: {
            'Authorization': 'Bearer mock-token',
            'Content-Type': 'application/json'
          }
        }
      );
    });
  });

  describe('isUserInGroup', () => {
    it('should return true when user is in group', async () => {
      // Mock getUserGroups
      vi.spyOn(service, 'getUserGroups').mockResolvedValueOnce([
        { id: 'group1', displayName: 'Developers', mail: 'dev@company.com' },
        { id: 'group2', displayName: 'Admins', mail: 'admin@company.com' }
      ]);

      const result = await service.isUserInGroup('user123', 'group1');
      expect(result).toBe(true);
    });

    it('should return false when user is not in group', async () => {
      // Mock getUserGroups
      vi.spyOn(service, 'getUserGroups').mockResolvedValueOnce([
        { id: 'group1', displayName: 'Developers', mail: 'dev@company.com' }
      ]);

      const result = await service.isUserInGroup('user123', 'group2');
      expect(result).toBe(false);
    });

    it('should return false when getUserGroups fails', async () => {
      // Mock getUserGroups to throw error
      vi.spyOn(service, 'getUserGroups').mockRejectedValueOnce(new Error('API error'));

      const result = await service.isUserInGroup('user123', 'group1');
      expect(result).toBe(false);
    });
  });

  describe('cache functionality', () => {
    it('should cache user groups', async () => {
      // Arrange
      const mockGroups = {
        value: [{ id: 'group1', displayName: 'Developers' }]
      };

      mockCredential.getToken.mockResolvedValue({ token: 'mock-token' });
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      // Act - call twice
      await service.getUserGroups('user123');
      await service.getUserGroups('user123');

      // Assert - should only call API once due to caching
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should clear cache for specific user', async () => {
      // First populate cache
      const mockGroups = { value: [{ id: 'group1', displayName: 'Developers' }] };
      mockCredential.getToken.mockResolvedValue({ token: 'mock-token' });
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockGroups)
      });

      await service.getUserGroups('user123');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Clear cache and call again
      service.clearUserCache('user123');
      await service.getUserGroups('user123');
      
      // Should call API again since cache was cleared
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });
});