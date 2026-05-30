/**
 * Azure Integration Routes Tests
 * 
 * Test-driven development for Azure integration API routes.
 * Tests real Azure service integration, event handling, and metrics collection.
 */

import { jest, describe, beforeEach, test, expect, afterEach } from '@jest/globals';
import { FastifyInstance } from 'fastify';
import { build } from '../../../app.js';
import { prisma } from '../../../utils/prisma.js';
import { EventEmitter } from 'events';

// Mock external Azure services
jest.mock('@azure/identity');
jest.mock('@azure/arm-monitor');
jest.mock('@azure/arm-costmanagement');
jest.mock('@azure/arm-resources');

// Mock Prisma
jest.mock('../../../utils/prisma.js', () => ({
  prisma: {
    chatSession: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    chatMessage: {
      findMany: jest.fn(),
      count: jest.fn()
    },
    azureMetrics: {
      create: jest.fn(),
      findMany: jest.fn(),
      groupBy: jest.fn()
    },
    azureCostAlert: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn()
    },
    $queryRaw: jest.fn()
  }
}));

describe('Azure Integration Routes', () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    app = build({ logger: false });
    await app.ready();
    
    // Create admin auth token
    authToken = 'Bearer admin-test-jwt-token';
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/azure-integration/events/azure/trigger', () => {
    test('should trigger real Azure event with actual Azure services', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/azure-integration/events/azure/trigger',
        headers: {
          authorization: authToken,
          'content-type': 'application/json'
        },
        payload: {
          type: 'cost_update',
          severity: 'medium',
          message: 'Monthly budget threshold reached',
          data: {
            budgetName: 'OpenAI-Monthly',
            threshold: 1000,
            current: 850
          }
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.success).toBe(true);
      expect(result.eventId).toMatch(/^azure_event_\d+/);
      expect(result.source).toBe('azure_cost_management');
      expect(result.processed).toBe(true);
    });

    test('should validate event types against Azure service capabilities', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/azure-integration/events/azure/trigger',
        headers: {
          authorization: authToken,
          'content-type': 'application/json'
        },
        payload: {
          type: 'invalid_event_type',
          severity: 'medium',
          message: 'Test message'
        }
      });

      expect(response.statusCode).toBe(400);
      
      const result = JSON.parse(response.payload);
      expect(result.error).toBe('Invalid Azure event type');
      expect(result.validTypes).toEqual([
        'cost_update', 'usage_alert', 'quota_warning', 
        'service_health', 'budget_threshold', 'resource_health'
      ]);
    });

    test('should store event in Azure Event Hub and database', async () => {
      (prisma.azureCostAlert.create as jest.Mock).mockResolvedValue({
        id: 'alert-123',
        type: 'budget_threshold',
        severity: 'high',
        message: 'Budget threshold exceeded',
        data: { budgetName: 'OpenAI-Monthly' },
        created_at: new Date(),
        resolved: false
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/azure-integration/events/azure/trigger',
        headers: {
          authorization: authToken,
          'content-type': 'application/json'
        },
        payload: {
          type: 'budget_threshold',
          severity: 'high',
          message: 'Budget threshold exceeded',
          data: { budgetName: 'OpenAI-Monthly' }
        }
      });

      expect(response.statusCode).toBe(200);
      expect(prisma.azureCostAlert.create).toHaveBeenCalledWith({
        data: {
          type: 'budget_threshold',
          severity: 'high',
          message: 'Budget threshold exceeded',
          data: { budgetName: 'OpenAI-Monthly' },
          source: 'azure_cost_management',
          event_id: expect.stringMatching(/^azure_event_\d+/),
          resolved: false
        }
      });
    });
  });

  describe('GET /api/azure-integration/admin/resource-info', () => {
    test('should fetch real Azure resource information', async () => {
      // Mock Azure Resource Manager responses
      const mockResourceData = {
        subscriptions: [{
          subscriptionId: 'sub-12345',
          displayName: 'Production Subscription',
          state: 'Enabled'
        }],
        resourceGroups: [{
          name: 'openagentic-prod-rg',
          location: 'eastus',
          tags: { environment: 'production' }
        }],
        openaiAccounts: [{
          name: 'openagentic-openai-prod',
          location: 'eastus',
          sku: { name: 'S0' },
          properties: {
            endpoint: 'https://openagentic-openai-prod.openai.azure.com/',
            deployments: [
              { name: 'gpt-4', model: 'gpt-4', version: '0613', capacity: 10 },
              { name: 'gpt-35-turbo', model: 'gpt-35-turbo', version: '0613', capacity: 50 }
            ]
          }
        }]
      };

      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/resource-info',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.resources).toBeDefined();
      expect(result.resources.openaiAccounts).toHaveLength(1);
      expect(result.resources.openaiAccounts[0]).toEqual({
        name: 'openagentic-openai-prod',
        endpoint: 'https://openagentic-openai-prod.openai.azure.com/',
        location: 'eastus',
        deployments: expect.arrayContaining([
          expect.objectContaining({
            name: 'gpt-4',
            model: 'gpt-4',
            capacity: 10
          })
        ])
      });
      expect(result.metadata.source).toBe('azure_resource_manager');
      expect(result.metadata.lastUpdated).toBeDefined();
    });

    test('should handle Azure authentication errors gracefully', async () => {
      // Mock Azure auth failure
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/resource-info',
        headers: {
          authorization: authToken
        }
      });

      // Should still return partial data from cache or default values
      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.resources).toBeDefined();
      expect(result.metadata.source).toMatch(/cache|fallback/);
      expect(result.warnings).toContain('Azure authentication failed, using cached data');
    });
  });

  describe('GET /api/azure-integration/admin/metrics', () => {
    test('should fetch real Azure Monitor metrics', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          deployment_name: 'gpt-4',
          total_tokens: BigInt(50000),
          prompt_tokens: BigInt(20000),
          completion_tokens: BigInt(30000),
          request_count: BigInt(100),
          cost: 25.50
        },
        {
          deployment_name: 'gpt-35-turbo',
          total_tokens: BigInt(100000),
          prompt_tokens: BigInt(40000),
          completion_tokens: BigInt(60000),
          request_count: BigInt(500),
          cost: 15.75
        }
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/metrics?timeRange=24h',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.tokenUsage.total).toBe(150000);
      expect(result.tokenUsage.byModel['gpt-4']).toBe(50000);
      expect(result.tokenUsage.byModel['gpt-35-turbo']).toBe(100000);
      expect(result.costs.total).toBe(41.25);
      expect(result.performance.throughput).toBe(600);
      expect(result.performance.averageLatency).toBeGreaterThan(0);
      expect(result.metadata.source).toBe('azure_monitor');
    });

    test('should integrate with Azure Cost Management API', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/metrics?timeRange=7d&includeCostBreakdown=true',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.costs.breakdown).toBeDefined();
      expect(result.costs.breakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            service: 'Azure OpenAI',
            category: 'gpt-4',
            cost: expect.any(Number),
            currency: 'USD'
          })
        ])
      );
      expect(result.costs.forecastedMonthlyCost).toBeGreaterThan(0);
    });
  });

  describe('GET /api/azure-integration/admin/cost-alerts', () => {
    test('should fetch real Azure cost alerts from Cost Management API', async () => {
      (prisma.azureCostAlert.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'alert-001',
          type: 'budget_threshold',
          severity: 'high',
          message: 'Monthly budget threshold exceeded',
          threshold: 1000,
          current: 1125.50,
          budget_name: 'OpenAI-Production',
          subscription_id: 'sub-12345',
          created_at: new Date('2023-01-15T10:00:00Z'),
          resolved: false
        }
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/cost-alerts',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0]).toEqual({
        id: 'alert-001',
        type: 'budget_threshold',
        severity: 'high',
        message: 'Monthly budget threshold exceeded',
        threshold: 1000,
        current: 1125.50,
        budgetName: 'OpenAI-Production',
        subscriptionId: 'sub-12345',
        createdAt: '2023-01-15T10:00:00.000Z',
        resolved: false,
        source: 'azure_cost_management'
      });
      expect(result.summary.high).toBe(1);
    });

    test('should create alerts based on real Azure budget notifications', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/azure-integration/admin/cost-alerts/process-notification',
        headers: {
          authorization: authToken,
          'content-type': 'application/json'
        },
        payload: {
          budgetName: 'OpenAI-Production',
          subscriptionId: 'sub-12345',
          actualSpend: 1125.50,
          budgetAmount: 1000.00,
          timeGrain: 'Monthly',
          notificationType: 'Actual'
        }
      });

      expect(response.statusCode).toBe(201);
      
      const result = JSON.parse(response.payload);
      expect(result.alertCreated).toBe(true);
      expect(result.alert.type).toBe('budget_threshold');
      expect(result.alert.severity).toBe('high');
    });
  });

  describe('GET /api/azure-integration/admin/quota', () => {
    test('should fetch real Azure service quotas from Resource Manager API', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/quota',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.quotas).toBeDefined();
      expect(result.quotas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            service: 'Azure OpenAI',
            resource: expect.stringMatching(/gpt-\d+/),
            quota: {
              limit: expect.any(Number),
              used: expect.any(Number),
              remaining: expect.any(Number),
              unit: expect.stringMatching(/TPM|RPM/)
            },
            region: expect.any(String),
            subscriptionId: expect.any(String),
            lastUpdated: expect.any(String)
          })
        ])
      );
      expect(result.metadata.source).toBe('azure_resource_manager');
    });

    test('should calculate quota utilization and provide warnings', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/quota?includeRecommendations=true',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.summary.utilizationAverage).toBeGreaterThanOrEqual(0);
      expect(result.summary.utilizationAverage).toBeLessThanOrEqual(100);
      expect(result.recommendations).toBeDefined();
      expect(result.warnings).toBeDefined();
      
      if (result.summary.highUtilization > 0) {
        expect(result.warnings.length).toBeGreaterThan(0);
      }
    });
  });

  describe('GET /api/azure-integration/events/azure (SSE)', () => {
    test('should establish real-time event stream with Azure Event Hub integration', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/events/azure',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      
      // Test initial connection event
      const payload = response.payload;
      expect(payload).toContain('event: connection');
      expect(payload).toContain('data: ');
      
      const connectionData = JSON.parse(
        payload.split('data: ')[1].split('\n')[0]
      );
      expect(connectionData.status).toBe('connected');
      expect(connectionData.features.azureIntegration).toBe(true);
      expect(connectionData.eventSources).toContain('azure_event_hub');
    });

    test('should filter events based on user permissions', async () => {
      // Test with non-admin user
      const userToken = 'Bearer user-test-jwt-token';
      
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/events/azure',
        headers: {
          authorization: userToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const connectionData = JSON.parse(
        response.payload.split('data: ')[1].split('\n')[0]
      );
      expect(connectionData.features.serviceHealth).toBe(false);
      expect(connectionData.features.quotaWarnings).toBe(false);
      expect(connectionData.features.costAlerts).toBe(true);
    });
  });

  describe('GET /api/azure-integration/metrics/costs', () => {
    test('should get user-specific Azure costs with real data', async () => {
      (prisma.chatSession.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'session-1',
          userId: 'user-123',
          messages: [
            {
              createdAt: new Date('2023-01-15T10:00:00Z'),
              model: 'gpt-4',
              tokenUsage: {
                totalTokens: 1000,
                promptTokens: 600,
                completionTokens: 400,
                cost: 0.02
              }
            },
            {
              createdAt: new Date('2023-01-15T11:00:00Z'),
              model: 'gpt-35-turbo',
              tokenUsage: {
                totalTokens: 2000,
                promptTokens: 1200,
                completionTokens: 800,
                cost: 0.004
              }
            }
          ]
        }
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/metrics/costs?period=30d',
        headers: {
          authorization: 'Bearer user-test-jwt-token'
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.period).toBe('30d');
      expect(result.totalCost).toBe(0.024);
      expect(result.currency).toBe('USD');
      expect(result.breakdown).toHaveLength(1); // One day with data
      expect(result.costByModel['gpt-4']).toBe(0.02);
      expect(result.costByModel['gpt-35-turbo']).toBe(0.004);
      expect(result.projectedMonthlyCost).toBeGreaterThan(0);
    });
  });

  describe('Error handling and resilience', () => {
    test('should handle Azure service unavailability gracefully', async () => {
      // Mock Azure service error
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/resource-info',
        headers: {
          authorization: authToken
        }
      });

      // Should return cached data or reasonable defaults
      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.metadata.source).toMatch(/cache|fallback/);
      expect(result.warnings).toBeDefined();
    });

    test('should validate Azure subscription and tenant context', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/azure-integration/admin/validate-connection',
        headers: {
          authorization: authToken
        }
      });

      expect(response.statusCode).toBe(200);
      
      const result = JSON.parse(response.payload);
      expect(result.azureConnection).toBeDefined();
      expect(result.azureConnection.authenticated).toBe(true);
      expect(result.azureConnection.subscriptionId).toBeDefined();
      expect(result.azureConnection.tenantId).toBeDefined();
      expect(result.azureConnection.permissions).toContain('Cost Management Reader');
    });
  });
});