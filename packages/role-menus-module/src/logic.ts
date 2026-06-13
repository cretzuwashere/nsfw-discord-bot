import type { OutgoingMessage } from '@botplatform/core';
import type { RoleMenuOptionRow, RoleMenuWithOptions } from './repo.js';

export type RoleMenuMode = RoleMenuWithOptions['mode'];

export interface MenuConstraints {
  maxSelections?: number;
  requiredRoleId?: string;
  blockedRoleId?: string;
}

export interface RoleChanges {
  add: string[];
  remove: string[];
  rejected?: string;
}

/**
 * Pure role-change computation for a menu interaction. `held` is the user's
 * full current role set; `requested` is the clicked role (button → 1 id) or
 * selected roles (select menu → N ids). Returns the role ids to add/remove,
 * or a rejection message when a constraint is violated.
 */
export function computeRoleChanges(input: {
  mode: RoleMenuMode;
  menuRoleIds: string[];
  held: Set<string>;
  requested: string[];
  constraints: MenuConstraints;
}): RoleChanges {
  const { mode, menuRoleIds, held, requested, constraints } = input;

  if (constraints.requiredRoleId && !held.has(constraints.requiredRoleId)) {
    return { add: [], remove: [], rejected: 'You need another role before using this menu.' };
  }
  if (constraints.blockedRoleId && held.has(constraints.blockedRoleId)) {
    return { add: [], remove: [], rejected: 'You are not allowed to use this menu.' };
  }

  const menuSet = new Set(menuRoleIds);
  const heldMenu = new Set(menuRoleIds.filter((r) => held.has(r)));
  const valid = requested.filter((r) => menuSet.has(r));
  if (valid.length === 0) {
    return { add: [], remove: [], rejected: 'That role is no longer available.' };
  }

  let target: Set<string>;
  switch (mode) {
    case 'add_only':
      target = new Set(heldMenu);
      valid.forEach((r) => target.add(r));
      break;
    case 'remove_only':
      target = new Set(heldMenu);
      valid.forEach((r) => target.delete(r));
      break;
    case 'single':
    case 'unique':
      // One role from the group at a time; clicking the held one toggles off.
      if (valid.length === 1 && heldMenu.has(valid[0]!)) target = new Set();
      else target = new Set([valid[0]!]);
      break;
    default: {
      // multiple / toggle
      if (valid.length === 1) {
        const r = valid[0]!;
        target = new Set(heldMenu);
        if (heldMenu.has(r)) target.delete(r);
        else target.add(r);
      } else {
        // select submission → desired set is exactly the chosen options
        target = new Set(valid);
      }
    }
  }

  if (constraints.maxSelections && target.size > constraints.maxSelections) {
    return {
      add: [],
      remove: [],
      rejected: `You can have at most ${constraints.maxSelections} role(s) from this menu.`,
    };
  }

  const add = [...target].filter((r) => !held.has(r));
  const remove = [...heldMenu].filter((r) => !target.has(r));
  return { add, remove };
}

/** customId encodings (parsed by the interaction handler). */
export function buttonCustomId(menuId: string, roleId: string): string {
  return `rolemenu:${menuId}:${roleId}`;
}
export function selectCustomId(menuId: string): string {
  return `rolemenu:${menuId}`;
}

export function parseCustomId(customId: string): { menuId: string; roleId?: string } | null {
  if (!customId.startsWith('rolemenu:')) return null;
  const parts = customId.split(':');
  if (!parts[1]) return null;
  return parts[2] ? { menuId: parts[1], roleId: parts[2] } : { menuId: parts[1] };
}

/** Build the published menu message (embed + buttons or select). */
export function buildMenuMessage(menu: RoleMenuWithOptions): OutgoingMessage {
  const constraints = (menu.constraints ?? {}) as MenuConstraints;
  const message: OutgoingMessage = {
    embed: {
      title: menu.title || 'Select your roles',
      description: menu.description || undefined,
      color: 0x4f8cff,
    },
    allowMentions: { everyone: false, roles: [], users: [] },
  };

  if (menu.type === 'select') {
    message.selectMenu = {
      customId: selectCustomId(menu.id),
      placeholder: 'Choose roles…',
      minValues: 0,
      maxValues: constraints.maxSelections ?? Math.max(menu.options.length, 1),
      options: menu.options.map((o: RoleMenuOptionRow) => ({
        label: o.label || o.roleId,
        value: o.roleId,
        description: o.description || undefined,
        emoji: o.emoji || undefined,
      })),
    };
  } else {
    // Default to buttons (reaction-type menus also publish as buttons in v1).
    message.buttons = menu.options.slice(0, 25).map((o: RoleMenuOptionRow) => ({
      customId: buttonCustomId(menu.id, o.roleId),
      label: o.label || 'Role',
      style: 'secondary' as const,
      emoji: o.emoji || undefined,
    }));
  }
  return message;
}
