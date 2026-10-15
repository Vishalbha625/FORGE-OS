import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '../lib/retry';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const fast = { baseDelayMs: 10, maxDelayMs: 10 };

describe('withRetry', () => {
  it('returns on the first try without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('done');
    await expect(withRetry(fn, fast)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('done');
    await expect(withRetry(fn, fast)).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries a 401', async () => {
    const fn = vi.fn().mockRejectedValue(httpError(401));
    await expect(withRetry(fn, fast)).rejects.toMatchObject({ status: 401 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const fn = vi.fn().mockRejectedValue(httpError(500));
    await expect(withRetry(fn, { ...fast, maxRetries: 3 })).rejects.toMatchObject({ status: 500 });
    expect(fn).toHaveBeenCalledTimes(4); // first try + 3 retries
  });
});
