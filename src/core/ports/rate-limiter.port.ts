/**
 * Rate Limiter Port
 * Abstract sliding-window rate limiter contract executed before DB writes or telecom dispatches.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  checkAndConsume(
    bucketKey: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult>;
}
