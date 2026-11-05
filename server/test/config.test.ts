/**
 * @file Env parsing: network selection, ENS chain, World ID modes and the
 * production refusals. Errors must never echo secret values.
 */
import { describe, expect, it } from 'vitest';
import { loadCoreConfig, loadServerConfig } from '../src/config';
import { DEFAULT_ENS_RPC } from '../src/ens';
import { ARC, BEAM_PAY } from './helpers';

const KEY = `0x${'ab'.repeat(32)}`;
const SALT = `0x${'cd'.repeat(32)}`;
const RP_KEY = `0x${'ef'.repeat(32)}`;
const STRONG = 'x'.repeat(40);
/** Everything World ID needs besides the mode. */
const world = { WORLD_APP_ID: 'app_434e1889762005d1f29faa899ef8762a', WORLD_RP_ID: 'rp_346985f8929bb5cf', WORLD_RP_SIGNING_KEY: RP_KEY, APPROVER_PRIVATE_KEY: KEY };
const base = { AGENT_TOKEN: 'dev-token', BEAMPAY_ADDRESS: BEAM_PAY.toLowerCase() };
const prod = { ...base, NODE_ENV: 'production', AGENT_TOKEN: STRONG, ANTHROPIC_API_KEY: 'sk-test' };

const errorsOf = async (env: Record<string, string>) => {
  const r = await loadServerConfig(env);
  return r.ok ? [] : r.errors;
};

describe('config: network and chains', () => {
  it('defaults: Arc, its public RPC, ENS on mainnet via PublicNode, World off, port 8787', async () => {
    const r = await loadServerConfig(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config).toMatchObject({
      network: ARC,
      rpcUrl: ARC.rpcUrl,
      ensChain: 'mainnet',
      ensChainId: 1,
      ensRpcUrl: DEFAULT_ENS_RPC.mainnet,
      beamPay: BEAM_PAY,
      port: 8787,
      model: 'claude-haiku-5-5',
      world: { mode: 'off', id: null, sessionsPath: 'data/world-sessions.json' },
    });
    expect(r.warnings).toContain('ANTHROPIC_API_KEY is unset: every request uses the fallback parser.');
  });

  it('ARC_RPC_URL overrides the default RPC; a blank means default', () => {
    const arc = loadCoreConfig({ ...base, BEAM_NETWORK: 'arc', ARC_RPC_URL: 'https://arc.example' });
    expect(arc.ok && arc.config).toMatchObject({ network: ARC, rpcUrl: 'https://arc.example' });
    const blank = loadCoreConfig({ ...base, BEAM_NETWORK: '', ARC_RPC_URL: '' });
    expect(blank.ok && blank.config).toMatchObject({ network: ARC, rpcUrl: ARC.rpcUrl });
  });

  it('ENS_CHAIN=sepolia → chain 11155111 and the Sepolia default RPC; ENS_RPC_URL overrides', () => {
    const r = loadCoreConfig({ ...base, ENS_CHAIN: 'sepolia' });
    expect(r.ok && r.config).toMatchObject({ ensChain: 'sepolia', ensChainId: 11155111, ensRpcUrl: DEFAULT_ENS_RPC.sepolia });
    const custom = loadCoreConfig({ ...base, ENS_RPC_URL: 'https://eth.example/key' });
    expect(custom.ok && custom.config.ensRpcUrl).toBe('https://eth.example/key');
  });

  it.each([
    [{ BEAM_NETWORK: 'base' }, 'BEAM_NETWORK'],
    [{ ENS_CHAIN: 'holesky' }, 'ENS_CHAIN'],
    [{ ARC_RPC_URL: 'ftp://x' }, 'ARC_RPC_URL'],
    [{ BEAMPAY_ADDRESS: '' }, 'BEAMPAY_ADDRESS'],
    [{ BEAMPAY_ADDRESS: '0x1234' }, 'BEAMPAY_ADDRESS'],
  ])('bad %j → error naming %s', (over, name) => {
    const r = loadCoreConfig({ ...base, ...over });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(' ')).toContain(name);
  });
});

describe('config: World modes', () => {
  it.each(['production', 'staging'])('%s needs the app, RP, signing key and approver key', async (mode) => {
    expect(await errorsOf({ ...base, WORLD_MODE: mode })).toEqual([
      `WORLD_APP_ID: is required when WORLD_MODE=${mode}`,
      `WORLD_RP_ID: is required when WORLD_MODE=${mode}`,
      `WORLD_RP_SIGNING_KEY: is required when WORLD_MODE=${mode}`,
      `APPROVER_PRIVATE_KEY: is required when WORLD_MODE=${mode}`,
    ]);
  });

  it('staging loads with its environment, warns about the dev salt; WORLD_SESSIONS_PATH overrides the default', async () => {
    const r = await loadServerConfig({ ...base, ...world, WORLD_MODE: 'staging', WORLD_SESSIONS_PATH: '/tmp/s.json' });
    expect(r.ok && r.config.world).toMatchObject({
      mode: 'staging',
      sessionsPath: '/tmp/s.json',
      id: { appId: world.WORLD_APP_ID, rpId: world.WORLD_RP_ID, signingKey: RP_KEY, environment: 'staging' },
    });
    expect(r.ok && r.warnings).toContain('HUMAN_HASH_SALT is unset: using a fixed development salt.');
  });

  it.each([
    ['WORLD_MODE', { WORLD_MODE: 'mock' }],
    ['WORLD_APP_ID', { WORLD_APP_ID: 'rp_123' }],
    ['WORLD_RP_ID', { WORLD_RP_ID: 'app_123' }],
    ['WORLD_RP_SIGNING_KEY', { WORLD_RP_SIGNING_KEY: '0x1234' }],
  ])('a bad %s is refused', async (name, over) => {
    expect((await errorsOf({ ...base, ...world, WORLD_MODE: 'staging', ...over })).join(' ')).toContain(name);
  });

  it('the RP signing key is never echoed', async () => {
    const secret = `0x${'z'.repeat(64)}`;
    const errors = await errorsOf({ ...base, ...world, WORLD_MODE: 'staging', WORLD_RP_SIGNING_KEY: secret });
    expect(errors.join(' ')).toContain('WORLD_RP_SIGNING_KEY');
    expect(errors.join(' ')).not.toContain(secret);
  });
});

describe('config: production refusals', () => {
  it('a complete production config loads', async () => {
    const r = await loadServerConfig({ ...prod, ...world, WORLD_MODE: 'production', HUMAN_HASH_SALT: SALT });
    expect(r.ok).toBe(true);
    expect(r.ok && r.config.production).toBe(true);
    expect(r.ok && r.config.world.id?.environment).toBe('production');
  });

  it('WORLD_MODE=staging is refused in production', async () => {
    const errors = await errorsOf({ ...prod, ...world, WORLD_MODE: 'staging', HUMAN_HASH_SALT: SALT });
    expect(errors).toEqual(['WORLD_MODE: staging is for the World ID simulator only and is refused in production']);
  });

  it.each(['change-me', 'short-but-secret-token'])('weak AGENT_TOKEN %s is refused and never echoed', async (token) => {
    const errors = await errorsOf({ ...prod, AGENT_TOKEN: token });
    expect(errors.join(' ')).toContain('AGENT_TOKEN: too weak');
    expect(errors.join(' ')).not.toContain(token);
  });

  it('warns in development when AGENT_TOKEN is the example default, without echoing it', async () => {
    const r = await loadServerConfig({ ...base, AGENT_TOKEN: 'change-me' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.join(' ')).toContain('EXPO_PUBLIC_AGENT_TOKEN');
    expect(r.warnings.join(' ')).not.toContain('change-me');
  });

  it('missing keys are refused: Anthropic key, approver key and salt with World on', async () => {
    const { ANTHROPIC_API_KEY: _, ...noKey } = prod;
    expect(await errorsOf(noKey)).toEqual(['ANTHROPIC_API_KEY: is required in production']);
    const errors = await errorsOf({ ...prod, WORLD_MODE: 'production' });
    expect(errors).toEqual(
      expect.arrayContaining(['WORLD_RP_SIGNING_KEY: is required when WORLD_MODE=production', 'APPROVER_PRIVATE_KEY: is required when WORLD_MODE=production', 'HUMAN_HASH_SALT: is required in production']),
    );
  });

  it('a malformed key is reported by name only', async () => {
    const secret = '0xdeadbeef-not-a-key-but-secret';
    const errors = await errorsOf({ ...base, APPROVER_PRIVATE_KEY: secret });
    expect(errors.join(' ')).toContain('APPROVER_PRIVATE_KEY');
    expect(errors.join(' ')).not.toContain(secret);
  });

  it('AGENT_TOKEN is always required', async () => {
    expect((await errorsOf({ BEAMPAY_ADDRESS: BEAM_PAY })).join(' ')).toContain('AGENT_TOKEN');
  });
});
