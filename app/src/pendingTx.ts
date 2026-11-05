/**
 * @file Pending transaction persistence and resume.
 *
 * A sent transaction is saved to `pending:v1` before waiting for its receipt,
 * so a dismissed sheet or killed app can finish the bookkeeping later. There
 * is one slot: new payments are blocked while it is occupied.
 */
import { TransactionReceiptNotFoundError, type Address, type Hash, type PublicClient } from 'viem';
import { toChecksumAddress } from './intent';
import { addSpend } from './limits';
import {
  addActivity,
  addRecipient,
  isHash,
  isRecord,
  isWeiString,
  KEYS,
  markExecuted,
  readJson,
  rememberName,
  removeKey,
  writeJson,
} from './storage';

/** A sent, unconfirmed payment. Chain data and the ENS name paid, never screen text. */
export type PendingTx = { hash: Hash; intentId: string; to: Address; toName?: string; amountWei: string; sentAt: number };

/** Result of checking a pending payment against the chain. */
export type PendingStatus =
  | { kind: 'none' }
  | { kind: 'confirmed' | 'failed' | 'pending' | 'unknown'; tx: PendingTx };

/** After this long without a receipt, give up and point the user at the explorer. */
const PENDING_STALE_MS = 10 * 60_000;

const isPendingTx = (v: unknown): v is PendingTx =>
  isRecord(v) &&
  isHash(v.hash) &&
  typeof v.intentId === 'string' &&
  typeof v.to === 'string' &&
  toChecksumAddress(v.to) !== null &&
  (v.toName === undefined || typeof v.toName === 'string') &&
  isWeiString(v.amountWei) &&
  typeof v.sentAt === 'number';

/**
 * Persists a sent payment. Call before waiting for the receipt.
 * @param tx The payment.
 * @returns Resolves once stored.
 */
export async function savePending(tx: PendingTx): Promise<void> {
  await writeJson(KEYS.pending, tx);
}

/**
 * Reads the pending slot.
 * @returns The pending payment, or null.
 */
export async function loadPending(): Promise<PendingTx | null> {
  return readJson(KEYS.pending, isPendingTx);
}

/**
 * One finalization at a time. The open sheet and a resumed pending check can
 * both see the same receipt, and the slot is cleared before spend is written,
 * so overlapping calls would apply one payment twice or drop the next one's spend.
 */
let finalizeChain: Promise<void> = Promise.resolve();

/**
 * Applies a receipt: on success adds spend and recipient, remembers the name's
 * address (`names:v1`) and marks the intent executed; either way appends to the activity list and clears the slot. Idempotent: does
 * nothing if the slot no longer holds this hash (already finalized elsewhere).
 * @param tx The payment.
 * @param status Receipt status.
 * @returns Resolves once stored.
 */
export function finalizePending(tx: PendingTx, status: 'success' | 'reverted'): Promise<void> {
  const run = finalizeChain.then(() => commitPending(tx, status));
  // A rejection must not wedge later payments; the caller still sees it.
  finalizeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Writes the receipt's bookkeeping. Caller serializes this.
 * @param tx The payment.
 * @param status Receipt status.
 * @returns Resolves once stored.
 */
async function commitPending(tx: PendingTx, status: 'success' | 'reverted'): Promise<void> {
  if ((await loadPending())?.hash !== tx.hash) return;
  await removeKey(KEYS.pending);
  const confirmed = status === 'success';
  if (confirmed) {
    await Promise.all([
      addSpend(BigInt(tx.amountWei)),
      addRecipient(tx.to),
      markExecuted(tx.intentId),
      tx.toName ? rememberName(tx.toName, tx.to) : undefined,
    ]);
  }
  await addActivity({
    hash: tx.hash,
    to: tx.to,
    ...(tx.toName ? { toName: tx.toName } : {}),
    amountWei: tx.amountWei,
    status: confirmed ? 'confirmed' : 'failed',
    at: Date.now(),
  });
}

/**
 * Looks up one payment's receipt and finalizes it if found.
 * @param client Read-only chain access.
 * @param tx The payment.
 * @param now Clock (ms).
 * @returns confirmed/failed when settled, pending when not yet mined (or RPC
 *   unreachable), unknown when stale (the slot is then cleared).
 */
export async function settlePending(
  client: Pick<PublicClient, 'getTransactionReceipt'>,
  tx: PendingTx,
  now = Date.now(),
): Promise<Exclude<PendingStatus, { kind: 'none' }>> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: tx.hash });
    await finalizePending(tx, receipt.status);
    return { kind: receipt.status === 'success' ? 'confirmed' : 'failed', tx };
  } catch (e) {
    if (!(e instanceof TransactionReceiptNotFoundError) || now - tx.sentAt < PENDING_STALE_MS) return { kind: 'pending', tx };
    if ((await loadPending())?.hash === tx.hash) await removeKey(KEYS.pending);
    return { kind: 'unknown', tx };
  }
}

/**
 * Resumes whatever is in the pending slot (tabs layout and Ask mount).
 * @param client Read-only chain access.
 * @returns The slot's status, or `none` when empty.
 */
export async function checkPending(client: Pick<PublicClient, 'getTransactionReceipt'>): Promise<PendingStatus> {
  const tx = await loadPending();
  return tx ? settlePending(client, tx) : { kind: 'none' };
}
