import type { AuditLogPort, CommandContext, CommandDefinition, GuildServiceProvider } from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import { toSafeUserMessage, truncate } from '@botplatform/shared';
import type { ModerationCasesRepo, ModerationCaseRow } from './cases-repo.js';
import type { WarningService } from './services/warning-service.js';

export interface ModerationCommandDeps {
  cases: ModerationCasesRepo;
  guilds: GuildsRepo;
  warnings: WarningService;
  guildServiceProvider: GuildServiceProvider;
  audit: AuditLogPort;
  adapterKey?: string;
}

type ActionType = ModerationCaseRow['actionType'];

/** Safe, permission-gated moderation commands acting via the GuildService. */
export function buildModerationCommands(deps: ModerationCommandDeps): CommandDefinition[] {
  const { cases, guilds, warnings, guildServiceProvider, audit } = deps;
  const adapterKey = deps.adapterKey ?? 'discord';

  async function guildId(externalId: string): Promise<string> {
    const guild = await guilds.upsertByExternalId({ adapterKey, externalId });
    return guild.id;
  }

  /** Shared scaffolding: resolve service, guard owner, record case, log, audit. */
  async function runAction(
    ctx: CommandContext,
    opts: {
      actionType: ActionType;
      targetExternalId: string;
      reason: string;
      protectOwner?: boolean;
      perform: (service: NonNullable<ReturnType<GuildServiceProvider['forGuild']>>) => Promise<void>;
      expiresAt?: Date;
    }
  ): Promise<void> {
    const service = guildServiceProvider.forGuild(ctx.guildId!);
    if (!service) {
      await ctx.reply({ content: 'The bot is not connected right now.', ephemeral: true });
      return;
    }
    if (opts.protectOwner && (await service.isGuildOwner(opts.targetExternalId).catch(() => false))) {
      await ctx.reply({ content: 'That action cannot target the server owner.', ephemeral: true });
      return;
    }

    try {
      await opts.perform(service);
    } catch (error) {
      await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
      return;
    }

    const gId = await guildId(ctx.guildId!);
    const moderationCase = await cases.create({
      guildId: gId,
      actionType: opts.actionType,
      targetUserExternalId: opts.targetExternalId,
      moderatorExternalId: ctx.user.id,
      reason: opts.reason,
      expiresAt: opts.expiresAt ?? null,
    });

    // Optional DM + mod-log are best-effort.
    const settings = await cases.getSettings(gId);
    if (settings?.dmOnAction) {
      await service
        .sendDirectMessage(opts.targetExternalId, {
          content: `You received a moderation action (${opts.actionType}) in a server. Reason: ${opts.reason || 'n/a'}`,
          allowMentions: { everyone: false, roles: [], users: [] },
        })
        .catch(() => {});
    }
    if (settings?.logChannelId) {
      await service
        .sendMessage(settings.logChannelId, {
          content: `**Case #${moderationCase.caseNumber}** · ${opts.actionType} · <@${opts.targetExternalId}> by <@${ctx.user.id}>\nReason: ${opts.reason || 'n/a'}`,
          allowMentions: { everyone: false, roles: [], users: [] },
        })
        .catch(() => {});
    }

    await audit.record({
      actorType: 'platform_user',
      actorId: ctx.user.id,
      action: `moderation.${opts.actionType}`,
      moduleKey: 'moderation',
      severity: 'notice',
      guildId: ctx.guildId!,
      targetType: 'user',
      targetId: opts.targetExternalId,
      metadata: { case: moderationCase.caseNumber },
    });

    await ctx.reply(`Case #${moderationCase.caseNumber}: ${opts.actionType} applied.`);
  }

  function userOpt(ctx: CommandContext): string {
    return String(ctx.options['user'] ?? '');
  }
  function reasonOpt(ctx: CommandContext): string {
    return truncate(String(ctx.options['reason'] ?? ''), 480);
  }

  const warn: CommandDefinition = {
    name: 'warn',
    description: 'Warn a member',
    guildOnly: true,
    defaultMemberPermissions: ['ModerateMembers'],
    options: [
      { name: 'user', description: 'Member to warn', type: 'user', required: true },
      { name: 'reason', description: 'Reason', type: 'string', required: true },
    ],
    async execute(ctx) {
      const gId = await guildId(ctx.guildId!);
      await warnings.warnUser({
        guildExternalId: ctx.guildId!,
        adapterKey,
        user: { externalId: userOpt(ctx) },
        moderatorId: ctx.user.id,
        reason: reasonOpt(ctx),
      });
      await cases.create({
        guildId: gId,
        actionType: 'warn',
        targetUserExternalId: userOpt(ctx),
        moderatorExternalId: ctx.user.id,
        reason: reasonOpt(ctx),
      });
      await ctx.reply(`Warned <@${userOpt(ctx)}>.`);
    },
  };

  const warningsCmd: CommandDefinition = {
    name: 'warnings',
    description: 'List a member’s warnings',
    guildOnly: true,
    defaultMemberPermissions: ['ModerateMembers'],
    options: [{ name: 'user', description: 'Member', type: 'user', required: true }],
    async execute(ctx) {
      const gId = await guildId(ctx.guildId!);
      const rows = (await cases.listByUser(gId, userOpt(ctx))).filter((c) => c.actionType === 'warn');
      if (rows.length === 0) {
        await ctx.reply({ content: 'No warnings on record.', ephemeral: true });
        return;
      }
      const lines = rows
        .slice(0, 10)
        .map((c) => `#${c.caseNumber} · ${c.createdAt.toISOString().slice(0, 10)} · ${truncate(c.reason, 80)}`);
      await ctx.reply({ content: lines.join('\n'), ephemeral: true });
    },
  };

  const clearWarnings: CommandDefinition = {
    name: 'clearwarnings',
    description: 'Clear a member’s active warnings',
    guildOnly: true,
    defaultMemberPermissions: ['ModerateMembers'],
    options: [{ name: 'user', description: 'Member', type: 'user', required: true }],
    async execute(ctx) {
      // Foundation: warnings remain in history; this records the clear action.
      const gId = await guildId(ctx.guildId!);
      await cases.create({
        guildId: gId,
        actionType: 'other',
        targetUserExternalId: userOpt(ctx),
        moderatorExternalId: ctx.user.id,
        reason: 'cleared warnings',
      });
      await ctx.reply(`Recorded a warnings-clear for <@${userOpt(ctx)}>.`);
    },
  };

  const timeout: CommandDefinition = {
    name: 'timeout',
    description: 'Time out (mute) a member for some minutes',
    guildOnly: true,
    defaultMemberPermissions: ['ModerateMembers'],
    options: [
      { name: 'user', description: 'Member', type: 'user', required: true },
      { name: 'minutes', description: 'Duration in minutes', type: 'integer', required: true },
      { name: 'reason', description: 'Reason', type: 'string' },
    ],
    async execute(ctx) {
      const minutes = Math.min(Math.max(Number(ctx.options['minutes'] ?? 0), 1), 40320);
      await runAction(ctx, {
        actionType: 'mute',
        targetExternalId: userOpt(ctx),
        reason: reasonOpt(ctx),
        protectOwner: true,
        expiresAt: new Date(Date.now() + minutes * 60_000),
        perform: (s) => s.timeoutMember(userOpt(ctx), minutes * 60, reasonOpt(ctx)),
      });
    },
  };

  const untimeout: CommandDefinition = {
    name: 'untimeout',
    description: 'Remove a member’s timeout',
    guildOnly: true,
    defaultMemberPermissions: ['ModerateMembers'],
    options: [
      { name: 'user', description: 'Member', type: 'user', required: true },
      { name: 'reason', description: 'Reason', type: 'string' },
    ],
    async execute(ctx) {
      await runAction(ctx, {
        actionType: 'unmute',
        targetExternalId: userOpt(ctx),
        reason: reasonOpt(ctx),
        perform: (s) => s.removeTimeout(userOpt(ctx), reasonOpt(ctx)),
      });
    },
  };

  const kick: CommandDefinition = {
    name: 'kick',
    description: 'Kick a member',
    guildOnly: true,
    defaultMemberPermissions: ['KickMembers'],
    options: [
      { name: 'user', description: 'Member', type: 'user', required: true },
      { name: 'reason', description: 'Reason', type: 'string' },
    ],
    async execute(ctx) {
      await runAction(ctx, {
        actionType: 'kick',
        targetExternalId: userOpt(ctx),
        reason: reasonOpt(ctx),
        protectOwner: true,
        perform: (s) => s.kickMember(userOpt(ctx), reasonOpt(ctx)),
      });
    },
  };

  const ban: CommandDefinition = {
    name: 'ban',
    description: 'Ban a member',
    guildOnly: true,
    defaultMemberPermissions: ['BanMembers'],
    options: [
      { name: 'user', description: 'Member', type: 'user', required: true },
      { name: 'reason', description: 'Reason', type: 'string' },
      { name: 'delete_days', description: 'Delete messages from the last N days (0-7)', type: 'integer' },
    ],
    async execute(ctx) {
      const days = Math.min(Math.max(Number(ctx.options['delete_days'] ?? 0), 0), 7);
      await runAction(ctx, {
        actionType: 'ban',
        targetExternalId: userOpt(ctx),
        reason: reasonOpt(ctx),
        protectOwner: true,
        perform: (s) => s.banMember(userOpt(ctx), reasonOpt(ctx), days * 86400),
      });
    },
  };

  const unban: CommandDefinition = {
    name: 'unban',
    description: 'Unban a user by ID',
    guildOnly: true,
    defaultMemberPermissions: ['BanMembers'],
    options: [
      { name: 'user_id', description: 'User ID to unban', type: 'string', required: true },
      { name: 'reason', description: 'Reason', type: 'string' },
    ],
    async execute(ctx) {
      const targetId = String(ctx.options['user_id'] ?? '');
      await runAction(ctx, {
        actionType: 'unban',
        targetExternalId: targetId,
        reason: reasonOpt(ctx),
        perform: (s) => s.unbanMember(targetId, reasonOpt(ctx)),
      });
    },
  };

  const purge: CommandDefinition = {
    name: 'purge',
    description: 'Bulk-delete recent messages in this channel',
    guildOnly: true,
    defaultMemberPermissions: ['ManageMessages'],
    options: [{ name: 'amount', description: 'How many (1-100)', type: 'integer', required: true }],
    async execute(ctx) {
      const service = guildServiceProvider.forGuild(ctx.guildId!);
      if (!service) {
        await ctx.reply({ content: 'The bot is not connected right now.', ephemeral: true });
        return;
      }
      const amount = Math.min(Math.max(Number(ctx.options['amount'] ?? 0), 1), 100);
      try {
        const deleted = await service.purgeMessages(ctx.channelId!, amount);
        await audit.record({
          actorType: 'platform_user',
          actorId: ctx.user.id,
          action: 'moderation.purge',
          moduleKey: 'moderation',
          severity: 'notice',
          guildId: ctx.guildId!,
          metadata: { deleted },
        });
        await ctx.reply({ content: `Deleted ${deleted} message(s).`, ephemeral: true });
      } catch (error) {
        await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
      }
    },
  };

  const slowmode: CommandDefinition = {
    name: 'slowmode',
    description: 'Set this channel’s slowmode (seconds)',
    guildOnly: true,
    defaultMemberPermissions: ['ManageChannels'],
    options: [{ name: 'seconds', description: 'Seconds (0 to disable, max 21600)', type: 'integer', required: true }],
    async execute(ctx) {
      const service = guildServiceProvider.forGuild(ctx.guildId!);
      if (!service) {
        await ctx.reply({ content: 'The bot is not connected right now.', ephemeral: true });
        return;
      }
      const seconds = Math.min(Math.max(Number(ctx.options['seconds'] ?? 0), 0), 21600);
      try {
        await service.setSlowmode(ctx.channelId!, seconds);
        await ctx.reply(`Slowmode set to ${seconds}s.`);
      } catch (error) {
        await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
      }
    },
  };

  function lockCommand(name: 'lock' | 'unlock', locked: boolean): CommandDefinition {
    return {
      name,
      description: locked ? 'Lock this channel' : 'Unlock this channel',
      guildOnly: true,
      defaultMemberPermissions: ['ManageChannels'],
      options: [{ name: 'reason', description: 'Reason', type: 'string' }],
      async execute(ctx) {
        const service = guildServiceProvider.forGuild(ctx.guildId!);
        if (!service) {
          await ctx.reply({ content: 'The bot is not connected right now.', ephemeral: true });
          return;
        }
        try {
          await service.setChannelLocked(ctx.channelId!, locked, reasonOpt(ctx));
          await ctx.reply(locked ? 'Channel locked.' : 'Channel unlocked.');
        } catch (error) {
          await ctx.reply({ content: toSafeUserMessage(error), ephemeral: true });
        }
      },
    };
  }

  return [
    warn,
    warningsCmd,
    clearWarnings,
    timeout,
    untimeout,
    kick,
    ban,
    unban,
    purge,
    slowmode,
    lockCommand('lock', true),
    lockCommand('unlock', false),
  ];
}
