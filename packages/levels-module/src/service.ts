import type {
  ComponentInteractionEvent,
  GuildServiceProvider,
  MessageButton,
  MessageCreateEvent,
  OutgoingMessage,
} from '@botplatform/core';
import type { GuildsRepo } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { levelForXp, progressFor, rollXp, shouldAward, type Rng } from './logic.js';
import type { LevelConfigInput, LevelSettingsRow, LevelsRepo } from './repo.js';

const PAGE_SIZE = 10;
const SETTINGS_TTL_MS = 30_000;
const COLOR = 0x9b59b6;

export interface LevelsServiceDeps {
  repo: LevelsRepo;
  guilds: GuildsRepo;
  guildServiceProvider: GuildServiceProvider;
  logger: Logger;
  adapterKey: string;
  rng?: Rng;
}

function bar(into: number, need: number): string {
  const ratio = need > 0 ? Math.max(0, Math.min(1, into / need)) : 0;
  const filled = Math.round(ratio * 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
}

export function createLevelsService(deps: LevelsServiceDeps) {
  const rng = deps.rng ?? Math.random;
  // Caches to avoid a DB hit on every message.
  const guildIdCache = new Map<string, string>(); // externalId -> internal id
  const settingsCache = new Map<string, { settings: LevelSettingsRow; at: number }>();
  const cooldown = new Map<string, number>(); // `${guildId}:${userId}` -> last award ms

  async function resolveGuildId(externalId: string): Promise<string> {
    const cached = guildIdCache.get(externalId);
    if (cached) return cached;
    const guild = await deps.guilds.upsertByExternalId({ adapterKey: deps.adapterKey, externalId });
    guildIdCache.set(externalId, guild.id);
    return guild.id;
  }

  async function settingsFor(guildId: string, nowMs: number): Promise<LevelSettingsRow> {
    const cached = settingsCache.get(guildId);
    if (cached && nowMs - cached.at < SETTINGS_TTL_MS) return cached.settings;
    const settings = await deps.repo.ensureSettings(guildId);
    settingsCache.set(guildId, { settings, at: nowMs });
    return settings;
  }

  async function onLevelUp(
    guildExternalId: string,
    guildId: string,
    userId: string,
    oldLevel: number,
    newLevel: number,
    settings: LevelSettingsRow,
    fallbackChannelId: string
  ): Promise<void> {
    const svc = deps.guildServiceProvider.forGuild(guildExternalId);
    if (!svc) return;
    const rewards = await deps.repo.rewardsBetween(guildId, oldLevel, newLevel);
    for (const reward of rewards) {
      const canManage = await svc.canManageRole(reward.roleId).catch(() => false);
      if (!canManage) {
        deps.logger.warn({ roleId: reward.roleId, level: reward.level }, 'cannot grant level reward (hierarchy)');
        continue;
      }
      await svc
        .addRole(userId, reward.roleId, `level ${reward.level} reward`)
        .catch((error) => deps.logger.warn({ err: error }, 'level reward grant failed'));
    }
    const channelId = settings.announceChannelId || fallbackChannelId;
    const text = settings.levelUpMessage.replace('{user}', `<@${userId}>`).replace('{level}', String(newLevel));
    await svc
      .sendMessage(channelId, { content: text, allowMentions: { everyone: false, roles: [], users: [userId] } })
      .catch((error) => deps.logger.warn({ err: error }, 'level-up announce failed'));
  }

  async function leaderboardPage(guildExternalId: string, page: number): Promise<OutgoingMessage> {
    const guildId = await resolveGuildId(guildExternalId);
    const total = await deps.repo.countMembers(guildId);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const p = Math.max(0, Math.min(page, pages - 1));
    const rows = await deps.repo.topByXp(guildId, PAGE_SIZE, p * PAGE_SIZE);
    const medals = ['🥇', '🥈', '🥉'];
    const body =
      rows.length === 0
        ? '_No XP earned yet._'
        : rows
            .map((r, i) => {
              const rank = p * PAGE_SIZE + i;
              return `${medals[rank] ?? `**${rank + 1}.**`} <@${r.userExternalId}> — Level ${r.level} (${r.xp.toLocaleString()} XP)`;
            })
            .join('\n');
    const buttons: MessageButton[] = [
      { customId: `lvl:lb:${p - 1}`, label: '◀ Prev', style: 'secondary' },
      { customId: `lvl:lb:${p + 1}`, label: 'Next ▶', style: 'secondary' },
    ];
    return {
      embed: { title: '🏆 XP Leaderboard', description: body, color: COLOR, footer: `Page ${p + 1}/${pages}` },
      buttons,
      allowMentions: { everyone: false, roles: [], users: [] },
    };
  }

  return {
    leaderboardPage,

    async handleMessage(event: MessageCreateEvent): Promise<void> {
      if (event.author.bot || !event.guild) return;
      const nowMs = Date.now();
      const guildId = await resolveGuildId(event.guild.externalId);
      const settings = await settingsFor(guildId, nowMs);
      if (!settings.enabled) return;
      if (settings.noXpChannelIds.includes(event.channelId)) return;
      const key = `${guildId}:${event.author.externalId}`;
      const last = cooldown.get(key);
      if (!shouldAward(last ? new Date(last) : null, new Date(nowMs), settings.cooldownSeconds)) return;
      cooldown.set(key, nowMs);

      const member = await deps.repo.ensureMember(guildId, event.author.externalId);
      const delta = rollXp(settings.xpMin, settings.xpMax, rng);
      const newXp = member.xp + delta;
      const newLevel = levelForXp(newXp);
      await deps.repo.applyAward(guildId, event.author.externalId, newXp, newLevel, new Date(nowMs));
      if (newLevel > member.level) {
        await onLevelUp(event.guild.externalId, guildId, event.author.externalId, member.level, newLevel, settings, event.channelId);
      }
    },

    async rank(guildExternalId: string, userExternalId: string): Promise<OutgoingMessage> {
      const guildId = await resolveGuildId(guildExternalId);
      const member = await deps.repo.getMember(guildId, userExternalId);
      const xp = member?.xp ?? 0;
      const prog = progressFor(xp);
      const rank = await deps.repo.rankOf(guildId, xp);
      const total = await deps.repo.countMembers(guildId);
      return {
        embed: {
          title: '📈 Rank',
          description: `<@${userExternalId}>\n\n**Level ${prog.level}** — Rank #${rank} of ${total}\n${bar(prog.intoLevel, prog.neededForLevel)} ${prog.intoLevel}/${prog.neededForLevel} XP\nTotal XP: ${xp.toLocaleString()}`,
          color: COLOR,
        },
        allowMentions: { everyone: false, roles: [], users: [] },
      };
    },

    async setConfig(guildExternalId: string, patch: LevelConfigInput): Promise<void> {
      const guildId = await resolveGuildId(guildExternalId);
      await deps.repo.setConfig(guildId, patch);
      settingsCache.delete(guildId);
    },

    async toggleNoXp(guildExternalId: string, channelId: string, add: boolean): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      const settings = await deps.repo.ensureSettings(guildId);
      const set = new Set(settings.noXpChannelIds);
      if (add) set.add(channelId);
      else set.delete(channelId);
      await deps.repo.setConfig(guildId, { noXpChannelIds: [...set] });
      settingsCache.delete(guildId);
      return add ? `<#${channelId}> will no longer earn XP.` : `<#${channelId}> will earn XP again.`;
    },

    async addReward(guildExternalId: string, level: number, roleId: string): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      await deps.repo.addReward(guildId, level, roleId);
      return `Members reaching level ${level} will get <@&${roleId}>.`;
    },
    async removeReward(guildExternalId: string, level: number): Promise<string> {
      const guildId = await resolveGuildId(guildExternalId);
      await deps.repo.removeReward(guildId, level);
      return `Removed the level ${level} reward.`;
    },
    async listRewards(guildExternalId: string): Promise<OutgoingMessage> {
      const guildId = await resolveGuildId(guildExternalId);
      const rewards = await deps.repo.listRewards(guildId);
      const body =
        rewards.length === 0
          ? '_No level rewards configured._'
          : rewards.map((r) => `Level ${r.level} → <@&${r.roleId}>`).join('\n');
      return {
        embed: { title: '🎁 Level Rewards', description: body, color: COLOR },
        allowMentions: { everyone: false, roles: [], users: [] },
      };
    },

    async handleInteraction(event: ComponentInteractionEvent): Promise<void> {
      if (!event.guild || !event.customId.startsWith('lvl:lb:')) return;
      const page = Number.parseInt(event.customId.split(':')[2] ?? '0', 10) || 0;
      const msg = await leaderboardPage(event.guild.externalId, page);
      if (event.update) await event.update(msg);
      else await event.reply('Updated.');
    },
  };
}

export type LevelsService = ReturnType<typeof createLevelsService>;
