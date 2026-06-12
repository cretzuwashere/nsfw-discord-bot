import type {
  AdapterContext,
  AdapterStatus,
  ChannelAdapter,
  CommandContext,
  ReplyPayload,
  VoiceCapability,
  VoiceSession,
} from '@botplatform/core';
import { ADAPTER_KEYS, GENERIC_USER_ERROR } from '@botplatform/shared';
import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
} from 'discord.js';
import type { DiscordGatewayAdapterCreator } from '@discordjs/voice';
import { createDiscordVoiceSession, DiscordVoiceSession } from './voice-session.js';

/**
 * The Discord channel adapter. All Discord-specific behavior lives here;
 * modules and the kernel speak only in core contracts.
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly key: string = ADAPTER_KEYS.discord;

  private client: Client | null = null;
  private ctx: AdapterContext | null = null;
  private state: AdapterStatus = { state: 'disabled' };
  private readonly voiceSessions = new Map<string, DiscordVoiceSession>();

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    const { config, logger, audit } = ctx;

    if (!config.discord.enabled) {
      this.state = {
        state: 'disabled',
        detail: 'DISCORD_TOKEN / DISCORD_CLIENT_ID not configured',
      };
      logger.info('discord adapter disabled — no token/client id configured');
      return;
    }

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });
    this.client = client;
    this.state = { state: 'connecting' };

    client.once(Events.ClientReady, (readyClient) => {
      this.state = {
        state: 'connected',
        identity: readyClient.user.tag,
        guildCount: readyClient.guilds.cache.size,
      };
      logger.info(
        { identity: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
        'discord connected'
      );
      void audit.record({ actorType: 'adapter', action: 'discord.connected' });
      // Record the guilds we can see so the admin panel has rows to edit.
      for (const guild of readyClient.guilds.cache.values()) {
        void this.recordGuild(guild.id, guild.name);
      }
    });

    client.on(Events.Error, (error) => {
      logger.error({ err: error }, 'discord client error');
      void audit.record({
        actorType: 'adapter',
        action: 'discord.connection.error',
        metadata: { message: 'client error' },
      });
    });

    client.on(Events.ShardDisconnect, () => {
      if (this.state.state === 'connected') {
        this.state = { state: 'disconnected', detail: 'gateway disconnected' };
      }
    });
    client.on(Events.ShardResume, () => {
      if (this.client?.user) {
        this.state = { state: 'connected', identity: this.client.user.tag };
      }
    });

    client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteraction(interaction);
    });

    try {
      await client.login(config.discord.token);
    } catch (error) {
      // The platform must keep running (admin panel, health) without Discord.
      this.state = { state: 'error', detail: 'login failed — check DISCORD_TOKEN' };
      logger.error({ err: error }, 'discord login failed');
      void audit.record({
        actorType: 'adapter',
        action: 'discord.connection.error',
        metadata: { message: 'login failed' },
      });
    }
  }

  async stop(): Promise<void> {
    for (const session of this.voiceSessions.values()) {
      try {
        await session.disconnect();
      } catch {
        // best-effort cleanup
      }
    }
    this.voiceSessions.clear();
    if (this.client) {
      await this.client.destroy();
      this.client = null;
    }
    if (this.state.state !== 'disabled') {
      this.state = { state: 'disconnected' };
    }
  }

  getStatus(): AdapterStatus {
    return { ...this.state };
  }

  // -------------------------------------------------------------------------

  private async handleInteraction(interaction: Interaction): Promise<void> {
    if (!(interaction instanceof ChatInputCommandInteraction)) return;
    const ctx = this.ctx;
    if (!ctx) return;

    const commandContext = this.buildCommandContext(interaction);
    try {
      await ctx.dispatch(commandContext);
    } catch (error) {
      // The dispatcher has its own error boundary; this is the last resort.
      ctx.logger.error({ err: error, command: interaction.commandName }, 'dispatch failed');
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: GENERIC_USER_ERROR });
        } else {
          await interaction.reply({ content: GENERIC_USER_ERROR, flags: MessageFlags.Ephemeral });
        }
      } catch {
        // Nothing more we can safely do.
      }
    }
  }

  private buildCommandContext(interaction: ChatInputCommandInteraction): CommandContext {
    const ctx = this.ctx;
    if (!ctx) throw new Error('adapter not started');

    const options: Record<string, string | number | boolean | undefined> = {};
    for (const option of interaction.options.data) {
      if (
        typeof option.value === 'string' ||
        typeof option.value === 'number' ||
        typeof option.value === 'boolean'
      ) {
        options[option.name] = option.value;
      }
    }

    const displayName =
      (interaction.member && 'displayName' in interaction.member
        ? (interaction.member as { displayName?: string }).displayName
        : undefined) ?? interaction.user.username;

    return {
      commandName: interaction.commandName,
      adapterKey: this.key,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      user: { id: interaction.user.id, displayName },
      options,
      logger: ctx.logger.child({ command: interaction.commandName }),
      voice: interaction.inGuild() ? this.buildVoiceCapability(interaction) : null,
      defer: async () => {
        if (!interaction.deferred && !interaction.replied) {
          await interaction.deferReply();
        }
      },
      reply: async (payload: ReplyPayload) => {
        const normalized = normalizeReply(payload);
        if (interaction.deferred) {
          await interaction.editReply({ content: normalized.content });
        } else if (interaction.replied) {
          await interaction.followUp({
            content: normalized.content,
            flags: normalized.ephemeral ? MessageFlags.Ephemeral : undefined,
          });
        } else {
          await interaction.reply({
            content: normalized.content,
            flags: normalized.ephemeral ? MessageFlags.Ephemeral : undefined,
          });
        }
      },
    };
  }

  private buildVoiceCapability(interaction: ChatInputCommandInteraction): VoiceCapability {
    const guildId = interaction.guildId;
    const client = this.client;
    const logger = this.ctx?.logger;
    if (!guildId || !client || !logger) {
      throw new Error('voice capability requires a guild interaction and a live client');
    }

    return {
      getUserVoiceChannel: async (): Promise<{ id: string; name: string } | null> => {
        const guild = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(interaction.user.id);
        const channel = member.voice.channel;
        return channel ? { id: channel.id, name: channel.name } : null;
      },

      getActiveSession: (): VoiceSession | null => {
        const session = this.voiceSessions.get(guildId);
        if (!session || session.destroyed) {
          this.voiceSessions.delete(guildId);
          return null;
        }
        return session;
      },

      join: async (channelId: string): Promise<VoiceSession> => {
        const existing = this.voiceSessions.get(guildId);
        if (existing && !existing.destroyed && existing.channelId === channelId) {
          return existing;
        }
        if (existing && !existing.destroyed) {
          // Moving channels: tear the old connection down first.
          await existing.disconnect();
        }
        this.voiceSessions.delete(guildId);

        const guild = await client.guilds.fetch(guildId);
        const channel = await guild.channels.fetch(channelId);
        const session = await createDiscordVoiceSession({
          guildId,
          channelId,
          channelName: channel?.name,
          adapterCreator: guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
          logger: logger.child({ guildId }),
          onDestroyed: () => {
            if (this.voiceSessions.get(guildId) === session) {
              this.voiceSessions.delete(guildId);
            }
          },
        });
        this.voiceSessions.set(guildId, session);
        await this.recordGuild(guildId, guild.name);
        return session;
      },
    };
  }

  private async recordGuild(_externalId: string, _name: string): Promise<void> {
    // Guild persistence is wired by the bot app (it owns the database); the
    // adapter only reports through audit. Kept as a hook for the app layer.
    this.onGuildSeen?.(_externalId, _name);
  }

  /** Optional hook set by the bot app to persist guilds it encounters. */
  onGuildSeen: ((externalId: string, name: string) => void) | undefined;
}

/** Exported for unit tests. */
export function normalizeReply(payload: ReplyPayload): { content: string; ephemeral: boolean } {
  if (typeof payload === 'string') return { content: payload, ephemeral: false };
  return { content: payload.content, ephemeral: payload.ephemeral ?? false };
}
