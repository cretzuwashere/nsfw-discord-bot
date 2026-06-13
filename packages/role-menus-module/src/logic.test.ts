import { describe, expect, it } from 'vitest';
import {
  buildMenuMessage,
  buttonCustomId,
  computeRoleChanges,
  parseCustomId,
  selectCustomId,
} from './logic.js';
import type { RoleMenuWithOptions } from './repo.js';

const MENU_ROLES = ['r1', 'r2', 'r3'];

function changes(
  mode: Parameters<typeof computeRoleChanges>[0]['mode'],
  held: string[],
  requested: string[],
  constraints = {},
  kind: 'button' | 'select' = requested.length > 1 ? 'select' : 'button'
) {
  return computeRoleChanges({ mode, menuRoleIds: MENU_ROLES, held: new Set(held), requested, constraints, kind });
}

describe('computeRoleChanges — buttons', () => {
  it('toggles a role in multiple mode', () => {
    expect(changes('multiple', [], ['r1'])).toMatchObject({ add: ['r1'], remove: [] });
    expect(changes('multiple', ['r1'], ['r1'])).toMatchObject({ add: [], remove: ['r1'] });
  });

  it('single mode replaces the held role in the group', () => {
    const result = changes('single', ['r1'], ['r2']);
    expect(result.add).toEqual(['r2']);
    expect(result.remove).toEqual(['r1']);
  });

  it('single mode toggles off when clicking the held role', () => {
    expect(changes('single', ['r2'], ['r2'])).toMatchObject({ add: [], remove: ['r2'] });
  });

  it('add_only never removes', () => {
    expect(changes('add_only', ['r1'], ['r1'])).toMatchObject({ add: [], remove: [] });
    expect(changes('add_only', [], ['r2'])).toMatchObject({ add: ['r2'], remove: [] });
  });

  it('remove_only never adds', () => {
    expect(changes('remove_only', ['r1'], ['r1'])).toMatchObject({ add: [], remove: ['r1'] });
    expect(changes('remove_only', [], ['r1'])).toMatchObject({ add: [], remove: [] });
  });

  it('ignores roles not in the menu', () => {
    expect(changes('multiple', [], ['nope'])).toMatchObject({ rejected: expect.stringMatching(/no longer available/) });
  });
});

describe('computeRoleChanges — select menus', () => {
  it('sets the chosen roles as the desired set', () => {
    const result = changes('multiple', ['r1'], ['r2', 'r3']);
    expect(result.add.sort()).toEqual(['r2', 'r3']);
    expect(result.remove).toEqual(['r1']);
  });

  it('treats a single-value SELECT submission as the desired set (not a toggle)', () => {
    // User holds {r1,r2}, narrows the multi-select to just r1 → keep r1, drop r2.
    const result = changes('multiple', ['r1', 'r2'], ['r1'], {}, 'select');
    expect(result.add).toEqual([]);
    expect(result.remove).toEqual(['r2']);
  });

  it('a single-value BUTTON click still toggles', () => {
    const result = changes('multiple', ['r1', 'r2'], ['r1'], {}, 'button');
    expect(result.remove).toEqual(['r1']); // toggled off
  });
});

describe('computeRoleChanges — constraints', () => {
  it('enforces maxSelections', () => {
    const result = changes('multiple', ['r1'], ['r2', 'r3'], { maxSelections: 1 });
    expect(result.rejected).toMatch(/at most 1/);
  });

  it('requires a prerequisite role', () => {
    const result = changes('multiple', [], ['r1'], { requiredRoleId: 'pre' });
    expect(result.rejected).toMatch(/need another role/i);
  });

  it('blocks users with a blocked role', () => {
    const result = changes('multiple', ['blk'], ['r1'], { blockedRoleId: 'blk' });
    expect(result.rejected).toMatch(/not allowed/i);
  });
});

describe('customId encoding', () => {
  it('round-trips button and select ids', () => {
    expect(parseCustomId(buttonCustomId('m1', 'r1'))).toEqual({ menuId: 'm1', roleId: 'r1' });
    expect(parseCustomId(selectCustomId('m1'))).toEqual({ menuId: 'm1' });
    expect(parseCustomId('other:thing')).toBeNull();
  });
});

describe('buildMenuMessage', () => {
  const base: RoleMenuWithOptions = {
    id: 'm1',
    guildId: 'g',
    name: 'Colors',
    type: 'button',
    mode: 'multiple',
    channelId: null,
    messageId: null,
    style: 'embed',
    title: 'Pick a color',
    description: 'Choose',
    constraints: {},
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    options: [
      { id: 'o1', menuId: 'm1', roleId: 'r1', label: 'Red', description: '', emoji: null, position: 0 },
      { id: 'o2', menuId: 'm1', roleId: 'r2', label: 'Blue', description: '', emoji: null, position: 1 },
    ],
  } as RoleMenuWithOptions;

  it('builds buttons for a button menu', () => {
    const msg = buildMenuMessage(base);
    expect(msg.buttons).toHaveLength(2);
    expect(msg.buttons?.[0]?.customId).toBe('rolemenu:m1:r1');
    expect(msg.embed?.title).toBe('Pick a color');
  });

  it('builds a select menu for a select menu', () => {
    const msg = buildMenuMessage({ ...base, type: 'select' });
    expect(msg.selectMenu?.customId).toBe('rolemenu:m1');
    expect(msg.selectMenu?.options).toHaveLength(2);
  });
});
