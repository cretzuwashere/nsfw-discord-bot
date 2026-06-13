import { Resvg } from '@resvg/resvg-js';
import { applyPlaceholders, type PlaceholderData } from './placeholders.js';
import type { CardLayout } from './layout.js';

export interface RenderInput {
  width: number;
  height: number;
  layout: CardLayout;
  data: PlaceholderData;
  /** Decoded avatar image bytes (PNG/JPEG), already fetched safely. */
  avatarImage?: Buffer | undefined;
  /** Decoded background image bytes, when the layout uses an image background. */
  backgroundImage?: Buffer | undefined;
}

/** Escape text for safe inclusion in SVG (prevents markup injection). */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dataUri(image: Buffer): string {
  // resvg accepts data URIs; we don't sniff type — the bytes are passed to the
  // raster decoder which handles PNG/JPEG/WebP.
  return `data:image/png;base64,${image.toString('base64')}`;
}

/** Build the SVG document for a card (pure — easy to unit test). */
export function buildCardSvg(input: RenderInput): string {
  const { width, height, layout, data } = input;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);

  // Background
  if (layout.background.type === 'image' && input.backgroundImage) {
    parts.push(
      `<image href="${dataUri(input.backgroundImage)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`
    );
  } else {
    const color = layout.background.type === 'color' ? layout.background.color : '#1f2530';
    parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${color}"/>`);
  }

  // Avatar (with optional circular clip)
  if (layout.avatar && input.avatarImage) {
    const { x, y, size, shape } = layout.avatar;
    if (shape === 'circle') {
      const r = size / 2;
      parts.push(
        `<clipPath id="avatarClip"><circle cx="${x + r}" cy="${y + r}" r="${r}"/></clipPath>`
      );
      parts.push(
        `<image href="${dataUri(input.avatarImage)}" x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
      );
    } else {
      parts.push(
        `<image href="${dataUri(input.avatarImage)}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/>`
      );
    }
  }

  // Text layers (placeholders applied, then XML-escaped)
  for (const text of layout.texts) {
    const resolved = applyPlaceholders(text.content, data);
    const safe = escapeXml(resolved);
    parts.push(
      `<text x="${text.x}" y="${text.y}" font-family="DejaVu Sans, sans-serif" ` +
        `font-size="${text.fontSize}" fill="${text.color}" font-weight="${text.weight}" ` +
        `text-anchor="${text.anchor}">${safe}</text>`
    );
  }

  parts.push('</svg>');
  return parts.join('\n');
}

/** Render a card to a PNG buffer. */
export function renderCardPng(input: RenderInput): Buffer {
  const svg = buildCardSvg(input);
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    fitTo: { mode: 'width', value: input.width },
  });
  return Buffer.from(resvg.render().asPng());
}
