/**
 * Azure Group Service
 * 
 * Manages Azure Active Directory group membership queries and caching using
 * Microsoft Graph API. Provides efficient group lookups for user authorization
 * and role-based access control with intelligent caching to reduce API calls.
 * 
 * Features:
 * - Azure AD group membership queries via Microsoft Graph API
 * - Intelligent caching system with configurable timeout (5 minutes default)
 * - DefaultAzureCredential integration for seamless authentication
 * - Batch group lookup operations for performance optimization
 * - User group membership validation and authorization support
 * - Automatic token refresh and error handling
 */

import { DefaultAzureCredential } from '@azure/identity';

export interface AzureGroup {
  id: string;
  displayName: string;
  mail?: string;
}

export class AzureGroupService {
  private credential: DefaultAzureCredential;
  private cache: Map<string, { groups: AzureGroup[]; timestamp: number }> = new Map();
  private cacheTimeout: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.credential = new DefaultAzureCredential();
  }

  /**
   * Get access token for Microsoft Graph API
   */
  private async getAccessToken(): Promise<string> {
    const tokenResponse = await this.credential.getToken([
      'https://graph.microsoft.com/.default'
    ]);
    
    if (!tokenResponse) {
      throw new Error('Failed to get access token');
    }
    
    return tokenResponse.token;
  }

  /**
   * Get all groups that a user is a member of
   */
  async getUserGroups(userId: string): Promise<AzureGroup[]> {
    if (!userId) {
      return [];
    }

    try {
      // Check cache first
      const cached = this.cache.get(userId);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.groups;
      }

      const token = await this.getAccessToken();
      
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${userId}/memberOf/microsoft.graph.group?$select=id,displayName,mail`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        console.error(`Failed to get user groups: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json() as { value?: AzureGroup[] };
      const groups: AzureGroup[] = data.value || [];

      // Cache the result
      this.cache.set(userId, {
        groups,
        timestamp: Date.now()
      });

      return groups;
    } catch (error) {
      console.error('Error fetching user groups:', error);
      return [];
    }
  }

  /**
   * Get groups by their display names
   */
  async getGroupsByDisplayName(groupNames: string[]): Promise<AzureGroup[]> {
    if (!groupNames || groupNames.length === 0) {
      return [];
    }

    try {
      const token = await this.getAccessToken();
      
      // Build filter query for multiple group names
      const filterConditions = groupNames.map(name => `displayName eq '${name}'`).join(' or ');
      const filterQuery = encodeURIComponent(filterConditions);
      
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/groups?$select=id,displayName,mail&$filter=${filterQuery}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        console.error(`Failed to get groups by name: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json() as { value?: AzureGroup[] };
      return data.value || [];
    } catch (error) {
      console.error('Error fetching groups by display name:', error);
      return [];
    }
  }

  /**
   * Check if a user is a member of a specific group
   */
  async isUserInGroup(userId: string, groupId: string): Promise<boolean> {
    try {
      const userGroups = await this.getUserGroups(userId);
      return userGroups.some(group => group.id === groupId);
    } catch (error) {
      console.error('Error checking group membership:', error);
      return false;
    }
  }

  /**
   * Get group IDs from display names
   */
  async getGroupIdsByNames(groupNames: string[]): Promise<string[]> {
    try {
      const groups = await this.getGroupsByDisplayName(groupNames);
      return groups.map(group => group.id);
    } catch (error) {
      console.error('Error getting group IDs by names:', error);
      return [];
    }
  }

  /**
   * Clear cache for a specific user
   */
  clearUserCache(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Clear all cached data
   */
  clearAllCache(): void {
    this.cache.clear();
  }

  /**
   * Get cached user groups (for testing/debugging)
   */
  getCachedGroups(userId: string): AzureGroup[] | null {
    const cached = this.cache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.groups;
    }
    return null;
  }
}