// Circuit breaker: stop calling a failing service for a while instead of
// hammering it, then let one trial request through to see if it recovered.
//
// CLOSED ──(failureThreshold failures)──▶ OPEN ──(resetTimeoutMs)──▶ HALF_OPEN
// HALF_OPEN ──(successThreshold successes)──▶ CLOSED,  any failure ──▶ OPEN

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  successThreshold?: number;
}

export class CircuitOpenError extends Error {
  readonly circuit: string;
  readonly retryAfterMs: number;

  constructor(circuit: string, retryAfterMs: number) {
    super(`${circuit} is unavailable right now. Try again in ${Math.ceil(retryAfterMs / 1000)} s.`);
    this.name = 'CircuitOpenError';
    this.circuit = circuit;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly successThreshold: number;
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  constructor(config: CircuitBreakerConfig) {
    this.name = config.name;
    this.failureThreshold = config.failureThreshold ?? 3;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 60_000;
    this.successThreshold = config.successThreshold ?? 1;
  }

  /** Current state, moving OPEN to HALF_OPEN once the reset timeout has passed. */
  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.successes = 0;
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.getState() === 'OPEN') {
      throw new CircuitOpenError(this.name, this.openedAt + this.resetTimeoutMs - Date.now());
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.successes = 0;
    this.openedAt = 0;
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) this.reset();
      return;
    }
    this.failures = 0;
  }

  private onFailure(): void {
    if (this.state === 'HALF_OPEN') {
      this.trip();
      return;
    }
    this.failures++;
    if (this.failures >= this.failureThreshold) this.trip();
  }

  private trip(): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
    this.failures = 0;
    this.successes = 0;
  }
}

export const supabaseCircuit = new CircuitBreaker({ name: 'Community', failureThreshold: 3, resetTimeoutMs: 60_000 });
export const coachCircuit = new CircuitBreaker({ name: 'AI coach', failureThreshold: 2, resetTimeoutMs: 120_000 });
