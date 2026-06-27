import type { AppConfig } from '@botplatform/config';
import type {
  AuditLogPort,
  BotModule,
  ComponentInteractionEvent,
  GuildServiceProvider,
  VoiceStateUpdateEvent,
} from '@botplatform/core';
import { createGuildsRepo, type Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { buildRaiseHandCommands } from './commands.js';
import { createSpeakerQueueRepo } from './repo.js';
import { createSpeakerQueueService, type SpeakerQueueService } from './service.js';

export interface RaiseHandModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
  audit: AuditLogPort;
  guildServiceProvider: GuildServiceProvider;
}

export interface RaiseHandModuleHandle {
  module: BotModule;
  service: SpeakerQueueService;
}

/**
 * The Speaker Queue ("raise hand") module: an explicit, persistent speaking
 * queue scoped per (guild, voice channel), driven by slash commands + a button
 * control panel, with moderator-gated advance/clear and voice-leave cleanup.
 */
export function createRaiseHandModule(options: RaiseHandModuleOptions): RaiseHandModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.raiseHand });
  const repo = createSpeakerQueueRepo(options.db);
  const guilds = createGuildsRepo(options.db);
  const service = createSpeakerQueueService({
    repo,
    guilds,
    guildServiceProvider: options.guildServiceProvider,
    audit: options.audit,
    logger,
  });

  const module: BotModule = {
    key: MODULE_KEYS.raiseHand,
    name: 'Speaker Queue',
    description:
      'Raise-hand speaking queue for voice channels: ordered turns, moderator controls and a button panel.',
    metadata: {
      requiredPermissions: ['ViewChannel', 'SendMessages', 'EmbedLinks', 'ReadMessageHistory'],
      requiredIntents: ['Guilds', 'GuildVoiceStates'],
      auditEvents: ['raisehand.next', 'raisehand.panel', 'raisehand.cleared'],
    },
    commands: buildRaiseHandCommands(service),
    events: [
      {
        type: 'component.interaction',
        handle: (event) => service.handleInteraction(event as ComponentInteractionEvent),
      },
      {
        type: 'voice.state.update',
        handle: (event) => service.handleVoiceState(event as VoiceStateUpdateEvent),
      },
    ],
    onLoad(ctx) {
      ctx.logger.info('raise-hand module ready');
    },
  };

  return { module, service };
}

export { createSpeakerQueueRepo } from './repo.js';
export type { SpeakerQueueRepo, SpeakerQueueRow, SpeakerQueueEntryRow } from './repo.js';
export { createSpeakerQueueService } from './service.js';
export type { SpeakerQueueService, ActorRef } from './service.js';
export {
  sortWaiting,
  nextWaiting,
  promotedPriority,
  waitingPosition,
  parsePanelCustomId,
  panelCustomId,
  buildPanelMessage,
  formatQueueLines,
  MODERATOR_PERMISSION,
  MODERATOR_ACTIONS,
} from './logic.js';
export type { QueueEntryView, PanelAction, EntryStatus } from './logic.js';
