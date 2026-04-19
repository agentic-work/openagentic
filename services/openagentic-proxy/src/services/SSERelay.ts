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

    return () => {
      // Fire-and-forget cleanup on disconnect. Errors swallowed intentionally —
      // the client has already disconnected; there's nothing to report to.
      redis.unsubscribe(channel).catch(() => {});
      redis.quit().catch(() => {});
    };
  }
}
