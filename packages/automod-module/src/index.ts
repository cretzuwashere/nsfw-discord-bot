import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  GuildServiceProvider,
  MessageCreateEvent,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { isSpam, matchesRule, type AutomodRuleType, type RuleConfig } from './matcher.js';
import { createAutomodRepo, type AutomodRepo, type AutomodRuleRow } from './repo.js';

export interface AutomodModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
  adapterKey?: string;
}

export interface AutomodModuleHandle {
  module: BotModule;
  repo: AutomodRepo;
  /** True when content-based rules can actually see message text. */
  contentRulesAvailable: boolean;
}

const SPAM_WINDOW_MS = 10_000;
const SPAM_THRESHOLD = 5;
const ESCALATION_WINDOW_MS = 10 * 60_000;

export function createAutomodModule(options: AutomodModuleOptions): AutomodModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.automod });
  const repo = createAutomodRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const adapterKey = options.adapterKey ?? 'discord';
  const contentRulesAvailable = options.config.discord.enableMessageContent;

  // Per-user recent-message timestamps for the spam rule (in-memory). Pruned
  // opportunistically so quiet users' keys don't accumulate unbounded.
  const recentMessages = new Map<string, number[]>();
  function pruneSpamMap(now: number): void {
    if (recentMessages.size < 5000) return;
    for (const [key, stamps] of recentMessages) {
      const live = stamps.filter((ts) => now - ts < SPAM_WINDOW_MS);
      if (live.length === 0) recentMessages.delete(key);
      else recentMessages.set(key, live);
    }
  }

  async function handleMessage(event: MessageCreateEvent): Promise<void> {
    if (!event.guild) return;
    const guild = await guilds.upsertByExternalId({
      adapterKey,
      externalId: event.guild.externalId,
      name: event.guild.name,
    });
    const rules = await repo.enabledForGuild(guild.id);
    if (rules.length === 0) return;

    // Track message rate only when a spam rule is actually enabled.
    const now = Date.now();
    let recent: number[] = [];
    if (rules.some((r) => r.ruleType === 'spam')) {
      const spamKey = `${event.guild.externalId}:${event.author.externalId}`;
      recent = (recentMessages.get(spamKey) ?? []).filter((ts) => now - ts < SPAM_WINDOW_MS);
      recent.push(now);
      recentMessages.set(spamKey, recent);
      pruneSpamMap(now);
    }

    const service = options.guildServiceProvider.forGuild(event.guild.externalId);

    for (const rule of rules) {
      // Ignored channels / roles.
      if (rule.ignoredChannelIds.includes(event.channelId)) continue;
      if (event.authorRoleIds.some((r) => rule.ignoredRoleIds.includes(r))) continue;

      const ruleType = rule.ruleType as AutomodRuleType;
      const config = (rule.config ?? {}) as RuleConfig;

      const result =
        ruleType === 'spam'
          ? {
              violated: isSpam(recent.length, (config as { threshold?: number }).threshold ?? SPAM_THRESHOLD),
              reason: 'message spam',
            }
          : matchesRule(ruleType, config, {
              content: event.content,
              mentionCount: event.mentionCount,
              hasAttachments: event.hasAttachments,
              accountAgeDays: event.author.createdAt
                ? (Date.now() - event.author.createdAt.getTime()) / 86_400_000
                : undefined,
            });
      if (!result.violated) continue;

      await applyAction(event, guild.id, rule, result.reason ?? '', service);
      break; // one action per message
    }
  }

  async function applyAction(
    event: MessageCreateEvent,
    guildId: string,
    rule: AutomodRuleRow,
    reason: string,
    service: ReturnType<GuildServiceProvider['forGuild']>
  ): Promise<void> {
    // Escalation: count recent violations for this user.
    let action = rule.action;
    if (rule.escalationThreshold && rule.escalationAction) {
      const since = new Date(Date.now() - ESCALATION_WINDOW_MS);
      const count = await repo.countUserViolations(guildId, event.author.externalId, since);
      if (count + 1 >= rule.escalationThreshold) action = rule.escalationAction;
    }

    if (service && action !== 'log_only') {
      try {
        switch (action) {
          case 'delete':
            await service.deleteMessage(event.channelId, event.messageId);
            break;
          case 'timeout':
          case 'mute':
            await service.timeoutMember(event.author.externalId, 600, `automod: ${reason}`);
            break;
          case 'kick':
            await service.kickMember(event.author.externalId, `automod: ${reason}`);
            break;
          case 'ban':
            await service.banMember(event.author.externalId, `automod: ${reason}`);
            break;
          case 'warn':
            if (rule.responseMessage) {
              await service.sendMessage(event.channelId, {
                content: `<@${event.author.externalId}> ${rule.responseMessage}`,
                allowMentions: { everyone: false, roles: [], users: [event.author.externalId] },
              });
            }
            break;
        }
      } catch (error) {
        logger.debug({ err: error, action }, 'automod action failed');
      }
    }

    await repo.recordViolation({
      guildId,
      ruleId: rule.id,
      userExternalId: event.author.externalId,
      channelId: event.channelId,
      ruleType: rule.ruleType,
      actionTaken: action,
      detail: reason,
    });
    await options.audit.record({
      actorType: 'system',
      action: 'automod.violation',
      moduleKey: 'automod',
      severity: 'notice',
      guildId: event.guild?.externalId,
      targetType: 'user',
      targetId: event.author.externalId,
      metadata: { rule: rule.ruleType, action, reason },
    });
  }

  const module: BotModule = {
    key: MODULE_KEYS.automod,
    name: 'Auto-Moderation',
    description: 'Banned words, spam, mention, caps, invite and link filtering with escalation.',
    metadata: {
      requiredPermissions: ['ManageMessages', 'ModerateMembers'],
      requiredIntents: ['Guilds', 'GuildMessages', 'MessageContent'],
      auditEvents: ['automod.violation'],
    },
    commands: [],
    events: [{ type: 'message.create', handle: (event) => handleMessage(event as MessageCreateEvent) }],
    onLoad(ctx) {
      ctx.logger.info(
        { contentRules: contentRulesAvailable ? 'enabled' : 'DEGRADED (MessageContent intent off)' },
        'auto-moderation module ready'
      );
      if (!contentRulesAvailable) {
        ctx.logger.warn(
          'Content-based automod rules (banned words, links, caps) need the MessageContent ' +
            'privileged intent. Set DISCORD_ENABLE_MESSAGE_CONTENT=true and enable it in the Discord portal.'
        );
      }
    },
  };

  return { module, repo, contentRulesAvailable };
}

export { createAutomodRepo } from './repo.js';
export type { AutomodRepo, AutomodRuleRow, AutomodViolationRow } from './repo.js';
export { matchesRule, isSpam } from './matcher.js';
export type { AutomodRuleType, RuleConfig, MessageInfo } from './matcher.js';
