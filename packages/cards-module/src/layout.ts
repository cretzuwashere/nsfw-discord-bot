/** Card template layout — a sanitized, declarative spec (no code execution). */

export interface CardText {
  /** May contain {{placeholders}}. */
  content: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  weight: 'normal' | 'bold';
  anchor: 'start' | 'middle' | 'end';
}

export interface CardAvatar {
  x: number;
  y: number;
  size: number;
  shape: 'circle' | 'square';
}

export type CardBackground =
  | { type: 'color'; color: string }
  | { type: 'image'; assetId: string };

export interface CardLayout {
  background: CardBackground;
  texts: CardText[];
  avatar?: CardAvatar | undefined;
}

const HEX = /^#?[0-9a-fA-F]{6}$/;

function normHex(value: unknown, fallback: string): string {
  if (typeof value === 'string' && HEX.test(value)) {
    return value.startsWith('#') ? value : `#${value}`;
  }
  return fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/**
 * Validate/normalize an arbitrary layout object from the admin form into a
 * safe CardLayout. Unknown fields are dropped; everything is clamped.
 */
export function normalizeLayout(raw: unknown, dimensions: { width: number; height: number }): CardLayout {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bg = (obj['background'] && typeof obj['background'] === 'object'
    ? obj['background']
    : {}) as Record<string, unknown>;

  const background: CardBackground =
    bg['type'] === 'image' && typeof bg['assetId'] === 'string'
      ? { type: 'image', assetId: bg['assetId'] }
      : { type: 'color', color: normHex(bg['color'], '#1f2530') };

  const rawTexts = Array.isArray(obj['texts']) ? obj['texts'] : [];
  const texts: CardText[] = rawTexts.slice(0, 20).map((t) => {
    const text = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
    return {
      content: typeof text['content'] === 'string' ? text['content'].slice(0, 200) : '',
      x: num(text['x'], 40, 0, dimensions.width),
      y: num(text['y'], 60, 0, dimensions.height),
      fontSize: num(text['fontSize'], 32, 8, 200),
      color: normHex(text['color'], '#ffffff'),
      weight: text['weight'] === 'bold' ? 'bold' : 'normal',
      anchor: text['anchor'] === 'middle' || text['anchor'] === 'end' ? text['anchor'] : 'start',
    };
  });

  let avatar: CardAvatar | undefined;
  const av = obj['avatar'];
  if (av && typeof av === 'object') {
    const a = av as Record<string, unknown>;
    avatar = {
      x: num(a['x'], 40, 0, dimensions.width),
      y: num(a['y'], 40, 0, dimensions.height),
      size: num(a['size'], 128, 16, 512),
      shape: a['shape'] === 'square' ? 'square' : 'circle',
    };
  }

  return { background, texts, avatar };
}
