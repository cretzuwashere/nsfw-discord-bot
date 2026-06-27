import { createGuildsRepo, type Db } from '@botplatform/database';
import { createEconomyRepo } from '@botplatform/economy-module';
import { createPromptRepo } from '@botplatform/engagement-prompts-module';
import { createLevelsRepo } from '@botplatform/levels-module';
import { createServerStatsRepo } from '@botplatform/server-stats-module';
import { createTriviaRepo } from '@botplatform/trivia-module';
import type { AdminRouteContext, AdminRoutePlugin } from './context.js';

type FieldType = 'text' | 'number' | 'bool' | 'textarea';
interface Field {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
}

interface FunModuleConfig {
  key: string;
  title: string;
  moduleKey: string;
  fields: Field[];
  note?: string;
  load(db: Db, guildId: string): Promise<Record<string, unknown>>;
  save(db: Db, guildId: string, body: Record<string, unknown>): Promise<void>;
}

const str = (body: Record<string, unknown>, k: string): string =>
  typeof body[k] === 'string' ? (body[k] as string).trim() : '';
const numOr = (body: Record<string, unknown>, k: string, fallback: number): number => {
  const v = Number(body[k]);
  return Number.isFinite(v) ? v : fallback;
};
const boolFrom = (body: Record<string, unknown>, k: string): boolean =>
  body[k] === 'on' || body[k] === 'true' || body[k] === true;
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.trunc(n)));

const MODULES: FunModuleConfig[] = [
  {
    key: 'engagement-prompts',
    title: 'Engagement Prompts',
    moduleKey: 'engagement-prompts',
    note: 'On-demand prompts (/qotd, /wyr, …) work whenever the module is enabled. These settings only control the automatic daily Question of the Day.',
    fields: [
      { name: 'qotdEnabled', label: 'Post a daily Question of the Day', type: 'bool' },
      { name: 'qotdChannelId', label: 'Daily QOTD channel ID', type: 'text', help: 'Right-click the channel → Copy Channel ID (needs Developer Mode).' },
      { name: 'qotdHourUtc', label: 'Hour to post (UTC, 0–23)', type: 'number' },
    ],
    async load(db, guildId) {
      const s = await createPromptRepo(db).get(guildId);
      return { qotdEnabled: s?.qotdEnabled ?? false, qotdChannelId: s?.qotdChannelId ?? '', qotdHourUtc: s?.qotdHourUtc ?? 12 };
    },
    async save(db, guildId, body) {
      await createPromptRepo(db).setConfig(guildId, {
        qotdChannelId: str(body, 'qotdChannelId'),
        qotdEnabled: boolFrom(body, 'qotdEnabled'),
        qotdHourUtc: clamp(numOr(body, 'qotdHourUtc', 12), 0, 23),
      });
    },
  },
  {
    key: 'server-stats',
    title: 'Server Stats',
    moduleKey: 'server-stats',
    note: 'Message activity is always counted while the module is enabled. These settings control the weekly highlights recap post.',
    fields: [
      { name: 'recapEnabled', label: 'Post a weekly highlights recap', type: 'bool' },
      { name: 'recapChannelId', label: 'Recap channel ID', type: 'text' },
      { name: 'recapDow', label: 'Day of week (0=Sun … 6=Sat)', type: 'number' },
      { name: 'recapHourUtc', label: 'Hour to post (UTC, 0–23)', type: 'number' },
    ],
    async load(db, guildId) {
      const s = await createServerStatsRepo(db).getSettings(guildId);
      return { recapEnabled: s?.recapEnabled ?? false, recapChannelId: s?.recapChannelId ?? '', recapDow: s?.recapDow ?? 1, recapHourUtc: s?.recapHourUtc ?? 12 };
    },
    async save(db, guildId, body) {
      await createServerStatsRepo(db).setConfig(guildId, {
        recapChannelId: str(body, 'recapChannelId'),
        recapEnabled: boolFrom(body, 'recapEnabled'),
        recapDow: clamp(numOr(body, 'recapDow', 1), 0, 6),
        recapHourUtc: clamp(numOr(body, 'recapHourUtc', 12), 0, 23),
      });
    },
  },
  {
    key: 'trivia',
    title: 'Trivia',
    moduleKey: 'trivia',
    note: 'Members can always start a round with /trivia. These settings control automatic scheduled trivia.',
    fields: [
      { name: 'autoEnabled', label: 'Post automatic trivia rounds', type: 'bool' },
      { name: 'autoChannelId', label: 'Auto-trivia channel ID', type: 'text' },
      { name: 'autoIntervalMin', label: 'Minutes between rounds (min 5)', type: 'number' },
    ],
    async load(db, guildId) {
      const s = await createTriviaRepo(db).getSettings(guildId);
      return { autoEnabled: s?.autoEnabled ?? false, autoChannelId: s?.autoChannelId ?? '', autoIntervalMin: s?.autoIntervalMin ?? 360 };
    },
    async save(db, guildId, body) {
      await createTriviaRepo(db).setConfig(guildId, {
        autoChannelId: str(body, 'autoChannelId'),
        autoEnabled: boolFrom(body, 'autoEnabled'),
        autoIntervalMin: clamp(numOr(body, 'autoIntervalMin', 360), 5, 7 * 24 * 60),
      });
    },
  },
  {
    key: 'economy',
    title: 'Economy',
    moduleKey: 'economy',
    note: 'Shop items are managed in Discord with /shopadmin. These settings control the currency and the daily reward.',
    fields: [
      { name: 'currencyName', label: 'Currency name', type: 'text' },
      { name: 'currencyEmoji', label: 'Currency emoji', type: 'text' },
      { name: 'startingBalance', label: 'Starting balance', type: 'number' },
      { name: 'dailyAmount', label: 'Base daily reward', type: 'number' },
      { name: 'dailyStreakBonus', label: 'Bonus per streak day', type: 'number' },
      { name: 'dailyStreakCap', label: 'Max streak counted for bonus', type: 'number' },
    ],
    async load(db, guildId) {
      const s = await createEconomyRepo(db).getSettings(guildId);
      return {
        currencyName: s?.currencyName ?? 'coins',
        currencyEmoji: s?.currencyEmoji ?? '🪙',
        startingBalance: s?.startingBalance ?? 0,
        dailyAmount: s?.dailyAmount ?? 100,
        dailyStreakBonus: s?.dailyStreakBonus ?? 10,
        dailyStreakCap: s?.dailyStreakCap ?? 30,
      };
    },
    async save(db, guildId, body) {
      await createEconomyRepo(db).setConfig(guildId, {
        currencyName: str(body, 'currencyName') || 'coins',
        currencyEmoji: str(body, 'currencyEmoji') || '🪙',
        startingBalance: Math.max(0, numOr(body, 'startingBalance', 0)),
        dailyAmount: Math.max(0, numOr(body, 'dailyAmount', 100)),
        dailyStreakBonus: Math.max(0, numOr(body, 'dailyStreakBonus', 10)),
        dailyStreakCap: Math.max(1, numOr(body, 'dailyStreakCap', 30)),
      });
    },
  },
  {
    key: 'levels',
    title: 'Levels',
    moduleKey: 'levels',
    note: 'No-XP channels and level-reward roles are managed in Discord with /levelnoxp and /levelrewards.',
    fields: [
      { name: 'enabled', label: 'Award XP from chatting', type: 'bool' },
      { name: 'announceChannelId', label: 'Level-up announce channel ID (blank = same channel)', type: 'text' },
      { name: 'levelUpMessage', label: 'Level-up message ({user}, {level})', type: 'textarea' },
      { name: 'xpMin', label: 'Min XP per message', type: 'number' },
      { name: 'xpMax', label: 'Max XP per message', type: 'number' },
      { name: 'cooldownSeconds', label: 'Seconds between XP awards per user', type: 'number' },
    ],
    async load(db, guildId) {
      const s = await createLevelsRepo(db).getSettings(guildId);
      return {
        enabled: s?.enabled ?? false,
        announceChannelId: s?.announceChannelId ?? '',
        levelUpMessage: s?.levelUpMessage ?? '🎉 {user} reached level **{level}**!',
        xpMin: s?.xpMin ?? 15,
        xpMax: s?.xpMax ?? 25,
        cooldownSeconds: s?.cooldownSeconds ?? 60,
      };
    },
    async save(db, guildId, body) {
      await createLevelsRepo(db).setConfig(guildId, {
        enabled: boolFrom(body, 'enabled'),
        announceChannelId: str(body, 'announceChannelId'),
        levelUpMessage: str(body, 'levelUpMessage').slice(0, 300) || '🎉 {user} reached level **{level}**!',
        xpMin: Math.max(1, numOr(body, 'xpMin', 15)),
        xpMax: Math.max(1, numOr(body, 'xpMax', 25)),
        cooldownSeconds: Math.max(0, numOr(body, 'cooldownSeconds', 60)),
      });
    },
  },
];

export const FUN_SETTINGS_NAV = MODULES.map((m) => ({ href: `/fun-settings/${m.key}`, label: m.title }));

/** Admin config pages for the configurable fun modules (one generic form per module). */
export const registerFunSettingsRoutes: AdminRoutePlugin = (app, ctx: AdminRouteContext) => {
  const guilds = createGuildsRepo(ctx.db);
  const byKey = new Map(MODULES.map((m) => [m.key, m]));

  function viewDef(def: FunModuleConfig) {
    return { key: def.key, title: def.title, fields: def.fields, note: def.note ?? null };
  }

  app.get('/fun-settings', { preHandler: ctx.requireAuth }, async (_request, reply) => {
    return reply.redirect(`/fun-settings/${MODULES[0]!.key}`);
  });

  app.get<{ Params: { key: string } }>(
    '/fun-settings/:key',
    { preHandler: ctx.requireAuth },
    async (request, reply) => {
      const def = byKey.get(request.params.key);
      if (!def) return reply.callNotFound();
      const guildList = await guilds.list();
      const query = request.query as Record<string, string | undefined>;
      const guildId = query['guild'] ?? guildList[0]?.id ?? null;
      const values = guildId ? await def.load(ctx.db, guildId) : {};
      return reply.view('fun-settings', {
        ...ctx.pageLocals(request, reply, `${def.title} Settings`),
        def: viewDef(def),
        modules: FUN_SETTINGS_NAV,
        guilds: guildList,
        selectedGuildId: guildId,
        values,
        saved: 'saved' in query,
      });
    }
  );

  app.post<{ Params: { key: string }; Body: Record<string, unknown> }>(
    '/fun-settings/:key/save',
    { preHandler: [ctx.requireAuth, ctx.requireMutatingRole, ctx.csrfProtection] },
    async (request, reply) => {
      const def = byKey.get(request.params.key);
      if (!def) return reply.callNotFound();
      const guildId = typeof request.body['guildId'] === 'string' ? request.body['guildId'] : '';
      if (!guildId) return reply.redirect(`/fun-settings/${def.key}`);
      await def.save(ctx.db, guildId, request.body);
      await ctx.audit.record({
        actorType: 'admin',
        actorId: request.session.get('adminId'),
        action: `${def.moduleKey}.config.updated`,
        moduleKey: def.moduleKey,
        guildId,
        targetType: 'module',
        targetId: def.moduleKey,
      });
      return reply.redirect(`/fun-settings/${def.key}?guild=${encodeURIComponent(guildId)}&saved=1`);
    }
  );
};
