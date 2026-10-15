import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../lib/coach', () => ({
  answerQuestion: vi.fn(() => ({ text: 'Rule answer from your logs.', tags: ['fact'] })),
}));
vi.mock('../lib/coachContext', () => ({
  buildAIContext: vi.fn(() => ({ summary: true, running: { thisWeekKm: 12.5 } })),
}));

import { askCoach, checkCoachHealth, getRemainingQuestions } from '../lib/coachService';
import { coachCircuit } from '../lib/circuitBreaker';
import { coachRateLimiter } from '../lib/rateLimiter';
import { answerQuestion, type Snapshot } from '../lib/coach';
import { buildAIContext } from '../lib/coachContext';

const snapshot = { today: '2026-10-15' } as Snapshot;
const opts = { settings: null };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  coachCircuit.reset();
  vi.mocked(answerQuestion).mockClear();
  vi.spyOn(coachRateLimiter, 'tryConsume').mockReturnValue({ allowed: true, remainingTokens: 9, retryAfterMs: 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('askCoach', () => {
  it('rule mode answers on the device and never calls the server', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await askCoach('How was my week?', 'rule', snapshot, opts);
    expect(res).toEqual({ text: 'Rule answer from your logs.', tags: ['fact'], source: 'rule-based', fallbackReason: undefined });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI mode with the hourly limit used up says when the next question is available', async () => {
    vi.mocked(coachRateLimiter.tryConsume).mockReturnValue({ allowed: false, remainingTokens: 0, retryAfterMs: 17.2 * 60_000 });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await askCoach('Am I on track?', 'ai', snapshot, opts);
    expect(res).toMatchObject({ source: 'ai', tokensUsed: 0, limited: true });
    expect(res.text).toBe("You've used all 10 questions this hour. The next one is available in 18 minutes. Meanwhile, you can switch to rule-based mode.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI mode with the circuit open falls back to rule-based without spending a question', async () => {
    for (let i = 0; i < 2; i++) await coachCircuit.execute(() => Promise.reject(new Error('down'))).catch(() => {});
    expect(coachCircuit.getState()).toBe('OPEN');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await askCoach('How is my recovery?', 'ai', snapshot, opts);
    expect(res).toMatchObject({ source: 'ai-fallback', text: 'Rule answer from your logs.' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(coachRateLimiter.tryConsume).not.toHaveBeenCalled();
  });

  it('AI mode network error falls back to rule-based and counts against the circuit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const res = await askCoach('What should I eat today?', 'ai', snapshot, opts);
    expect(res).toMatchObject({ source: 'ai-fallback', fallbackReason: 'could not reach the AI coach', text: 'Rule answer from your logs.' });
    await askCoach('Again?', 'ai', snapshot, opts);
    expect(coachCircuit.getState()).toBe('OPEN'); // 2 failures
  });

  it('AI mode success returns the server answer, tokens used, and sends only the summary context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { answer: 'You ran **12.5 km** this week.', tokensUsed: 1834, model: 'm' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await askCoach('How was my week?', 'ai', snapshot, { settings: null, history: [{ role: 'user', text: 'hi' }] });
    expect(res).toEqual({ text: 'You ran **12.5 km** this week.', source: 'ai', tokensUsed: 1834 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coach');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ question: 'How was my week?', context: { summary: true, running: { thisWeekKm: 12.5 } }, history: [{ role: 'user', text: 'hi' }] });
    expect(buildAIContext).toHaveBeenCalledWith(snapshot);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a wrong access token falls back without tripping the circuit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: 'Access token missing or wrong.' })));
    for (let i = 0; i < 3; i++) {
      const res = await askCoach('Hi', 'ai', snapshot, opts);
      expect(res).toMatchObject({ source: 'ai-fallback', fallbackReason: 'Access token missing or wrong.' });
    }
    expect(coachCircuit.getState()).toBe('CLOSED');
  });
});

describe('checkCoachHealth', () => {
  it('a timeout means the server is probably asleep', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    expect(await checkCoachHealth(null, 20)).toEqual({ available: false, sleeping: true });
  });

  it('a server that answers is available; a missing one (HTML 404) is not, and is not "asleep"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { ok: true, keyPresent: true, authRequired: false })));
    expect(await checkCoachHealth(null)).toEqual({ available: true, sleeping: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', { status: 404 })));
    expect(await checkCoachHealth(null)).toEqual({ available: false, sleeping: false });
  });
});

describe('getRemainingQuestions', () => {
  it('reads the hourly allowance from the rate limiter', () => {
    vi.spyOn(coachRateLimiter, 'getRemainingTokens').mockReturnValue(7);
    vi.spyOn(coachRateLimiter, 'msUntilRefill').mockReturnValue(30.5 * 60_000);
    expect(getRemainingQuestions()).toEqual({ remaining: 7, resetInMinutes: 31 });
  });
});
