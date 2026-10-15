import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// A recording stand-in for the Supabase client: every query builder call is
// logged, and `respond` decides what the awaited query returns.

export type Call = [method: string, args: unknown[]];
export interface RecordedQuery {
  table: string;
  calls: Call[];
}
export interface FakeResponse {
  data: unknown;
  error: { message: string; code?: string; status?: number } | null;
  status?: number;
}

export function fakeSupabase(respond: (q: RecordedQuery) => FakeResponse) {
  const queries: RecordedQuery[] = [];
  const builder = (rec: RecordedQuery): unknown => {
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (onOk: (v: FakeResponse) => unknown, onErr: (e: unknown) => unknown) =>
              Promise.resolve().then(() => respond(rec)).then(onOk, onErr);
          }
          return (...args: unknown[]) => {
            rec.calls.push([String(prop), args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  let signed = 0;
  const bucket = {
    createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://files.test/${path}?sig=${++signed}` }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
  };
  const client = {
    from: (table: string) => {
      const rec: RecordedQuery = { table, calls: [] };
      queries.push(rec);
      return builder(rec);
    },
    storage: { from: vi.fn(() => bucket) },
  };
  return { client: client as unknown as SupabaseClient, queries, bucket };
}

/** Arguments of the first call to `method` in a recorded query. */
export const argsOf = (q: RecordedQuery | undefined, method: string) => q?.calls.find(([m]) => m === method)?.[1];
export const methods = (q: RecordedQuery | undefined) => (q?.calls ?? []).map(([m]) => m);
