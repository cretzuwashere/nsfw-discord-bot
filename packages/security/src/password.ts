import argon2 from 'argon2';

/** Hash a password with argon2id (library default, OWASP-recommended). */
export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain);
}

/** Verify a password against a stored hash. Returns false on any failure. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
