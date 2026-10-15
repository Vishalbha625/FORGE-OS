import { describe, it, expect, vi, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../lib/circuitBreaker';

const fail = () => Promise.reject(new Error('down'));
const ok = () => Promise.resolve('ok');

afterEach(() => vi.restoreAllMocks());

describe('circuit breaker', () => {
  it('starts CLOSED and passes results through', async () => {
    const cb = new CircuitBreaker({ name: 'test' });
    expect(cb.getState()).toBe('CLOSED');
    await expect(cb.execute(ok)).resolves.toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after the failure threshold and then rejects without calling fn', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 3 });
    for (let i = 0; i < 3; i++) await expect(cb.execute(fail)).rejects.toThrow('down');
    expect(cb.getState()).toBe('OPEN');
    const fn = vi.fn(ok);
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('moves to HALF_OPEN after the reset timeout; a success closes it, a failure reopens it', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 2, resetTimeoutMs: 60_000 });
    await expect(cb.execute(fail)).rejects.toThrow();
    await expect(cb.execute(fail)).rejects.toThrow();
    now.mockReturnValue(1_000_000 + 59_999);
    expect(cb.getState()).toBe('OPEN');
    now.mockReturnValue(1_000_000 + 60_000);
    expect(cb.getState()).toBe('HALF_OPEN');
    await expect(cb.execute(fail)).rejects.toThrow('down');
    expect(cb.getState()).toBe('OPEN');
    now.mockReturnValue(1_000_000 + 120_000);
    await expect(cb.execute(ok)).resolves.toBe('ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('reset() closes an open circuit', async () => {
    const cb = new CircuitBreaker({ name: 'test', failureThreshold: 1 });
    await expect(cb.execute(fail)).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');
    cb.reset();
    expect(cb.getState()).toBe('CLOSED');
    await expect(cb.execute(ok)).resolves.toBe('ok');
  });
});
