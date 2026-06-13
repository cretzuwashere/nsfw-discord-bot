import { openSafeHttpStream } from '@botplatform/security';
import type { Logger } from '@botplatform/logger';
import { normalizeLayout } from './layout.js';
import type { PlaceholderData } from './placeholders.js';
import { renderCardPng } from './renderer.js';
import type { CardsRepo, CardTemplateRow } from './repo.js';
import type { CardAssetStorage } from './storage.js';

export interface CardsServiceDeps {
  cards: CardsRepo;
  storage: CardAssetStorage;
  logger: Logger;
  /** Cap on bytes read for an avatar/background fetch. */
  maxImageBytes?: number;
}

const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Renders cards from templates. Resolves the background asset from storage and
 * fetches the avatar via the SSRF-safe streamer, then rasterizes via resvg.
 */
export function createCardsService(deps: CardsServiceDeps) {
  const { cards, storage, logger } = deps;
  const maxBytes = deps.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;

  async function renderTemplate(
    template: CardTemplateRow,
    data: PlaceholderData & { 'user.avatarUrl'?: string }
  ): Promise<Buffer> {
    const layout = normalizeLayout(template.layout, {
      width: template.width,
      height: template.height,
    });

    let backgroundImage: Buffer | undefined;
    if (layout.background.type === 'image') {
      const asset = await cards.getAsset(layout.background.assetId).catch(() => undefined);
      if (asset) backgroundImage = (await storage.read(asset.storagePath)) ?? undefined;
    }

    let avatarImage: Buffer | undefined;
    const avatarUrl = typeof data['user.avatarUrl'] === 'string' ? data['user.avatarUrl'] : undefined;
    if (layout.avatar && avatarUrl) {
      avatarImage = await fetchImage(avatarUrl);
    }

    return renderCardPng({
      width: template.width,
      height: template.height,
      layout,
      data,
      avatarImage,
      backgroundImage,
    });
  }

  /** Render a template by id; returns null when the template is missing/fails. */
  async function renderById(
    templateId: string,
    data: PlaceholderData & { 'user.avatarUrl'?: string }
  ): Promise<Buffer | null> {
    const template = await cards.getTemplate(templateId).catch(() => undefined);
    if (!template) return null;
    return renderTemplate(template, data).catch((error) => {
      logger.debug({ err: error, templateId }, 'card render by id failed');
      return null;
    });
  }

  /** Fetch a remote image safely (SSRF-guarded), bounded in size. */
  async function fetchImage(url: string): Promise<Buffer | undefined> {
    try {
      const result = await openSafeHttpStream(url, {
        allowedDomains: [],
        timeoutMs: 8000,
        requireAudioContentType: false,
      });
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of result.stream) {
        const buf = chunk as Buffer;
        total += buf.length;
        if (total > maxBytes) {
          result.stream.destroy();
          return undefined;
        }
        chunks.push(buf);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      logger.debug({ err: error, url }, 'avatar/image fetch failed');
      return undefined;
    }
  }

  return { renderTemplate, renderById, fetchImage };
}

export type CardsService = ReturnType<typeof createCardsService>;
