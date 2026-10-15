import { describe, it, expect, vi, afterEach } from 'vitest';
import { TokenBucket } from '../lib/rateLimiter';

afterEach(() => vi.restoreAllMocks());
const HOUR = 60 * 60 * 1000;

describe('token bucket', () => {
  it('allows requests within the limit and counts down', () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    const bucket = new TokenBucket(3, HOUR);
    expect(bucket.tryConsume()).toEqual({ allowed: true, remainingTokens: 2, retryAfterMs: 0 });
    expect(bucket.tryConsume().remainingTokens).toBe(1);
    expect(bucket.getRemainingTokens()).toBe(1);
  });

  it('blocks once empty and says when to retry', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const bucket = new TokenBucket(2, HOUR);
    bucket.tryConsume();
    bucket.tryConsume();
    now.mockReturnValue(1_000 + 10 * 60 * 1000);
    expect(bucket.tryConsume()).toEqual({ allowed: false, remainingTokens: 0, retryAfterMs: 50 * 60 * 1000 });
  });

  it('refills fully once the interval has passed', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const bucket = new TokenBucket(2, HOUR);
    bucket.tryConsume();
    bucket.tryConsume();
    now.mockReturnValue(HOUR);
    expect(bucket.getRemainingTokens()).toBe(2);
    expect(bucket.tryConsume().allowed).toBe(true);
  });

  it('reports how long until the bucket is full again', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const bucket = new TokenBucket(2, HOUR);
    expect(bucket.msUntilRefill()).toBe(0); // untouched: already full
    bucket.tryConsume();
    now.mockReturnValue(15 * 60 * 1000);
    expect(bucket.msUntilRefill()).toBe(45 * 60 * 1000);
    now.mockReturnValue(HOUR);
    expect(bucket.msUntilRefill()).toBe(0);
  });
});
