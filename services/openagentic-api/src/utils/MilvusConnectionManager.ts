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
 * MilvusConnectionManager - Resilient Milvus connection with auto-reconnect
 *
 * Wraps MilvusClient with:
 * - Automatic reconnection on ECONNREFUSED / UNAVAILABLE errors
 * - Exponential backoff (1s -> 2s -> 4s -> max 30s)
 * - Health check ping every 60s
 * - Circuit breaker after 5 consecutive failures
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { Logger } from 'pino';

export class MilvusConnectionManager {
  private client: MilvusClient | null = null;
  private address: string;
  private username?: string;
  private password?: string;
  private logger: Logger;
  private reconnecting = false;
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 5;
  private readonly maxBackoff = 30_000;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private circuitOpen = false;

  constructor(logger: Logger) {
    this.logger = logger;
    this.address = process.env.MILVUS_ADDRESS ||
      `${process.env.MILVUS_HOST || 'milvus-standalone'}:${process.env.MILVUS_PORT || '19530'}`;
    this.username = process.env.MILVUS_USERNAME || process.env.MILVUS_USER;
    this.password = process.env.MILVUS_PASSWORD;
  }

  async connect(retries = 3, delay = 2000): Promise<MilvusClient> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        if (attempt === 1 || attempt % 5 === 0) {
          this.logger.info(`Milvus connect attempt ${attempt}/${retries} to ${this.address}`);
        }

        const client = new MilvusClient({
          address: this.address,
          username: this.username,
          password: this.password,
          timeout: 30000,
        });

        const health = await client.checkHealth();
        if (health.isHealthy) {
          this.client = client;
          this.consecutiveFailures = 0;
          this.circuitOpen = false;
          this.startHealthCheck();
          this.logger.info(`Milvus connected on attempt ${attempt}`);
          return client;
        }
        throw new Error(`Milvus health check failed: ${JSON.stringify(health)}`);
      } catch (error: any) {
        if (attempt % 5 === 0 || attempt === 1) {
          this.logger.warn({ err: error, attempt }, `Milvus connect attempt ${attempt}/${retries} failed`);
        }
        if (attempt === retries) {
          throw new Error(`Milvus connection failed after ${retries} attempts: ${error.message}`);
        }
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('Milvus connection failed');
  }

  getClient(): MilvusClient | null {
    return this.client;
  }

  isConnected(): boolean {
    return this.client !== null && !this.circuitOpen;
  }

  private startHealthCheck() {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(async () => {
      if (!this.client) return;
      try {
        const health = await this.client.checkHealth();
        if (health.isHealthy) {
          this.consecutiveFailures = 0;
          this.circuitOpen = false;
        } else {
          this.handleFailure('Health check returned unhealthy');
        }
      } catch (error: any) {
        this.handleFailure(error.message);
      }
    }, 60_000);
  }

  private stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private handleFailure(reason: string) {
    this.consecutiveFailures++;
    this.logger.warn({ consecutiveFailures: this.consecutiveFailures, reason }, 'Milvus health check failure');

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.circuitOpen = true;
      this.logger.error(`Milvus circuit breaker OPEN after ${this.consecutiveFailures} failures`);
      this.scheduleReconnect();
    }
  }

  private async scheduleReconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.stopHealthCheck();

    const backoff = Math.min(1000 * Math.pow(2, this.consecutiveFailures - 1), this.maxBackoff);
    this.logger.info(`Scheduling Milvus reconnect in ${backoff}ms`);

    await new Promise(r => setTimeout(r, backoff));

    try {
      await this.connect(3, 2000);
      this.logger.info('Milvus reconnected successfully');
    } catch (error: any) {
      this.logger.error({ err: error }, 'Milvus reconnect failed — will retry on next health check');
      // Restart health check to keep trying
      this.startHealthCheck();
    } finally {
      this.reconnecting = false;
    }
  }

  async close() {
    this.stopHealthCheck();
    if (this.client) {
      try {
        await this.client.closeConnection();
        this.logger.info('Milvus connection closed');
      } catch (error: any) {
        this.logger.warn({ err: error }, 'Error closing Milvus connection');
      }
      this.client = null;
    }
  }
}
