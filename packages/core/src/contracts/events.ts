/**
 * Adapter-neutral platform events. The Discord adapter translates gateway
 * events into these; modules subscribe via `BotModule.events`. A future
 * Slack/Telegram adapter emits the same shapes.
 */

import type { OutgoingMessage } from './guild-service.js';

export interface PlatformGuildRef {
  /** Internal guild UUID if resolved, else null. */
  id: string | null;
  externalId: string;
  name: string;
}

export interface PlatformUserRef {
  externalId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | undefined;
  /** Account creation time, when the adapter exposes it. */
  createdAt?: Date | undefined;
  bot?: boolean | undefined;
}

export interface MemberJoinEvent {
  type: 'member.join';
  adapterKey: string;
  guild: PlatformGuildRef;
  user: PlatformUserRef;
  memberCount: number;
}

export interface MemberLeaveEvent {
  type: 'member.leave';
  adapterKey: string;
  guild: PlatformGuildRef;
  user: PlatformUserRef;
  memberCount: number;
}

export interface MessageCreateEvent {
  type: 'message.create';
  adapterKey: string;
  guild: PlatformGuildRef | null;
  channelId: string;
  messageId: string;
  author: PlatformUserRef;
  /** Empty string when the Message Content intent is not granted. */
  content: string;
  mentionCount: number;
  hasAttachments: boolean;
  authorRoleIds: string[];
}

/**
 * A button click or select-menu submission. `customId` carries routing info
 * the originating module encoded (e.g. `rolemenu:<id>`); `values` holds the
 * selected option values for select menus.
 */
export interface ComponentInteractionEvent {
  type: 'component.interaction';
  adapterKey: string;
  guild: PlatformGuildRef | null;
  channelId: string | null;
  customId: string;
  values: string[];
  user: PlatformUserRef;
  userRoleIds: string[];
  /** Acknowledge with an ephemeral reply. Idempotent. */
  reply(content: string): Promise<void>;
  /**
   * Edit the message that carried this component in place (e.g. refresh a
   * now-playing panel after a control button). Optional — adapters that don't
   * support it omit it. Acknowledges the interaction.
   */
  update?(message: OutgoingMessage): Promise<void>;
}

export type PlatformEvent =
  | MemberJoinEvent
  | MemberLeaveEvent
  | MessageCreateEvent
  | ComponentInteractionEvent;

export type PlatformEventType = PlatformEvent['type'];
