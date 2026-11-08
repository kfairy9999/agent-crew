export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket keyed by caller. Refill is continuous across `windowMs`.
 * The Worker keeps one of these per isolate. That stops a single instance
 * from draining a key; it is not an account-wide limiter.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly opts: {
      capacity: number;
      windowMs: number;
      now?: () => number;
    },
  ) {
    if (opts.capacity <= 0) throw new Error("Rate limit capacity must be positive.");
    if (opts.windowMs <= 0) throw new Error("Rate limit window must be positive.");
  }

  get capacity(): number {
    return this.opts.capacity;
  }

  get windowMs(): number {
    return this.opts.windowMs;
  }

  take(key: string, cost = 1): RateLimitDecision {
    const now = this.opts.now?.() ?? Date.now();
    const refillPerMs = this.opts.capacity / this.opts.windowMs;
    const existing = this.buckets.get(key);
    let tokens = this.opts.capacity;
    if (existing) {
      const elapsed = Math.max(0, now - existing.updatedAt);
      tokens = Math.min(this.opts.capacity, existing.tokens + elapsed * refillPerMs);
    }
    if (tokens < cost) {
      const retryAfterMs = Math.ceil((cost - tokens) / refillPerMs);
      this.buckets.set(key, { tokens, updatedAt: now });
      return { allowed: false, retryAfterMs, remaining: Math.floor(tokens) };
    }
    tokens -= cost;
    this.buckets.set(key, { tokens, updatedAt: now });
    return { allowed: true, retryAfterMs: 0, remaining: Math.floor(tokens) };
  }
}
