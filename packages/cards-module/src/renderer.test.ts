import { describe, expect, it } from 'vitest';
import { normalizeLayout } from './layout.js';
import { applyPlaceholders, buildPlaceholderData } from './placeholders.js';
import { buildCardSvg, escapeXml, renderCardPng } from './renderer.js';

describe('applyPlaceholders', () => {
  it('substitutes known placeholders and blanks unknown ones', () => {
    const data = { 'user.username': 'Ada', 'server.name': 'Guild' };
    expect(applyPlaceholders('Hi {{user.username}} @ {{server.name}}!', data)).toBe('Hi Ada @ Guild!');
    expect(applyPlaceholders('{{nope.key}}', data)).toBe('');
  });

  it('handles whitespace inside braces', () => {
    expect(applyPlaceholders('{{ user.username }}', { 'user.username': 'X' })).toBe('X');
  });

  it('never executes or reflects code-like content', () => {
    const data = { 'user.username': '<script>alert(1)</script>' };
    // applyPlaceholders does NOT escape — escaping happens at the SVG layer.
    expect(applyPlaceholders('{{user.username}}', data)).toContain('<script>');
  });
});

describe('buildPlaceholderData', () => {
  it('derives mention from the user id', () => {
    const data = buildPlaceholderData({ user: { id: '123', username: 'Ada' } });
    expect(data['user.mention']).toBe('<@123>');
    expect(data['user.id']).toBe('123');
  });
});

describe('escapeXml', () => {
  it('escapes the dangerous characters', () => {
    expect(escapeXml('<a> & "b" \'c\'')).toBe('&lt;a&gt; &amp; &quot;b&quot; &apos;c&apos;');
  });
});

describe('normalizeLayout', () => {
  const dims = { width: 1000, height: 420 };

  it('defaults to a color background and clamps values', () => {
    const layout = normalizeLayout({}, dims);
    expect(layout.background).toEqual({ type: 'color', color: '#1f2530' });
    expect(layout.texts).toEqual([]);
  });

  it('clamps text coordinates and font size', () => {
    const layout = normalizeLayout(
      { texts: [{ content: 'Hi', x: 99999, y: -10, fontSize: 9999, color: 'bad' }] },
      dims
    );
    expect(layout.texts[0]?.x).toBe(1000);
    expect(layout.texts[0]?.y).toBe(0);
    expect(layout.texts[0]?.fontSize).toBe(200);
    expect(layout.texts[0]?.color).toBe('#ffffff'); // invalid → fallback
  });

  it('accepts an image background with an assetId', () => {
    const layout = normalizeLayout({ background: { type: 'image', assetId: 'a-1' } }, dims);
    expect(layout.background).toEqual({ type: 'image', assetId: 'a-1' });
  });

  it('caps the number of text layers at 20', () => {
    const texts = Array.from({ length: 50 }, () => ({ content: 'x' }));
    expect(normalizeLayout({ texts }, dims).texts).toHaveLength(20);
  });
});

describe('buildCardSvg', () => {
  it('escapes placeholder content in the SVG output (XSS-safe)', () => {
    const layout = normalizeLayout(
      { texts: [{ content: 'Welcome {{user.username}}', x: 10, y: 20, fontSize: 24 }] },
      { width: 400, height: 200 }
    );
    const svg = buildCardSvg({
      width: 400,
      height: 200,
      layout,
      data: { 'user.username': '<script>x</script>' },
    });
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>x</script>');
  });
});

describe('renderCardPng', () => {
  it('rasterizes a card to a non-trivial PNG', () => {
    const layout = normalizeLayout(
      {
        background: { type: 'color', color: '#4f8cff' },
        texts: [{ content: 'Welcome {{user.username}}!', x: 200, y: 110, fontSize: 36, anchor: 'middle', color: '#ffffff' }],
      },
      { width: 600, height: 200 }
    );
    const png = renderCardPng({
      width: 600,
      height: 200,
      layout,
      data: buildPlaceholderData({ user: { username: 'Tester' } }),
    });
    expect(png.length).toBeGreaterThan(1000);
    // PNG magic bytes.
    expect(png.subarray(0, 4).toString('hex')).toBe('89504e47');
  });
});
