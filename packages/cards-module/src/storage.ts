import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/** Allowed image uploads for card backgrounds. */
const ALLOWED_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export interface StoredAsset {
  storagePath: string; // relative, e.g. "g-uuid/abcd.png"
  mimeType: string;
  byteSize: number;
}

export type StoreResult =
  | { ok: true; asset: StoredAsset }
  | { ok: false; error: string };

/**
 * Safe asset storage on the uploads volume. Filenames are generated (never
 * derived from user input), so path traversal is impossible; the resolved
 * path is additionally asserted to stay within the uploads root.
 */
export class CardAssetStorage {
  constructor(private readonly uploadsRoot: string) {}

  async store(input: {
    guildId: string | null;
    data: Buffer;
    mimeType: string;
  }): Promise<StoreResult> {
    const ext = ALLOWED_MIME[input.mimeType];
    if (!ext) return { ok: false, error: 'Only PNG, JPEG and WebP images are allowed.' };
    if (input.data.byteLength === 0) return { ok: false, error: 'The file is empty.' };
    if (input.data.byteLength > MAX_BYTES) return { ok: false, error: 'The file is too large (max 8 MB).' };

    // Folder is the guild UUID (validated shape) or "global".
    const folder = input.guildId && /^[a-f0-9-]{36}$/.test(input.guildId) ? input.guildId : 'global';
    const filename = `${randomUUID()}.${ext}`;
    const relPath = `${folder}/${filename}`;
    const absPath = this.safeResolve(relPath);
    if (!absPath) return { ok: false, error: 'Invalid storage path.' };

    await mkdir(join(this.uploadsRoot, folder), { recursive: true });
    await writeFile(absPath, input.data);
    return {
      ok: true,
      asset: { storagePath: relPath, mimeType: input.mimeType, byteSize: input.data.byteLength },
    };
  }

  async read(storagePath: string): Promise<Buffer | null> {
    const absPath = this.safeResolve(storagePath);
    if (!absPath) return null;
    return readFile(absPath).catch(() => null);
  }

  async remove(storagePath: string): Promise<void> {
    const absPath = this.safeResolve(storagePath);
    if (!absPath) return;
    await unlink(absPath).catch(() => {});
  }

  /** Resolve a relative path and confirm it stays under the uploads root. */
  private safeResolve(relPath: string): string | null {
    const root = resolve(this.uploadsRoot);
    const abs = resolve(root, relPath);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    return abs;
  }
}
