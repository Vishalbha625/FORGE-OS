import { answerQuestion, type Snapshot } from './coach';
import { buildAIContext } from './coachContext';
import { coachCircuit } from './circuitBreaker';
import { coachRateLimiter } from './rateLimiter';
import { coachBaseUrl, coachFetch } from './coachApi';
import type { Settings } from '../db/types';

// One entry point for the coach. Rule-based answers come from the data on this
// device and work offline. AI answers go to the coach server with a summary of
// the data only (coachContext.ts, R1) and fall back to rule-based on any failure.

export type CoachMode = 'rule' | 'ai';
export type CoachSource = 'rule-based' | 'ai' | 'ai-fallback';

export interface CoachResponse {
  text: string;
  source: CoachSource;
  /** Rule-based answers classify themselves: fact, calculation, estimate, suggestion, missing. */
  tags?: string[];
  intent?: string;
  tokensUsed?: number;
  /** Why an AI question was answered by the rule-based coach. */
  fallbackReason?: string;
  /** The hourly AI question limit stopped this one. */
  limited?: boolean;
}

export interface CoachTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AskOptions {
  settings: Settings | null;
  history?: CoachTurn[];
  timeoutMs?: number;
}

const AI_TIMEOUT_MS = 30_000; // a sleeping Render free instance can take this long to answer
const HEALTH_TIMEOUT_MS = 10_000;
const HOURLY_LIMIT = 10;

class CoachServerError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CoachServerError';
  }
}

function ruleBased(message: string, snapshot: Snapshot, source: CoachSource, fallbackReason?: string): CoachResponse {
  const a = answerQuestion(message, snapshot);
  return { text: a.text, tags: a.tags, source, fallbackReason };
}

/** fetch with a deadline; the abort shows up as an AbortError. */
async function fetchWithTimeout(settings: Settings | null, path: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await coachFetch(settings, path, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

export async function askCoach(message: string, mode: CoachMode, snapshot: Snapshot, opts: AskOptions): Promise<CoachResponse> {
  if (mode === 'rule') return ruleBased(message, snapshot, 'rule-based');

  // A tripped circuit means the server is known to be failing: answer locally
  // without spending one of the hourly questions.
  if (coachCircuit.getState() === 'OPEN') {
    return ruleBased(message, snapshot, 'ai-fallback', 'AI coach is resting after repeated errors');
  }

  const slot = coachRateLimiter.tryConsume();
  if (!slot.allowed) {
    const minutes = Math.max(1, Math.ceil(slot.retryAfterMs / 60_000));
    return {
      text: `You've used all ${HOURLY_LIMIT} questions this hour. The next one is available in ${minutes} minute${minutes === 1 ? '' : 's'}. Meanwhile, you can switch to rule-based mode.`,
      source: 'ai',
      tokensUsed: 0,
      limited: true,
    };
  }

  try {
    const body = await coachCircuit.execute(async () => {
      const res = await fetchWithTimeout(
        opts.settings,
        '/api/coach',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: message, context: buildAIContext(snapshot), history: opts.history ?? [] }),
        },
        opts.timeoutMs ?? AI_TIMEOUT_MS,
      );
      let json: { answer?: unknown; error?: unknown; tokensUsed?: unknown } = {};
      try {
        json = await res.json();
      } catch {
        // Not JSON (e.g. an HTML 404 page): no coach server at this address.
      }
      if (res.ok && typeof json.answer === 'string' && json.answer) {
        return { answer: json.answer, tokensUsed: typeof json.tokensUsed === 'number' ? json.tokensUsed : undefined };
      }
      const reason = typeof json.error === 'string' ? json.error : res.status === 404 ? 'no coach server at this address' : `server returned ${res.status}`;
      // Server trouble counts against the circuit; a wrong token or a bad request does not.
      if (res.status >= 500) throw new CoachServerError(reason, res.status);
      return { failed: reason };
    });
    if ('failed' in body) return ruleBased(message, snapshot, 'ai-fallback', body.failed);
    return { text: body.answer, source: 'ai', tokensUsed: body.tokensUsed };
  } catch (err) {
    const reason = isAbort(err)
      ? 'the AI coach took too long to answer'
      : err instanceof CoachServerError
        ? err.message
        : err instanceof Error && err.name === 'CircuitOpenError'
          ? 'AI coach is resting after repeated errors'
          : 'could not reach the AI coach';
    return ruleBased(message, snapshot, 'ai-fallback', reason);
  }
}

/** Is the coach server up? A timeout usually means a free Render instance is asleep. Never throws. */
export async function checkCoachHealth(settings: Settings | null, timeoutMs = HEALTH_TIMEOUT_MS): Promise<{ available: boolean; sleeping: boolean }> {
  try {
    const res = await fetchWithTimeout(settings, '/api/health', { method: 'GET' }, timeoutMs);
    // Reachable is enough here: without an API key, questions still get a
    // rule-based answer and the server's own explanation.
    const json = (await res.json().catch(() => ({}))) as { ok?: unknown };
    return { available: res.ok && json.ok === true, sleeping: false };
  } catch (err) {
    return { available: false, sleeping: isAbort(err) || err instanceof TypeError };
  }
}

/** AI questions left this hour, and minutes until the allowance is full again. */
export function getRemainingQuestions(): { remaining: number; resetInMinutes: number } {
  return { remaining: coachRateLimiter.getRemainingTokens(), resetInMinutes: Math.ceil(coachRateLimiter.msUntilRefill() / 60_000) };
}

/** A coach server address is set (Profile, or VITE_COACH_URL at build time). */
export const hasCoachUrl = (settings: Settings | null) => coachBaseUrl(settings) !== '';
