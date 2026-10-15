// Token bucket with a full refill per interval (not a per-token drip).
// The interval starts at the first request after a refill, so an idle bucket
// is always full. Client-side only: the server must still protect itself.

export interface ConsumeResult {
  allowed: boolean;
  remainingTokens: number;
  /** 0 when allowed; otherwise ms until the bucket refills. */
  retryAfterMs: number;
}

export class TokenBucket {
  private readonly maxTokens: number;
  private readonly refillIntervalMs: number;
  private tokens: number;
  private windowStart: number | undefined;

  constructor(maxTokens: number, refillIntervalMs: number) {
    this.maxTokens = maxTokens;
    this.refillIntervalMs = refillIntervalMs;
    this.tokens = maxTokens;
  }

  tryConsume(): ConsumeResult {
    const now = Date.now();
    this.refill(now);
    if (this.tokens > 0) {
      if (this.windowStart === undefined) this.windowStart = now;
      this.tokens--;
      return { allowed: true, remainingTokens: this.tokens, retryAfterMs: 0 };
    }
    const retryAfterMs = Math.max(0, (this.windowStart ?? now) + this.refillIntervalMs - now);
    return { allowed: false, remainingTokens: 0, retryAfterMs };
  }

  getRemainingTokens(): number {
    this.refill(Date.now());
    return this.tokens;
  }

  private refill(now: number): void {
    if (this.windowStart !== undefined && now - this.windowStart >= this.refillIntervalMs) {
      this.tokens = this.maxTokens;
      this.windowStart = undefined;
    }
  }
}

/** 10 AI coach questions per hour. */
export const coachRateLimiter = new TokenBucket(10, 60 * 60 * 1000);
