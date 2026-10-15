// Ignore a second tap while the same mutation (e.g. "kudos:<postId>") is in flight.

const pendingMutations = new Set<string>();

/** Runs `fn` unless `key` is already running; then resolves to null without calling it. */
export async function deduplicatedMutation<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (pendingMutations.has(key)) return null;
  pendingMutations.add(key);
  try {
    return await fn();
  } finally {
    pendingMutations.delete(key);
  }
}

export function isMutationPending(key: string): boolean {
  return pendingMutations.has(key);
}
