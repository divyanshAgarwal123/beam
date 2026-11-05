/**
 * @file Pending-payment finalization. The open sheet and a resumed check can
 * both apply one receipt; spend must be recorded once, and a later payment
 * must still be recorded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hash } from 'viem';
import { getLimitState } from '../src/limits';
import { finalizePending, savePending, type PendingTx } from '../src/pendingTx';
import { getActivity } from '../src/storage';

const mem = vi.hoisted(() => ({
  store: new Map<string, string>(),
  spendWrites: 0,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => mem.store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      if (key.startsWith('spend:')) mem.spendWrites += 1;
      mem.store.set(key, value);
    },
    removeItem: async (key: string) => {
      mem.store.delete(key);
    },
  },
}));

const to = getAddress('0x1111111111111111111111111111111111111111');
const ONE = 10n ** 18n;

function tx(hash: Hash, amountWei: string, intentId: string): PendingTx {
  return { hash, intentId, to, amountWei, sentAt: 1_700_000_000_000 };
}

const first = tx(`0x${'ab'.repeat(32)}`, ONE.toString(), 'intent-1');
const second = tx(`0x${'cd'.repeat(32)}`, (2n * ONE).toString(), 'intent-2');

describe('finalizePending', () => {
  beforeEach(() => {
    mem.store.clear();
    mem.spendWrites = 0;
  });

  it('records spend once when the same receipt is finalized twice at once', async () => {
    await savePending(first);
    await Promise.all([finalizePending(first, 'success'), finalizePending(first, 'success')]);
    expect(mem.spendWrites).toBe(1);
    expect((await getLimitState()).spentWei).toBe(ONE);
    expect(await getActivity()).toEqual([expect.objectContaining({ hash: first.hash, status: 'confirmed', amountWei: first.amountWei })]);
  });

  it('records a later payment after the first one settles', async () => {
    await savePending(first);
    await finalizePending(first, 'success');
    await savePending(second);
    await finalizePending(second, 'success');
    expect(mem.spendWrites).toBe(2);
    expect((await getLimitState()).spentWei).toBe(3n * ONE);
  });

  it('does not add spend when the receipt reverted', async () => {
    await savePending(first);
    await finalizePending(first, 'reverted');
    expect(mem.spendWrites).toBe(0);
    expect((await getActivity())[0]).toMatchObject({ hash: first.hash, status: 'failed' });
  });
});
