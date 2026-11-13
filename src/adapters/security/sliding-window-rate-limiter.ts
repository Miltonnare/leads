/**
 * Distributed Sliding-Window Rate Limiter Adapter
 * Priority chain:
 *   1. Upstash Redis REST sliding window (if UPSTASH_REDIS_REST_URL & TOKEN are set)
 *   2. Supabase PostgreSQL atomic sliding-window RPC (if Supabase is configured)
 *   3. Process-local sliding-window fallback (for local/unconfigured dev)
 */

import type { RateLimiter, RateLimitResult } from '@/core/ports';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/adapters/database/database.types';

interface MemoryWindowEntry {
  timestamps: number[];
}

export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly memoryStore = new Map<string, MemoryWindowEntry>();

  constructor(private readonly supabase?: SupabaseClient<Database> | null) {}

  async checkAndConsume(
    bucketKey: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
    const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (upstashUrl && upstashToken) {
      try {
        return await this.checkUpstashSlidingWindow(
          upstashUrl,
          upstashToken,
          bucketKey,
          limit,
          windowSeconds
        );
      } catch (err) {
        console.warn('Upstash rate limiter unavailable, falling back:', err);
      }
    }

    if (this.supabase) {
      try {
        const { data, error } = await this.supabase.rpc('check_rate_limit_sliding_window', {
          p_bucket_key: bucketKey,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        });

        if (!error && data && typeof data === 'object') {
          const parsed = data as {
            allowed?: boolean;
            remaining?: number;
            retry_after_seconds?: number;
          };
          return {
            allowed: Boolean(parsed.allowed),
            remaining: Number(parsed.remaining ?? 0),
            retryAfterSeconds: Number(parsed.retry_after_seconds ?? 0),
          };
        }
      } catch (err) {
        console.warn('Supabase rate limiter RPC unavailable, falling back to memory:', err);
      }
    }

    return this.checkMemorySlidingWindow(bucketKey, limit, windowSeconds);
  }

  private async checkUpstashSlidingWindow(
    baseUrl: string,
    token: string,
    bucketKey: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const nowMs = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoffMs = nowMs - windowMs;
    const member = `${nowMs}-${Math.random().toString(36).slice(2, 10)}`;
    const redisKey = `rl:${bucketKey}`;

    const script = [
      "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])",
      "local count = redis.call('ZCARD', KEYS[1])",
      "if count >= tonumber(ARGV[2]) then return count end",
      "redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])",
      "redis.call('PEXPIRE', KEYS[1], ARGV[5])",
      "return count",
    ].join('\n');
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, 1, redisKey, cutoffMs, limit, nowMs, member, windowMs]),
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) throw new Error('Redis rate limiter HTTP ' + res.status);
    const payload: { result?: unknown } = await res.json();
    const currentCount = payload.result;
    if (typeof currentCount !== 'number') throw new Error('Invalid Redis rate limit result');
    if (currentCount >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds / 2)),
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - currentCount - 1),
      retryAfterSeconds: 0,
    };
  }

  private checkMemorySlidingWindow(
    bucketKey: string,
    limit: number,
    windowSeconds: number
  ): RateLimitResult {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const cutoff = now - windowMs;

    const entry = this.memoryStore.get(bucketKey) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

    if (entry.timestamps.length >= limit) {
      const oldest = entry.timestamps[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      this.memoryStore.set(bucketKey, entry);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      };
    }

    entry.timestamps.push(now);
    this.memoryStore.set(bucketKey, entry);

    // Prevent unbounded growth in long-lived local instances
    if (this.memoryStore.size > 5000) {
      for (const [key, val] of this.memoryStore.entries()) {
        if (val.timestamps.every((ts) => ts <= cutoff)) {
          this.memoryStore.delete(key);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - entry.timestamps.length),
      retryAfterSeconds: 0,
    };
  }
}
