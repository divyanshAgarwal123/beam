/**
 * @file ENS name detection, normalization and resolution for payments.
 *
 * SHARED FILE: byte-identical copies live at `app/src/ens.ts` and
 * `server/src/ens.ts`. Edit one, copy it to the other;
 * `server/test/shared.test.ts` fails if they drift.
 *
 * The server and the device each resolve names independently with this code,
 * so a compromised server cannot swap the address behind a name.
 */
import { getAddress, type Address, type PublicClient } from 'viem';
import { normalize, toCoinType } from 'viem/ens';

/** A name resolved for payment on a specific chain. */
export type ResolvedName = {
  /** ENSIP-15 normalized name, e.g. "rahul.eth". */
  name: string;
  address: Address;
  /** The address's primary name on that chain, if any. */
  primaryName: string | null;
};

/** Resolves a normalized name; null when it has no usable address. Throws on RPC failure. */
export type NameResolver = (name: string) => Promise<ResolvedName | null>;

/** The read-only ENS calls the resolver needs. A viem PublicClient on mainnet or Sepolia satisfies it. */
export type EnsReader = Pick<PublicClient, 'getEnsAddress' | 'getEnsName'>;

/** Chains ENS names are read from. */
export type EnsChain = 'mainnet' | 'sepolia';

/** Keyless public RPCs (PublicNode) used when no ENS RPC is configured. Use a keyed provider in production. */
export const DEFAULT_ENS_RPC: Record<EnsChain, string> = {
  mainnet: 'https://ethereum-rpc.publicnode.com',
  sepolia: 'https://ethereum-sepolia-rpc.publicnode.com',
};

// Candidate `.eth` names: dot-separated labels ending in ".eth", starting after whitespace or opening
// punctuation (so emails like a@b.eth and URLs like x.eth.limo don't match). Leading guard instead of a lookbehind (Hermes-safe).
const NAME_CANDIDATE = /(?:^|[\s([{<"'“‘,;:!?])((?:[\p{L}\p{N}_-]+\.)+eth)(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])/giu;

/**
 * Normalizes a candidate name (ENSIP-15).
 * @param raw Name as written, e.g. "Rahul.ETH".
 * @returns The normalized name, or null if it is not a valid `.eth` name.
 */
export function normalizeEnsName(raw: string): string | null {
  try {
    const name = normalize(raw.trim());
    return /^(?:[^.\s]+\.)+eth$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * Unique, normalized `.eth` names in a text, in order of appearance.
 * @param text Source text (zero-width characters already stripped).
 * @returns Normalized names.
 */
export function extractEnsNames(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(NAME_CANDIDATE)) {
    const name = normalizeEnsName(m[1]);
    if (name) seen.add(name);
  }
  return [...seen];
}

/**
 * Builds a resolver for payments on `chainId`. The address record for that
 * chain's coin type (ENSIP-11) wins; otherwise the default EVM address
 * (ENSIP-19 / coin type 60) is used. The primary name follows the same rule:
 * a chain-specific primary name if set, else the default one.
 * @param client ENS-capable client (Ethereum mainnet or Sepolia).
 * @param chainId Chain the payment settles on.
 * @returns A `NameResolver`.
 */
export function createNameResolver(client: EnsReader, chainId: number): NameResolver {
  const coinType = toCoinType(chainId);
  return async (name) => {
    const forChain = await client.getEnsAddress({ name, coinType });
    const raw = forChain ?? (await client.getEnsAddress({ name }));
    if (!raw) return null;
    const address = getAddress(raw);
    const primary = (await client.getEnsName({ address, coinType }).catch(() => null)) ?? (await client.getEnsName({ address }).catch(() => null));
    return { name, address, primaryName: primary ? normalizeEnsName(primary) : null };
  };
}
