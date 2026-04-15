/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * UserMemoryService client for the workflow service.
 * Delegates to the main API service's /api/user-memory endpoints via HTTP.
 */
import axios from 'axios';

const API_URL = process.env.API_URL || 'http://openagentic-api:8000';

class WorkflowMemoryClient {
  async ingest(
    userId: string,
    source: string,
    sourceId: string | undefined,
    content: string,
    importance: number = 0.5,
  ): Promise<void> {
    try {
      await axios.post(
        `${API_URL}/api/user-memory/ingest`,
        { userId, source, sourceId, content, importance },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': process.env.INTERNAL_SECRET || 'openagentic-internal',
          },
          timeout: 5000,
        },
      );
    } catch {
      // Silent fail — memory ingestion is non-critical
    }
  }

  async getContext(
    userId: string,
    query: string,
    tokenBudget?: number,
  ): Promise<string> {
    try {
      const resp = await axios.get(`${API_URL}/api/user-memory/context`, {
        params: { userId, query, tokenBudget },
        headers: {
          'X-Internal-Secret': process.env.INTERNAL_SECRET || 'openagentic-internal',
        },
        timeout: 5000,
      });
      return resp.data?.context || '';
    } catch {
      return '';
    }
  }
}

let _instance: WorkflowMemoryClient | null = null;

export function getUserMemoryService(): WorkflowMemoryClient {
  if (!_instance) {
    _instance = new WorkflowMemoryClient();
  }
  return _instance;
}
