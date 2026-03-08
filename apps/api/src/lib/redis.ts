/**
 * Shared Redis client + helpers for caching, pub/sub, and atomic counters.
 *
 * All Redis usage flows through this module so there's one connection pool
 * and a consistent API for cache get/set/invalidate.
 */
import { Redis } from 'ioredis';
import { config } from '../config.js';

// ─── Connections ───────────────────────────────────────────────────────────

/** General-purpose client (commands, caching, counters). */
export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,   // required by BullMQ
  enableReadyCheck: true,
  lazyConnect: false,
});

/** Dedicated subscriber client (cannot be shared with command clients). */
export const redisSub = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

/** Dedicated publisher client. */
export const redisPub = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

// ─── Cache helpers ─────────────────────────────────────────────────────────

/**
 * Get a cached JSON value. Returns null on miss.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Set a cached JSON value with a TTL in seconds.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

/**
 * Delete one or more cache keys (supports glob patterns via key array).
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.del(...keys);
}

/**
 * Delete all keys matching a pattern (e.g. "cache:activity:*").
 * Uses SCAN to avoid blocking Redis.
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}

// ─── Atomic counters (for rate limiting) ──────────────────────────────────

/**
 * Increment a daily counter and return the new value.
 * Key auto-expires at end of day (we set TTL to 86400s on first creation).
 */
export async function dailyIncr(key: string): Promise<number> {
  const val = await redis.incr(key);
  if (val === 1) {
    // First call today — set TTL so it auto-cleans tomorrow
    await redis.expire(key, 86_400);
  }
  return val;
}

// ─── Pub/Sub helpers ──────────────────────────────────────────────────────

export function publishJobUpdate(jobId: string, event: string, payload: unknown): void {
  const channel = `job:${jobId}`;
  redisPub.publish(channel, JSON.stringify({ event, data: payload })).catch(() => {});
}

// ─── Graceful shutdown ────────────────────────────────────────────────────

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), redisSub.quit(), redisPub.quit()]);
}
