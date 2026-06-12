import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison for shared-secret tokens.
 * Hashes both sides first so lengths never leak.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
