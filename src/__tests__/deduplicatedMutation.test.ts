import { describe, it, expect, vi } from 'vitest';
import { deduplicatedMutation, isMutationPending } from '../lib/deduplicatedMutation';

describe('deduplicatedMutation', () => {
  it('runs the mutation and returns its result', async () => {
    await expect(deduplicatedMutation('kudos:1', async () => 'liked')).resolves.toBe('liked');
    expect(isMutationPending('kudos:1')).toBe(false);
  });

  it('ignores a second call with the same key while the first is in flight', async () => {
    let finish: (v: string) => void = () => {};
    const slow = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const first = deduplicatedMutation('kudos:2', slow);
    expect(isMutationPending('kudos:2')).toBe(true);
    await expect(deduplicatedMutation('kudos:2', slow)).resolves.toBeNull();
    finish('liked');
    await expect(first).resolves.toBe('liked');
    expect(slow).toHaveBeenCalledTimes(1);
    expect(isMutationPending('kudos:2')).toBe(false);
  });

  it('clears the pending key when the mutation throws', async () => {
    await expect(deduplicatedMutation('kudos:3', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect(isMutationPending('kudos:3')).toBe(false);
    await expect(deduplicatedMutation('kudos:3', async () => 'retried')).resolves.toBe('retried');
  });
});
