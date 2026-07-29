import crypto from "crypto";
import { env } from "../config/env.js";

export interface CacheProvider<T = any> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  clear(): void;
}

interface CacheItem<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCacheProvider<T = any> implements CacheProvider<T> {
  private cache = new Map<string, CacheItem<T>>();
  private ttl: number; // in milliseconds
  private maxSize: number;

  constructor(ttlSeconds: number = env.EMBEDDING_CACHE_TTL, maxSize: number = env.EMBEDDING_CACHE_MAX_SIZE) {
    this.ttl = ttlSeconds * 1000;
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  set(key: string, value: T): void {
    // Evict oldest or random if over capacity (simple FIFO or size-limit check)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const expiresAt = Date.now() + this.ttl;
    this.cache.set(key, { value, expiresAt });
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Generates a SHA-256 hash for a given piece of text to serve as a cache key.
 */
export function generateHashKey(text: string): string {
  return crypto.createHash("sha256").update(text.trim()).digest("hex");
}

// Single instance for embedding cache
export const embeddingCache = new MemoryCacheProvider<number[]>();
