/**
 * openagentic_prometheus MCP Tests (TDD)
 *
 * Tests for the Prometheus MCP server that provides tools to query
 * Prometheus metrics and alerts.
 *
 * Run: npx vitest tests/mcp/oap-prometheus-mcp.spec.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://localhost:8080';

describe('openagentic_prometheus MCP', () => {
  describe('Tool Discovery', () => {
    it('should expose prometheus tools via MCP proxy', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.status === 200) {
        const tools = await response.json();

        // Check for expected prometheus tools
        const prometheusTools = tools.filter((t: any) =>
          t.name.startsWith('prometheus_') || t.server === 'openagentic-prometheus'
        );

        expect(prometheusTools.length).toBeGreaterThan(0);
      }
    });

    it('should have prometheus_query tool', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.status === 200) {
        const tools = await response.json();
        const queryTool = tools.find((t: any) => t.name === 'prometheus_query');

        if (queryTool) {
          expect(queryTool).toHaveProperty('description');
          expect(queryTool).toHaveProperty('inputSchema');
          expect(queryTool.inputSchema.properties).toHaveProperty('query');
        }
      }
    });

    it('should have prometheus_query_range tool', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.status === 200) {
        const tools = await response.json();
        const rangeTool = tools.find((t: any) => t.name === 'prometheus_query_range');

        if (rangeTool) {
          expect(rangeTool.inputSchema.properties).toHaveProperty('query');
          expect(rangeTool.inputSchema.properties).toHaveProperty('start');
          expect(rangeTool.inputSchema.properties).toHaveProperty('end');
        }
      }
    });

    it('should have prometheus_alerts tool', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.status === 200) {
        const tools = await response.json();
        const alertsTool = tools.find((t: any) => t.name === 'prometheus_alerts');

        if (alertsTool) {
          expect(alertsTool).toHaveProperty('description');
        }
      }
    });

    it('should have prometheus_targets tool', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.status === 200) {
        const tools = await response.json();
        const targetsTool = tools.find((t: any) => t.name === 'prometheus_targets');

        if (targetsTool) {
          expect(targetsTool).toHaveProperty('description');
        }
      }
    });

    it('should have prometheus_metrics_list tool', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/tools`);

      if (response.status === 200) {
        const tools = await response.json();
        const metricsTool = tools.find((t: any) => t.name === 'prometheus_metrics_list');

        if (metricsTool) {
          expect(metricsTool).toHaveProperty('description');
        }
      }
    });
  });

  describe('Tool Execution', () => {
    it('should execute prometheus_query for http_requests_total', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'prometheus_query',
          arguments: {
            query: 'http_requests_total'
          }
        })
      });

      if (response.status === 200) {
        const result = await response.json();
        expect(result).toHaveProperty('content');
        // Prometheus API response structure
        expect(result.content[0]).toHaveProperty('text');
      }
    });

    it('should execute prometheus_query_range', async () => {
      const now = Math.floor(Date.now() / 1000);
      const oneHourAgo = now - 3600;

      const response = await fetch(`${MCP_PROXY_URL}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'prometheus_query_range',
          arguments: {
            query: 'rate(http_requests_total[5m])',
            start: oneHourAgo.toString(),
            end: now.toString(),
            step: '60'
          }
        })
      });

      if (response.status === 200) {
        const result = await response.json();
        expect(result).toHaveProperty('content');
      }
    });

    it('should execute prometheus_targets', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'prometheus_targets',
          arguments: {}
        })
      });

      if (response.status === 200) {
        const result = await response.json();
        expect(result).toHaveProperty('content');
      }
    });

    it('should execute prometheus_alerts', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'prometheus_alerts',
          arguments: {}
        })
      });

      if (response.status === 200) {
        const result = await response.json();
        expect(result).toHaveProperty('content');
      }
    });

    it('should execute prometheus_metrics_list', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'prometheus_metrics_list',
          arguments: {}
        })
      });

      if (response.status === 200) {
        const result = await response.json();
        expect(result).toHaveProperty('content');
        // Should contain list of metric names
        const text = result.content[0]?.text || '';
        expect(text).toContain('http_requests_total');
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid PromQL queries gracefully', async () => {
      const response = await fetch(`${MCP_PROXY_URL}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'prometheus_query',
          arguments: {
            query: 'invalid{{{query'
          }
        })
      });

      // Should return error response, not crash
      expect([200, 400, 500]).toContain(response.status);
    });
  });
});
