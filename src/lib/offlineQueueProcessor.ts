import type { IDBPDatabase } from 'idb';
import { enqueue, dequeue, getAll, getDeadLetters, incrementRetry } from './offlineQueue';
import { supabaseCircuit } from './circuitBreaker';
import { getSupabase } from './supabase';
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  toggleKudos,
  type CreatePostInput,
  type ServiceResult,
} from './communityService';

// Replays community writes made while offline, oldest first. Each entry
// carries the id of the account that made it and is only replayed for that
// account, so a different sign-in on the same device never posts as someone else.

export interface QueuePayloads {
  createPost: { userId: string; input: CreatePostInput & { id: string } };
  toggleKudos: { userId: string; postId: string; currentlyKudosed: boolean };
  addComment: { userId: string; postId: string; body: string; commentId: string };
  deletePost: { userId: string; postId: string };
  deleteComment: { userId: string; commentId: string };
}
export type QueueOperation = keyof QueuePayloads;

/** Fired on window after queued writes were sent, so open screens can refresh. */
export const QUEUE_SYNCED_EVENT = 'forge:queue-synced';

type Handler<K extends QueueOperation> = (payload: QueuePayloads[K]) => Promise<ServiceResult<unknown>>;

const handlers: { [K in QueueOperation]: Handler<K> } = {
  createPost: (p) => createPost(p.userId, p.input),
  toggleKudos: (p) => toggleKudos(p.postId, p.userId, p.currentlyKudosed),
  addComment: (p) => addComment(p.postId, p.userId, p.body, p.commentId),
  deletePost: (p) => deletePost(p.postId, p.userId),
  deleteComment: (p) => deleteComment(p.commentId, p.userId),
};

const isOperation = (op: string): op is QueueOperation => Object.prototype.hasOwnProperty.call(handlers, op);

/** Typed wrapper for queuing a community write. Ids are fixed now so a replay can't duplicate. */
export function queueCommunityWrite<K extends QueueOperation>(db: IDBPDatabase, operation: K, payload: QueuePayloads[K]): Promise<string> {
  return enqueue(db, operation, payload);
}

export interface ProcessResult {
  processed: number;
  failed: number;
  deadLetters: number;
}

async function currentUserId(): Promise<string | undefined> {
  const client = getSupabase();
  if (!client) return undefined;
  const { data } = await client.auth.getSession();
  return data.session?.user.id;
}

let running = false;

export async function processOfflineQueue(db: IDBPDatabase, userId?: string): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, failed: 0, deadLetters: 0 };
  if (running) return result; // one replay at a time keeps the order
  running = true;
  try {
    const owner = userId ?? (await currentUserId());
    if (owner) {
      for (const entry of await getAll(db)) {
        if (entry.retryCount >= entry.maxRetries) continue; // dead letter: left for the user to review
        const payload = entry.payload as { userId?: unknown };
        if (payload?.userId !== owner) continue; // someone else's write: wait for them
        // Stop early rather than burn retries while offline or while the service is down.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
        if (supabaseCircuit.getState() === 'OPEN') break;

        if (!isOperation(entry.operation)) {
          await incrementRetry(db, entry.id, `Unknown operation: ${entry.operation}`);
          result.failed++;
          continue;
        }
        const handler = handlers[entry.operation] as Handler<QueueOperation>;
        const res = await handler(entry.payload as QueuePayloads[QueueOperation]);
        if (res.error === null) {
          await dequeue(db, entry.id);
          result.processed++;
        } else {
          await incrementRetry(db, entry.id, res.error);
          result.failed++;
        }
      }
    }
    result.deadLetters = (await getDeadLetters(db)).length;
    return result;
  } finally {
    running = false;
  }
}

/** Replays the queue now (if online) and whenever the connection comes back. Returns a cleanup. */
export function setupOfflineQueueListener(db: IDBPDatabase, onDone?: (result: ProcessResult) => void): () => void {
  const replay = () => {
    processOfflineQueue(db)
      .then((r) => {
        if (r.processed > 0) window.dispatchEvent(new Event(QUEUE_SYNCED_EVENT));
        onDone?.(r);
      })
      .catch((err) => console.warn('Offline queue replay failed.', err));
  };
  window.addEventListener('online', replay);
  if (navigator.onLine) replay();
  return () => window.removeEventListener('online', replay);
}
