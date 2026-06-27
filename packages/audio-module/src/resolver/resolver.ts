import { validateExternalUrl } from '@botplatform/security';
import { UserFacingError } from '@botplatform/shared';
import type { AudioProvider, PlaylistResolution, ResolveContext, ResolvedTrack } from './types.js';

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

  /**
   * Expand a playlist URL into many tracks. Routes to the first claiming
   * provider that supports playlists (currently yt-dlp / YouTube). The
   * single-track `resolve()` contract above is left untouched.
   */
  async resolvePlaylist(
    rawUrl: string,
    ctx: ResolveContext,
    limit: number
  ): Promise<PlaylistResolution> {
    const validation = await validateExternalUrl(rawUrl, {
      allowedDomains: ctx.allowedDomains,
    });
    if (!validation.ok) {
      throw new UserFacingError(validation.code, validation.reason);
    }

    const provider = this.providers.find(
      (candidate) => candidate.canResolve(validation.url) && candidate.resolvePlaylist
    );
    if (!provider?.resolvePlaylist) {
      throw new UserFacingError('URL_UNSUPPORTED', 'Playlists are only supported for YouTube links.');
    }

    try {
      return await provider.resolvePlaylist(rawUrl, ctx, limit);
    } catch (error) {
      if (error instanceof UserFacingError) throw error;
      ctx.logger.warn({ err: error, provider: provider.key }, 'playlist resolution failed');
      throw new UserFacingError('AUDIO_RESOLVE_FAILED', 'That playlist could not be resolved.', {
        cause: error,
      });
    }
  }
}
