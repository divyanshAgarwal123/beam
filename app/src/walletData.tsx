/**
 * @file Wallet data shared by the tabs: balance, BeamPay account (cap and
 * World ID link), Beam handle, server status, pending payment, activity and
 * the daily limit, loaded once in the tabs layout.
 *
 * One provider (instead of one fetch per tab) keeps the tabs in sync.
 * The Ask sheet resumes the same slot on its own; `finalizePending` runs those
 * callers one at a time so a settled payment is applied once.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import type { Address } from 'viem';
import { useBalance, useHandle, useBeamPayAccount, usePendingTx, useServerStatus, useWallet } from './hooks';
import { getLimitState, type LimitState } from './limits';
import type { BeamPayAccount } from './beamPayClient';
import type { PendingStatus } from './pendingTx';
import type { ServerStatus } from './serverApi';
import { getActivity, type ActivityTx } from './storage';

type WalletData = {
  address: Address | null;
  email: string | null;
  /** Balance in wei; null until loaded. */
  balance: bigint | null;
  balanceError: boolean;
  /** BeamPay cap and World ID link; null until loaded or without BeamPay. */
  account: BeamPayAccount | null;
  accountError: boolean;
  /** Beam handle: undefined while loading or unavailable, null when the wallet has none. */
  handle: string | null | undefined;
  handleError: boolean;
  server: ServerStatus;
  pending: PendingStatus;
  recheckPending: () => void;
  /** Finished payments, newest first; null while loading. */
  activity: ActivityTx[] | null;
  /** Daily limit and today's spend; null while loading. */
  limits: LimitState | null;
  /** Re-reads activity and limits from storage. */
  reloadLocal: () => Promise<void>;
  /** Re-reads the BeamPay account (after a cap change or World ID link). */
  reloadAccount: () => Promise<void>;
  /** Re-reads the handle (after a claim). */
  reloadHandle: () => Promise<void>;
  /** Re-checks the pending payment, the balance, the account and local data. */
  refresh: () => Promise<void>;
};

const WalletDataContext = createContext<WalletData | null>(null);

/**
 * Loads wallet data and refreshes it on foreground and when a pending payment settles.
 * @param props.children The signed-in tabs.
 * @returns The context provider.
 */
export function WalletDataProvider({ children }: { children: ReactNode }) {
  const { address, email } = useWallet();
  const server = useServerStatus();
  const balance = useBalance(address);
  const account = useBeamPayAccount(address);
  const handle = useHandle(address, server.kind !== 'loading' && server.kind !== 'unreachable' && server.handles);
  const { status: pending, recheck } = usePendingTx();
  const [activity, setActivity] = useState<ActivityTx[] | null>(null);
  const [limits, setLimits] = useState<LimitState | null>(null);
  const { refresh: refreshBalance } = balance;
  const { refresh: reloadAccount } = account;

  const reloadLocal = useCallback(async () => {
    const [items, state] = await Promise.all([getActivity(), getLimitState()]);
    setActivity(items);
    setLimits(state);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([recheck(), refreshBalance(), reloadAccount(), reloadLocal()]);
  }, [recheck, refreshBalance, reloadAccount, reloadLocal]);

  useEffect(() => {
    void reloadLocal();
  }, [reloadLocal]);

  // A resumed payment just settled: spend, activity and balance changed.
  useEffect(() => {
    if (pending.kind === 'confirmed' || pending.kind === 'failed') {
      void reloadLocal();
      void refreshBalance();
    }
  }, [pending, reloadLocal, refreshBalance]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const value: WalletData = {
    address,
    email,
    balance: balance.value,
    balanceError: balance.error,
    account: account.value,
    accountError: account.error,
    handle: handle.value ? handle.value.name : undefined,
    handleError: handle.error,
    server,
    pending,
    recheckPending: () => void recheck(),
    activity,
    limits,
    reloadLocal,
    reloadAccount,
    reloadHandle: handle.refresh,
    refresh,
  };
  return <WalletDataContext.Provider value={value}>{children}</WalletDataContext.Provider>;
}

/**
 * Reads the shared wallet data.
 * @returns Wallet data from the nearest `WalletDataProvider`.
 */
export function useWalletData(): WalletData {
  const data = useContext(WalletDataContext);
  if (!data) throw new Error('useWalletData must be used inside WalletDataProvider');
  return data;
}
