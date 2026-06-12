import { fileURLToPath } from 'node:url';

/**
 * views/ and public/ sit BESIDE src/ and dist/, so the same relative hop
 * works in dev (tsx runs src/) and production (node runs dist/).
 */
export const viewsDir = fileURLToPath(new URL('../views', import.meta.url));
export const publicDir = fileURLToPath(new URL('../public', import.meta.url));
