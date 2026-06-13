import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CardAssetStorage } from './storage.js';

let root: string;
let storage: CardAssetStorage;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cards-'));
  storage = new CardAssetStorage(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const png = Buffer.from('89504e470d0a1a0a', 'hex');

describe('CardAssetStorage', () => {
  it('stores an allowed image and reads it back', async () => {
    const result = await storage.store({ guildId: null, data: png, mimeType: 'image/png' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.asset.storagePath).toMatch(/^global\/[a-f0-9-]+\.png$/);
      const back = await storage.read(result.asset.storagePath);
      expect(back?.equals(png)).toBe(true);
      // The stored file lives under the uploads root.
      const onDisk = await readFile(join(root, result.asset.storagePath));
      expect(onDisk.equals(png)).toBe(true);
    }
  });

  it('rejects disallowed mime types', async () => {
    const result = await storage.store({ guildId: null, data: png, mimeType: 'application/x-msdownload' });
    expect(result.ok).toBe(false);
  });

  it('rejects empty and oversized files', async () => {
    expect((await storage.store({ guildId: null, data: Buffer.alloc(0), mimeType: 'image/png' })).ok).toBe(false);
    const big = Buffer.alloc(9 * 1024 * 1024);
    expect((await storage.store({ guildId: null, data: big, mimeType: 'image/png' })).ok).toBe(false);
  });

  it('refuses to read paths that escape the uploads root (traversal)', async () => {
    expect(await storage.read('../../../etc/passwd')).toBeNull();
    expect(await storage.read('/etc/passwd')).toBeNull();
  });

  it('places guild assets under the guild folder', async () => {
    const guildId = '11111111-1111-1111-1111-111111111111';
    const result = await storage.store({ guildId, data: png, mimeType: 'image/jpeg' });
    expect(result.ok && result.asset.storagePath.startsWith(`${guildId}/`)).toBe(true);
  });
});
