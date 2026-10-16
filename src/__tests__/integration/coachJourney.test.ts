import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askCoach } from '../../lib/coachService';
import { coachCircuit } from '../../lib/circuitBreaker';
import { coachRateLimiter } from '../../lib/rateLimiter';
import { putRecord } from '../../db/database';
import { loadAppData, makeSnapshot } from '../../store/appData';
import type { Settings } from '../../db/types';
import { freshDevice, logRun, onboard, today } from './journeyFixtures';
import { addDays, startOfWeek } from '../../lib/dates';

// Asking the coach about data logged on this device: rule-based answers stay
// local, AI answers send a summary only (R1), and a failing server falls back.

async function setup() {
  const profile = await onboard({ trainingStartDate: startOfWeek(today()), raceDate: addDays(today(), 100) });
  const run = await logRun({ distanceKm: 6.4, durationSec: 2200, notes: 'SECRET-KNEE-NOTE', route: 'SECRET-ROUTE past my house' });
  const loaded = await loadAppData();
  const settings: Settings = { ...loaded.settings!, aiCoachEnabled: true, coachUrl: 'https://coach.test' };
  await putRecord('settings', settings);
  return { profile, run, settings, snapshot: makeSnapshot(loaded.profile, loaded.data, loaded.today) };
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  await freshDevice();
  coachCircuit.reset();
  vi.spyOn(coachRateLimiter, 'tryConsume').mockReturnValue({ allowed: true, remainingTokens: 9, retryAfterMs: 0 });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('coach journey', () => {
  it('rule-based: "How was my week?" is answered from IndexedDB without the network', async () => {
    const { snapshot, settings } = await setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await askCoach('How was my week?', 'rule', snapshot, { settings });
    expect(res.source).toBe('rule-based');
    expect(res.text).toContain('Running: 6.4 km actual');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI: the server gets a summary, never the raw records, and the answer is labelled AI', async () => {
    const { snapshot, settings, run, profile } = await setup();
    const fetchMock = vi.fn(async () => reply(200, { answer: 'Solid week: **6.4 km** so far.', tokensUsed: 412, model: 'test' }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await askCoach('How was my week?', 'ai', snapshot, { settings, history: [] });
    expect(res).toMatchObject({ source: 'ai', text: 'Solid week: **6.4 km** so far.', tokensUsed: 412 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://coach.test/api/coach');
    const body = JSON.parse(String(init.body)) as { question: string; context: unknown; history: unknown[] };
    expect(body.question).toBe('How was my week?');
    expect(JSON.stringify(body.context)).toContain('6.4');
    const sent = String(init.body);
    for (const secret of ['SECRET-KNEE-NOTE', 'SECRET-ROUTE', run.id, profile.id, 'eventDate', 'createdAt']) expect(sent).not.toContain(secret);
  });

  it('AI failure: a server error falls back to the rule-based answer and counts against the circuit', async () => {
    const { snapshot, settings } = await setup();
    const fetchMock = vi.fn(async () => reply(500, { error: 'The AI service failed.' }));
    vi.stubGlobal('fetch', fetchMock);

    const first = await askCoach('How was my week?', 'ai', snapshot, { settings });
    expect(first).toMatchObject({ source: 'ai-fallback', fallbackReason: 'The AI service failed.' });
    expect(first.text).toContain('Running: 6.4 km actual');
    expect(coachCircuit.getState()).toBe('CLOSED');

    await askCoach('How was my week?', 'ai', snapshot, { settings });
    expect(coachCircuit.getState()).toBe('OPEN');

    // While open, the coach answers locally without calling the server.
    const third = await askCoach('How was my week?', 'ai', snapshot, { settings });
    expect(third).toMatchObject({ source: 'ai-fallback', fallbackReason: 'AI coach is resting after repeated errors' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
