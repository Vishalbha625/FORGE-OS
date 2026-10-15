import { CircuitOpenError } from './circuitBreaker';

// Retry with exponential backoff and jitter, for transient network and server errors.

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called before each wait, e.g. for logging. `attempt` is 1 for the first retry. */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

// Only transient statuses are retried. Client errors (400, 401, 403, 404, 409,
// 422 and any other status) never are: retrying cannot change the answer.
const RETRY = new Set([408, 429, 500, 502, 503, 504]);

/** HTTP status carried on an error object (fetch wrappers and Supabase errors use `.status`). */
export function errorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export function isRetryable(err: unknown): boolean {
  // An open circuit already means "stop calling": waiting here would only stall the UI.
  if (err instanceof CircuitOpenError) return false;
  const status = errorStatus(err);
  if (status === undefined) return true; // network failure or unknown error
  return RETRY.has(status);
}

/** Delay before retry number `attempt` (0-based): min(base * 2^attempt + jitter, max). */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const jitter = Math.random() * baseDelayMs;
  return Math.min(baseDelayMs * 2 ** attempt + jitter, maxDelayMs);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryable(err)) throw err;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
}
