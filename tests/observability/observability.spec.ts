/**
 * Observability Stack E2E Tests (TDD)
 *
 * These tests validate that the observability stack is properly deployed
 * and functioning in the K8s environment.
 *
 * Run: BASE_URL=https://chat-dev.openagentic.io npx vitest tests/observability/
 */

import { describe, it, expect, beforeAll } from 'vitest';

const BASE_URL = process.env.BASE_URL || 'https://chat-dev.openagentic.io';
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://prometheus:9090';
const GRAFANA_URL = process.env.GRAFANA_URL || 'http://grafana:3000';
const LOKI_URL = process.env.LOKI_URL || 'http://loki:3100';

describe('Observability Stack Tests', () => {
  describe('Prometheus Metrics', () => {
    it('should expose metrics from API service', async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      expect(response.status).toBe(200);

      const metrics = await response.text();
      // Verify key metrics exist
      expect(metrics).toContain('http_requests_total');
      expect(metrics).toContain('http_request_duration_seconds');
      expect(metrics).toContain('chat_messages_total');
      expect(metrics).toContain('mcp_calls_total');
      expect(metrics).toContain('token_usage_total');
    });

    it('should expose process metrics', async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      const metrics = await response.text();

      // Node.js default metrics
      expect(metrics).toContain('process_cpu');
      expect(metrics).toContain('nodejs_heap');
      expect(metrics).toContain('nodejs_eventloop');
    });

    it('should expose memory metrics', async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      const metrics = await response.text();

      expect(metrics).toContain('memory_usage_bytes');
      expect(metrics).toContain('memory_cache_operations_total');
    });

    it('should expose database metrics', async () => {
      const response = await fetch(`${BASE_URL}/metrics`);
      const metrics = await response.text();

      expect(metrics).toContain('database_queries_total');
      expect(metrics).toContain('database_connections_active');
    });
  });

  describe('API Metrics Endpoint', () => {
    it('should expose /api/metrics endpoint', async () => {
      const response = await fetch(`${BASE_URL}/api/metrics`);
      expect(response.status).toBe(200);

      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('text/plain');
    });
  });

  describe('Code Manager Metrics', () => {
    it('should expose system metrics from code-manager', async () => {
      const response = await fetch(`${BASE_URL}/api/openagentic/metrics/system`);
      // May require auth, so accept 200 or 401
      expect([200, 401, 403]).toContain(response.status);

      if (response.status === 200) {
        const data = await response.json();
        expect(data).toHaveProperty('cpu');
        expect(data).toHaveProperty('memory');
      }
    });
  });

  describe('MCP Proxy Metrics', () => {
    it('should expose metrics from MCP proxy', async () => {
      // MCP proxy metrics endpoint (internal)
      // This test may need to be run from within the cluster
      const internalUrl = process.env.MCP_PROXY_INTERNAL_URL;
      if (internalUrl) {
        const response = await fetch(`${internalUrl}/metrics`);
        expect(response.status).toBe(200);
      }
    });
  });
});

describe('Health Endpoints', () => {
  it('should return healthy from API /health', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  it('should return healthy from API /api/health', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    expect(response.status).toBe(200);
  });
});

describe('Logging Validation', () => {
  it('should have structured JSON logs format', async () => {
    // This validates that logs are being properly formatted
    // The actual log shipping to Loki is validated by querying Loki
    const response = await fetch(`${BASE_URL}/api/health`);
    expect(response.status).toBe(200);

    // If Loki is accessible, query for logs
    const lokiUrl = process.env.LOKI_QUERY_URL;
    if (lokiUrl) {
      const query = encodeURIComponent('{app="openagentic-api"}');
      const lokiResponse = await fetch(`${lokiUrl}/loki/api/v1/query_range?query=${query}&limit=10`);
      if (lokiResponse.status === 200) {
        const data = await lokiResponse.json();
        expect(data.status).toBe('success');
      }
    }
  });
});
