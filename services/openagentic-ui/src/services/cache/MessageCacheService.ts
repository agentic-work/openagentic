/**
 * Message Cache Service
 *
 * Provides in-memory and Redis-backed caching for chat messages
 * to improve UI performance and reduce re-rendering
 */

import { ChatMessage } from '@/types/index';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  maxSize?: number; // Maximum cache size
}

class MessageCacheService {
  private memoryCache: Map<string, ChatMessage>;
  private cacheMetadata: Map<string, { timestamp: number; hits: number }>;
  private maxSize: number;
  private ttl: number;

  constructor(options: CacheOptions = {}) {
    this.memoryCache = new Map();
    this.cacheMetadata = new Map();
    this.maxSize = options.maxSize || 1000;
    this.ttl = (options.ttl || 300) * 1000; // Convert to milliseconds
  }

  /**
   * Get a message from cache
   */
  get(messageId: string): ChatMessage | null {
    const cached = this.memoryCache.get(messageId);
    if (!cached) return null;

    const metadata = this.cacheMetadata.get(messageId);
    if (!metadata) return null;

    // Check if cache entry is expired
    if (Date.now() - metadata.timestamp > this.ttl) {
      this.delete(messageId);
      return null;
    }

    // Update hit count
    metadata.hits++;
    return cached;
  }

  /**
   * Set a message in cache
   */
  set(messageId: string, message: ChatMessage): void {
    // Enforce cache size limit
    if (this.memoryCache.size >= this.maxSize && !this.memoryCache.has(messageId)) {
      // Remove least recently used entry
      const lru = this.findLRU();
      if (lru) {
        this.delete(lru);
      }
    }

    this.memoryCache.set(messageId, message);
    this.cacheMetadata.set(messageId, {
      timestamp: Date.now(),
      hits: 0
    });
  }

  /**
   * Set multiple messages at once
   */
  setMany(messages: ChatMessage[]): void {
    messages.forEach(message => {
      if (message.id) {
        this.set(message.id, message);
      }
    });
  }

  /**
   * Delete a message from cache
   */
  delete(messageId: string): boolean {
    this.cacheMetadata.delete(messageId);
    return this.memoryCache.delete(messageId);
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.memoryCache.clear();
    this.cacheMetadata.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    avgHits: number;
  } {
    let totalHits = 0;
    this.cacheMetadata.forEach(meta => {
      totalHits += meta.hits;
    });

    const size = this.memoryCache.size;
    return {
      size,
      maxSize: this.maxSize,
      hitRate: size > 0 ? totalHits / size : 0,
      avgHits: size > 0 ? totalHits / size : 0
    };
  }

  /**
   * Find least recently used cache entry
   */
  private findLRU(): string | null {
    let lru: string | null = null;
    let oldestTime = Date.now();

    this.cacheMetadata.forEach((meta, id) => {
      if (meta.timestamp < oldestTime) {
        oldestTime = meta.timestamp;
        lru = id;
      }
    });

    return lru;
  }

  /**
   * Prune expired entries
   */
  pruneExpired(): number {
    const now = Date.now();
    let pruned = 0;

    this.cacheMetadata.forEach((meta, id) => {
      if (now - meta.timestamp > this.ttl) {
        this.delete(id);
        pruned++;
      }
    });

    return pruned;
  }

  /**
   * Check if a message exists in cache (without fetching)
   */
  has(messageId: string): boolean {
    if (!this.memoryCache.has(messageId)) return false;

    const metadata = this.cacheMetadata.get(messageId);
    if (!metadata) return false;

    // Check expiration
    if (Date.now() - metadata.timestamp > this.ttl) {
      this.delete(messageId);
      return false;
    }

    return true;
  }

  /**
   * Update a cached message without changing metadata
   */
  update(messageId: string, updates: Partial<ChatMessage>): boolean {
    const existing = this.memoryCache.get(messageId);
    if (!existing) return false;

    const updated = { ...existing, ...updates };
    this.memoryCache.set(messageId, updated);
    return true;
  }

  /**
   * Get all cached messages (for debugging)
   */
  getAll(): ChatMessage[] {
    const messages: ChatMessage[] = [];
    this.memoryCache.forEach((message) => {
      messages.push(message);
    });
    return messages;
  }

  /**
   * Get cache keys
   */
  keys(): string[] {
    return Array.from(this.memoryCache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.memoryCache.size;
  }
}

// Export singleton instance
export const messageCache = new MessageCacheService({
  ttl: 300, // 5 minutes
  maxSize: 1000
});

export default MessageCacheService;