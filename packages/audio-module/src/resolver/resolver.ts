import { validateExternalUrl } from '@botplatform/security';
import { UserFacingError } from '@botplatform/shared';
import type { AudioProvider, ResolveContext, ResolvedTrack } from './types.js';

/**
 * Validates URLs (SSRF guards live in @botplatform/security) and routes them
 * to the first provider that claims them. Command handlers never touch
 * extraction logic directly.
 */
export class AudioResolver {
  constructor(private readonly providers: AudioProvider[]) {}

  async resolve(rawUrl: string, ctx: ResolveContext): Promise<ResolvedTrack> {
    const validation = await validateExternalUrl(rawUrl, {
      allowedDomains: ctx.allowedDomains,
    });
    if (!validation.ok) {
      throw new UserFacingError(validation.code, validation.reason);
    }

    const provider = this.providers.find((candidate) => candidate.canResolve(validation.url));
    if (!provider) {
      throw new UserFacingError('URL_UNSUPPORTED', 'That link is not supported yet.');
    }

    try {
      return await provider.resolve(rawUrl, ctx);
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      ctx.logger.warn({ err: error, provider: provider.key }, 'provider resolution failed');
      throw new UserFacingError('AUDIO_RESOLVE_FAILED', 'That link could not be resolved.', {
        cause: error,
      });
    }
  }
}
