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

import { getRedis } from '../utils/redis';
import { logger } from '../utils/logger';

const CHANNEL_PREFIX = 'agent:exec:';

export class SSERelay {
  private executionId: string;

  constructor(executionId: string) {
    this.executionId = executionId;
  }

  get channel(): string {
    return `${CHANNEL_PREFIX}${this.executionId}`;
  }

  async emit(event: string, data: any): Promise<void> {
    try {
      const redis = getRedis();
      const message = JSON.stringify({ event, data, timestamp: Date.now() });
      await redis.publish(this.channel, message);
    } catch (err) {
      logger.error({ err, event, executionId: this.executionId }, 'SSERelay: Failed to publish');
    }
  }

  static async subscribe(
    executionId: string,
    callback: (event: string, data: any) => void
  ): Promise<() => void> {
    const redis = getRedis().duplicate();
    const channel = `${CHANNEL_PREFIX}${executionId}`;

    await redis.subscribe(channel);
    redis.on('message', (_ch: string, message: string) => {
      try {
        const parsed = JSON.parse(message);
        callback(parsed.event, parsed.data);
      } catch {
        logger.warn({ message }, 'SSERelay: Failed to parse message');
      }
    });

    return async () => {
      await redis.unsubscribe(channel);
      await redis.quit();
    };
  }
}
