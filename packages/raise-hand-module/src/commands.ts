import type { CommandContext, CommandDefinition } from '@botplatform/core';
import type { SpeakerQueueService } from './service.js';

/** Discord permission that gates the moderator slash commands. */
const MODERATOR_PERMISSIONS = ['MuteMembers'];

/** The caller's current voice channel, or null when they are not in one. */
async function callerVoice(ctx: CommandContext): Promise<{ id: string; name: string } | null> {
  if (!ctx.voice) return null;
  return ctx.voice.getUserVoiceChannel();
}

/**
 * Eight top-level slash commands. They are intentionally NOT grouped under one
 * parent: Discord `default_member_permissions` gates a whole command, so the
 * open user commands and the moderator-gated commands must be separate top-level
 * commands to be gated independently.
 */
export function buildRaiseHandCommands(service: SpeakerQueueService): CommandDefinition[] {
  const raiseHand: CommandDefinition = {
    name: 'raise-hand',
    description: 'Raise your hand to join the speaking queue for your voice channel',
    guildOnly: true,
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join a voice channel first, then raise your hand.', ephemeral: true });
        return;
      }
      const message = await service.raiseHand({
        guildExternalId: ctx.guildId!,
        voiceChannelId: vc.id,
        voiceChannelName: vc.name,
        user: { externalId: ctx.user.id, displayName: ctx.user.displayName },
      });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const lowerHand: CommandDefinition = {
    name: 'lower-hand',
    description: 'Lower your hand and leave the speaking queue',
    guildOnly: true,
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'You can only lower your hand from inside a voice channel.', ephemeral: true });
        return;
      }
      const message = await service.lowerHand({
        guildExternalId: ctx.guildId!,
        voiceChannelId: vc.id,
        user: { externalId: ctx.user.id, displayName: ctx.user.displayName },
      });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const speakerQueue: CommandDefinition = {
    name: 'speaker-queue',
    description: 'Show the current speaking order for your voice channel',
    guildOnly: true,
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join a voice channel to see its speaking queue.', ephemeral: true });
        return;
      }
      const message = await service.showQueue({ guildExternalId: ctx.guildId!, voiceChannelId: vc.id });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const nextSpeaker: CommandDefinition = {
    name: 'next-speaker',
    description: 'Moderator: advance the queue to the next speaker',
    guildOnly: true,
    defaultMemberPermissions: MODERATOR_PERMISSIONS,
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join the voice channel you want to manage, then run this command.', ephemeral: true });
        return;
      }
      const message = await service.nextSpeaker({ guildExternalId: ctx.guildId!, voiceChannelId: vc.id });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const removeSpeaker: CommandDefinition = {
    name: 'remove-speaker',
    description: 'Moderator: remove a member from the speaking queue',
    guildOnly: true,
    defaultMemberPermissions: MODERATOR_PERMISSIONS,
    options: [{ name: 'user', description: 'Member to remove from the queue', type: 'user', required: true }],
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join the voice channel you want to manage, then run this command.', ephemeral: true });
        return;
      }
      const targetExternalId = String(ctx.options['user'] ?? '');
      if (!targetExternalId) {
        await ctx.reply({ content: 'Pick a member to remove.', ephemeral: true });
        return;
      }
      const message = await service.removeSpeaker({
        guildExternalId: ctx.guildId!,
        voiceChannelId: vc.id,
        targetExternalId,
      });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const clearQueue: CommandDefinition = {
    name: 'clear-speaker-queue',
    description: 'Moderator: clear the entire speaking queue for your voice channel',
    guildOnly: true,
    defaultMemberPermissions: MODERATOR_PERMISSIONS,
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join the voice channel you want to manage, then run this command.', ephemeral: true });
        return;
      }
      const message = await service.clearQueue({ guildExternalId: ctx.guildId!, voiceChannelId: vc.id });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const promoteSpeaker: CommandDefinition = {
    name: 'promote-speaker',
    description: 'Moderator: move a member to the front of the speaking queue',
    guildOnly: true,
    defaultMemberPermissions: MODERATOR_PERMISSIONS,
    options: [{ name: 'user', description: 'Member to promote to the front', type: 'user', required: true }],
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join the voice channel you want to manage, then run this command.', ephemeral: true });
        return;
      }
      const targetExternalId = String(ctx.options['user'] ?? '');
      if (!targetExternalId) {
        await ctx.reply({ content: 'Pick a member to promote.', ephemeral: true });
        return;
      }
      const message = await service.promoteSpeaker({
        guildExternalId: ctx.guildId!,
        voiceChannelId: vc.id,
        targetExternalId,
      });
      await ctx.reply({ content: message, ephemeral: true });
    },
  };

  const speakerPanel: CommandDefinition = {
    name: 'speaker-panel',
    description: 'Moderator: post the speaker-queue control panel for your voice channel',
    guildOnly: true,
    defaultMemberPermissions: MODERATOR_PERMISSIONS,
    async execute(ctx) {
      const vc = await callerVoice(ctx);
      if (!vc) {
        await ctx.reply({ content: 'Join the voice channel you want to manage, then run this command.', ephemeral: true });
        return;
      }
      await ctx.defer();
      const result = await service.postPanel({
        guildExternalId: ctx.guildId!,
        voiceChannelId: vc.id,
        voiceChannelName: vc.name,
        channelId: ctx.channelId!,
      });
      await ctx.reply({ content: result.message, ephemeral: true });
    },
  };

  return [
    raiseHand,
    lowerHand,
    speakerQueue,
    nextSpeaker,
    removeSpeaker,
    clearQueue,
    promoteSpeaker,
    speakerPanel,
  ];
}
