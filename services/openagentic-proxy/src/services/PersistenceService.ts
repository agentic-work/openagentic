/**
 * PersistenceService - Persists agent execution data to the API's database
 * via internal HTTP calls. Uses the AgentExecution and AgentAuditLog Prisma models.
 */

import axios from 'axios';
import { logger } from '../utils/logger';

const API_URL = process.env.API_URL || 'http://openagentic-api:8000';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

function internalHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Service': 'openagentic-proxy',
    ...(INTERNAL_SECRET ? { 'X-Internal-Secret': INTERNAL_SECRET } : {}),
  };
}

export interface PersistExecutionData {
  executionId: string;
  sessionId?: string;
  userId: string;
  orchestration: string;
  aggregation: string;
  agentSpecs: any[];
  status: string;
  results?: any;
  totalCostCents?: number;
  totalTokens?: number;
  totalDurationMs?: number;
  error?: string;
}

export interface PersistAuditEntry {
  executionId: string;
  agentId: string;
  userId: string;
  actionType: string; // tool_call, llm_completion, delegation, data_access
  actionDetail: any;
  riskLevel?: string;
  costCents?: number;
  tokensUsed?: number;
}

export class PersistenceService {
  /**
   * Persist execution record (upsert — create or update).
   */
  async saveExecution(data: PersistExecutionData): Promise<void> {
    try {
      await axios.post(`${API_URL}/api/internal/agent-executions`, data, {
        headers: internalHeaders(),
        timeout: 5000,
      });
    } catch (err: any) {
      logger.warn({ executionId: data.executionId, error: err.message }, 'Failed to persist execution');
    }
  }

  /**
   * Persist audit log entry.
   */
  async saveAuditEntry(entry: PersistAuditEntry): Promise<void> {
    try {
      await axios.post(`${API_URL}/api/internal/agent-audit-log`, entry, {
        headers: internalHeaders(),
        timeout: 5000,
      });
    } catch (err: any) {
      logger.warn({ executionId: entry.executionId, error: err.message }, 'Failed to persist audit entry');
    }
  }
}
