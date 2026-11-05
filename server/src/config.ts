/**
 * @file Environment parsing for the agent server and the MCP server.
 *
 * Everything that comes from `process.env` is validated here with zod, once,
 * at startup. Errors name the variable and never echo its value, so a typo in
 * a key cannot leak the key into logs. In production the server refuses to
 * start with missing keys, a weak `AGENT_TOKEN`, or `WORLD_MODE=staging`.
 * Handle (ENS registrar) settings live in `handles/config.ts`.
 */
import { getAddress, isAddress, isHex, keccak256, stringToHex, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { DEFAULT_ENS_RPC, type EnsChain } from './ens';
import { getNetwork, type Network } from './network';

/** World ID environment for approvals: real World App, the staging simulator (dev only), or disabled. */
export type WorldMode = 'production' | 'staging' | 'off';
/** Chain IDs of the ENS chains. */
export const ENS_CHAIN_IDS: Record<EnsChain, number> = { mainnet: 1, sepolia: 11155111 };
/** Where World App returns after a proof. Never configurable, so it cannot point anywhere but Beam. */
export const APP_RETURN_TO = 'bubbleagent://approval';
/** Default location of the wallet to World ID session map. */
const DEFAULT_SESSIONS_PATH = 'data/world-sessions.json';
/** Shortest `AGENT_TOKEN` accepted in production. */
const MIN_PROD_TOKEN_CHARS = 32;
/**
 * Salt used outside production when `HUMAN_HASH_SALT` is unset.
 * ponytail: fixed dev salt so staging links survive restarts; production refuses to start without a real one.
 */
const DEV_HUMAN_HASH_SALT = keccak256(stringToHex('beam-dev-human-hash-salt'));

/** Settings both the HTTP server and the MCP server need. */
export type CoreConfig = {
  network: Network;
  rpcUrl: string;
  ensChain: EnsChain;
  ensChainId: number;
  ensRpcUrl: string;
  beamPay: Address;
};

/** World ID 4.0 relying party settings (from the World developer portal). */
export type WorldIdConfig = {
  appId: `app_${string}`;
  rpId: string;
  /** RP signing key; signs every proof request. Secret, never logged. */
  signingKey: Hex;
  environment: 'production' | 'staging';
};

/** Full HTTP server settings. */
export type ServerConfig = CoreConfig & {
  production: boolean;
  port: number;
  agentToken: string;
  anthropicApiKey: string | null;
  model: string;
  world: {
    mode: WorldMode;
    approverKey: Hex | null;
    humanHashSalt: Hex;
    /** JSON file mapping linked wallets to their World ID session. */
    sessionsPath: string;
    /** Null exactly when `mode` is "off". */
    id: WorldIdConfig | null;
  };
};

/** Result of loading config: either a config plus warnings, or reasons to refuse to start. */
export type ConfigResult<T> = { ok: true; config: T; warnings: string[] } | { ok: false; errors: string[] };

type Env = Record<string, string | undefined>;

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const opt = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const PrivateKey = z.string().refine((v) => isHex(v) && v.length === 66, 'must be a 0x-prefixed 32-byte hex key');
const HttpUrl = z.url({ protocol: /^https?$/ });

const CoreSchema = z.object({
  BEAM_NETWORK: opt(z.string()),
  ARC_RPC_URL: opt(HttpUrl),
  ENS_CHAIN: opt(z.enum(['mainnet', 'sepolia'])),
  ENS_RPC_URL: opt(HttpUrl),
  BEAMPAY_ADDRESS: z.preprocess(
    blankToUndefined,
    z.string({ error: 'is required (the deployed BeamPay address)' }).refine((v) => isAddress(v, { strict: false }), 'must be a 0x address'),
  ),
});

const ServerSchema = CoreSchema.extend({
  NODE_ENV: opt(z.string()),
  PORT: opt(z.coerce.number().int().min(1).max(65535)),
  AGENT_TOKEN: z.preprocess(blankToUndefined, z.string({ error: 'is required' })),
  ANTHROPIC_API_KEY: opt(z.string()),
  ANTHROPIC_MODEL: opt(z.string()),
  WORLD_MODE: opt(z.enum(['production', 'staging', 'off'])),
  WORLD_APP_ID: opt(z.templateLiteral(['app_', z.string().regex(/^[A-Za-z0-9_]{1,80}$/)])),
  WORLD_RP_ID: opt(z.string().regex(/^rp_[0-9a-f]{1,64}$/, 'must be an rp_ id')),
  WORLD_RP_SIGNING_KEY: opt(PrivateKey),
  WORLD_SESSIONS_PATH: opt(z.string()),
  APPROVER_PRIVATE_KEY: opt(PrivateKey),
  HUMAN_HASH_SALT: opt(PrivateKey),
});

/**
 * Formats zod issues as "VAR: problem" lines without values.
 * @param error Zod error.
 * @returns One line per issue.
 */
function issues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`);
}

/**
 * Parses the settings shared by the HTTP and MCP servers.
 * @param env Environment (usually `process.env`).
 * @returns Core config or errors.
 */
export function loadCoreConfig(env: Env): ConfigResult<CoreConfig> {
  const parsed = CoreSchema.safeParse(env);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error) };
  return buildCore(parsed.data);
}

/**
 * Builds the core config from parsed env.
 * @param e Parsed env.
 * @returns Core config or errors.
 */
function buildCore(e: z.infer<typeof CoreSchema>): ConfigResult<CoreConfig> {
  let network: Network;
  try {
    network = getNetwork(e.BEAM_NETWORK);
  } catch {
    return { ok: false, errors: ['BEAM_NETWORK: must be "arc"'] };
  }
  const ensChain = e.ENS_CHAIN ?? 'mainnet';
  const rpcUrl = e.ARC_RPC_URL ?? network.rpcUrl;
  const config: CoreConfig = {
    network,
    rpcUrl,
    ensChain,
    ensChainId: ENS_CHAIN_IDS[ensChain],
    ensRpcUrl: e.ENS_RPC_URL ?? DEFAULT_ENS_RPC[ensChain],
    beamPay: getAddress(e.BEAMPAY_ADDRESS),
  };
  return { ok: true, config, warnings: [] };
}

/**
 * Parses and validates the HTTP server's environment.
 * Production refuses: missing keys, a weak token, `WORLD_MODE=staging`.
 * @param env Environment (usually `process.env`).
 * @returns Server config plus warnings, or the reasons to refuse to start.
 */
export async function loadServerConfig(env: Env): Promise<ConfigResult<ServerConfig>> {
  const parsed = ServerSchema.safeParse(env);
  if (!parsed.success) return { ok: false, errors: issues(parsed.error) };
  const e = parsed.data;
  const core = buildCore(e);
  if (!core.ok) return core;

  const production = e.NODE_ENV === 'production';
  const errors: string[] = [];
  const warnings: string[] = [];
  const mode: WorldMode = e.WORLD_MODE ?? 'off';

  if (production && (e.AGENT_TOKEN === 'change-me' || e.AGENT_TOKEN.length < MIN_PROD_TOKEN_CHARS)) {
    errors.push(`AGENT_TOKEN: too weak for production (use ${MIN_PROD_TOKEN_CHARS}+ random characters)`);
  } else if (e.AGENT_TOKEN === 'change-me') {
    // The app reads the same secret from EXPO_PUBLIC_AGENT_TOKEN, which is compiled into the APK.
    warnings.push('AGENT_TOKEN is still the example default. The app ships that same value inside the APK as EXPO_PUBLIC_AGENT_TOKEN.');
  }
  if (!e.ANTHROPIC_API_KEY) {
    if (production) errors.push('ANTHROPIC_API_KEY: is required in production');
    else warnings.push('ANTHROPIC_API_KEY is unset: every request uses the fallback parser.');
  }

  let id: WorldIdConfig | null = null;
  if (mode !== 'off') {
    if (production && mode === 'staging') errors.push('WORLD_MODE: staging is for the World ID simulator only and is refused in production');
    const required = ['WORLD_APP_ID', 'WORLD_RP_ID', 'WORLD_RP_SIGNING_KEY', 'APPROVER_PRIVATE_KEY'] as const;
    for (const name of required) if (!e[name]) errors.push(`${name}: is required when WORLD_MODE=${mode}`);
    if (!e.HUMAN_HASH_SALT) {
      if (production) errors.push('HUMAN_HASH_SALT: is required in production');
      else warnings.push('HUMAN_HASH_SALT is unset: using a fixed development salt.');
    }
    if (e.WORLD_APP_ID && e.WORLD_RP_ID && e.WORLD_RP_SIGNING_KEY) {
      id = { appId: e.WORLD_APP_ID, rpId: e.WORLD_RP_ID, signingKey: e.WORLD_RP_SIGNING_KEY as Hex, environment: mode };
    }
  }
  if (production && mode === 'off') warnings.push('WORLD_MODE=off: approval-required payments cannot be approved.');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    warnings,
    config: {
      ...core.config,
      production,
      port: e.PORT ?? 8787,
      agentToken: e.AGENT_TOKEN,
      anthropicApiKey: e.ANTHROPIC_API_KEY ?? null,
      model: e.ANTHROPIC_MODEL ?? 'claude-haiku-5-5',
      world: {
        mode,
        approverKey: (e.APPROVER_PRIVATE_KEY as Hex | undefined) ?? null,
        humanHashSalt: (e.HUMAN_HASH_SALT as Hex | undefined) ?? DEV_HUMAN_HASH_SALT,
        sessionsPath: e.WORLD_SESSIONS_PATH ?? DEFAULT_SESSIONS_PATH,
        id,
      },
    },
  };
}
