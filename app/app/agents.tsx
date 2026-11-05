/**
 * @file Agents screen: how AI agents (Claude, Codex, Cursor...) connect to Beam
 * and request payments, and the one rule that governs them: every
 * agent-initiated payment needs a fresh World ID approval on this phone.
 *
 * Read-only and additive. Beam's agent channel is its MCP server
 * (`server/src/mcp.ts`, stdio): an agent calls `prepare_payment`, the owner
 * opens the returned review link here, and approves with World ID. There is no
 * agent registry or inbox on the server, so this screen surfaces what is real:
 * the connection method, the World ID requirement, and the live World ID mode
 * from `/health`.
 */
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AgentAvatar } from '../src/components/AgentAvatar';
import { AGENT_BRANDS } from '../src/components/agentLogos';
import { Icon } from '../src/components/Icon';
import { Screen } from '../src/components/Screen';
import { useCopy } from '../src/components/useCopy';
import { Button, Card, ListRow, Pill, SectionHeader, Text, type Tone } from '../src/components/ui';
import { useServerStatus } from '../src/hooks';
import { worldOf, type WorldMode } from '../src/serverApi';
import { colors, HIT, radius, space } from '../src/theme';

/** The command that starts Beam's MCP server for an agent to connect to. */
const MCP_COMMAND = 'cd server && npm run mcp';

/** World ID mode as a status pill. */
const WORLD_PILL: Record<WorldMode, { label: string; tone: Tone }> = {
  production: { label: 'World ID on', tone: 'success' },
  staging: { label: 'World ID staging', tone: 'warning' },
  off: { label: 'World ID off', tone: 'danger' },
};

/** Three steps from an agent's request to a settled payment. */
const STEPS: { icon: Parameters<typeof ListRow>[0]['icon']; title: string; subtitle: string }[] = [
  { icon: 'cpu', title: 'The agent asks', subtitle: 'It calls prepare_payment over MCP and gets a review link. It can never move money.' },
  { icon: 'shield', title: 'You approve with World ID', subtitle: 'Open the link here and prove a real human (you) approves this exact payment.' },
  { icon: 'check-circle', title: 'Beam settles it', subtitle: 'Only then does BeamPay send the USDC on Arc, with an onchain receipt.' },
];

/**
 * Agents screen.
 * @returns The full-page screen, pushed from Profile.
 */
export default function AgentsScreen() {
  const server = useServerStatus();
  const { copied, copy } = useCopy();
  const world = worldOf(server);
  const pill = world ? WORLD_PILL[world] : { label: 'World ID …', tone: 'neutral' as Tone };

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={space.md}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Icon name="chevron-left" size={22} color={colors.text} />
      </Pressable>
      <Text variant="headline">Agents</Text>
      <Pill label={pill.label} tone={pill.tone} dot />
    </View>
  );

  return (
    <Screen header={header}>
      <Text variant="body" color="textSecondary">
        Connect an AI agent to Beam and let it propose payments. Every agent payment waits for a fresh World ID approval on
        this phone, so an agent can ask but only you can send.
      </Text>

      <View style={styles.section}>
        <SectionHeader title="Works with" />
        <Card>
          <View style={styles.brands}>
            {AGENT_BRANDS.map((b) => (
              <View key={b.id} style={styles.brand}>
                <AgentAvatar name={b.label} size={44} />
                <Text variant="caption" color="textSecondary">
                  {b.label}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="caption" color="textTertiary" style={styles.brandNote}>
            Any MCP client works. Logos mark the agents Beam recognises by name.
          </Text>
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="How it works" />
        <Card>
          {STEPS.map((s, i) => (
            <ListRow key={s.title} icon={s.icon} tone="neutral" title={s.title} subtitle={s.subtitle} divider={i > 0} />
          ))}
        </Card>
      </View>

      <View style={styles.section}>
        <SectionHeader title="Connect an agent" />
        <Card>
          <Text variant="bodyStrong">{"1. Start Beam's MCP server"}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Copy command ${MCP_COMMAND}`}
            onPress={() => void copy(MCP_COMMAND)}
            style={({ pressed }) => [styles.code, pressed && styles.pressed]}
          >
            <Text variant="mono" style={styles.codeText}>
              {MCP_COMMAND}
            </Text>
            <Icon name={copied ? 'check' : 'copy'} size={16} color={copied ? colors.success : colors.textTertiary} />
          </Pressable>
          <Text variant="body" color="textSecondary" style={styles.step}>
            2. Add that command as an MCP server in your agent (Claude Desktop, Codex, Cursor...). It exposes the same
            payment tools the app uses.
          </Text>
          <Text variant="body" color="textSecondary" style={styles.step}>
            3. When the agent calls prepare_payment, open the review link it returns here and approve with World ID.
          </Text>
          <Button label="Set up World ID" variant="secondary" icon="shield" onPress={() => router.back()} style={styles.cta} />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingHorizontal: space.xs,
    paddingBottom: space.sm,
  },
  back: { width: HIT, height: HIT, alignItems: 'flex-start', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  section: { gap: space.xs },
  brands: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  brand: { alignItems: 'center', gap: space.xs, width: 60 },
  brandNote: { marginTop: space.md },
  step: { marginTop: space.md },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    marginTop: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  codeText: { flex: 1 },
  cta: { marginTop: space.lg },
});
