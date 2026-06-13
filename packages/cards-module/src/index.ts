import type { AppConfig } from '@botplatform/config';
import type { BotModule } from '@botplatform/core';
import type { Db } from '@botplatform/database';
import type { Logger } from '@botplatform/logger';
import { MODULE_KEYS } from '@botplatform/shared';
import { createCardsRepo } from './repo.js';
import { createCardsService, type CardsService } from './service.js';
import { CardAssetStorage } from './storage.js';

export interface CardsModuleOptions {
  config: AppConfig;
  logger: Logger;
  db: Db;
}

export interface CardsModuleHandle {
  module: BotModule;
  service: CardsService;
  storage: CardAssetStorage;
}

/**
 * Dynamic Cards: generates personalized images (welcome cards, birthday
 * cards, banners) from sanitized templates. No slash commands — it's a
 * rendering service used by other modules and the admin preview.
 */
export function createCardsModule(options: CardsModuleOptions): CardsModuleHandle {
  const logger = options.logger.child({ module: MODULE_KEYS.dynamicCards });
  const cards = createCardsRepo(options.db);
  const storage = new CardAssetStorage(options.config.storage.uploadsDir);
  const service = createCardsService({ cards, storage, logger });

  const module: BotModule = {
    key: MODULE_KEYS.dynamicCards,
    name: 'Dynamic Cards',
    description: 'Generate personalized images (welcome cards, birthday cards, banners).',
    metadata: {
      requiredPermissions: ['AttachFiles'],
      auditEvents: ['card.template.created', 'card.template.updated', 'card.template.archived'],
    },
    commands: [],
    onLoad(ctx) {
      ctx.logger.info({ uploadsDir: options.config.storage.uploadsDir }, 'dynamic cards ready');
    },
  };

  return { module, service, storage };
}

export { createCardsRepo } from './repo.js';
export type { CardsRepo, CardTemplateRow, CardAssetRow } from './repo.js';
export { createCardsService } from './service.js';
export type { CardsService } from './service.js';
export { CardAssetStorage } from './storage.js';
export type { StoreResult, StoredAsset } from './storage.js';
export { normalizeLayout } from './layout.js';
export type { CardLayout, CardText, CardAvatar, CardBackground } from './layout.js';
export { buildCardSvg, renderCardPng, escapeXml } from './renderer.js';
export {
  applyPlaceholders,
  buildPlaceholderData,
  SUPPORTED_PLACEHOLDERS,
} from './placeholders.js';
export type { PlaceholderData } from './placeholders.js';
