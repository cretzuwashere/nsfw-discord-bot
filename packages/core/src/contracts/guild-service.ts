/**
 * Adapter-neutral server operations modules use to act on a guild: send
 * messages, manage roles, post interactive components. The Discord adapter
 * implements this; modules never touch discord.js directly.
 *
 * All methods reject with a PlatformError (never raw adapter errors) and the
 * caller is responsible for safe, user-facing messaging.
 */

export interface MessageButton {
  /** Routed back to the owning module via ComponentInteractionEvent.customId. */
  customId?: string;
  label: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
  url?: string;
  emoji?: string;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
}

export interface MessageEmbed {
  title?: string;
  description?: string;
  color?: number;
  footer?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

export interface OutgoingMessage {
  content?: string;
  embed?: MessageEmbed;
  buttons?: MessageButton[];
  selectMenu?: { customId: string; placeholder?: string; minValues?: number; maxValues?: number; options: SelectOption[] };
  /** Image attachment (e.g. a generated card). */
  attachment?: { data: Buffer; filename: string };
  /** Allowed-mentions control; defaults to NO @everyone/@here/role pings. */
  allowMentions?: { everyone?: boolean; roles?: string[]; users?: string[] };
}

export interface SentMessageRef {
  channelId: string;
  messageId: string;
}

export interface GuildRoleInfo {
  id: string;
  name: string;
  /** Position in the role hierarchy (higher = more senior). */
  position: number;
  managed: boolean;
}

export interface GuildChannelInfo {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'category' | 'other';
}

/**
 * Operations scoped to a single guild. Obtained from
 * `GuildServiceProvider.forGuild(externalGuildId)`.
 */
export interface GuildService {
  readonly guildExternalId: string;

  sendMessage(channelId: string, message: OutgoingMessage): Promise<SentMessageRef>;
  editMessage(channelId: string, messageId: string, message: OutgoingMessage): Promise<void>;
  deleteMessage(channelId: string, messageId: string): Promise<void>;
  sendDirectMessage(userExternalId: string, message: OutgoingMessage): Promise<void>;

  listRoles(): Promise<GuildRoleInfo[]>;
  listChannels(): Promise<GuildChannelInfo[]>;

  /** True only when the bot's highest role is above the target role. */
  canManageRole(roleId: string): Promise<boolean>;
  addRole(userExternalId: string, roleId: string, reason?: string): Promise<void>;
  removeRole(userExternalId: string, roleId: string, reason?: string): Promise<void>;

  /** Moderation primitives (no-throw contract still applies). */
  timeoutMember(userExternalId: string, durationSeconds: number, reason?: string): Promise<void>;
  removeTimeout(userExternalId: string, reason?: string): Promise<void>;
  kickMember(userExternalId: string, reason?: string): Promise<void>;
  banMember(userExternalId: string, reason?: string, deleteMessageSeconds?: number): Promise<void>;
  unbanMember(userExternalId: string, reason?: string): Promise<void>;
  purgeMessages(channelId: string, count: number): Promise<number>;
  setSlowmode(channelId: string, seconds: number): Promise<void>;
  setChannelLocked(channelId: string, locked: boolean, reason?: string): Promise<void>;

  /** Does the bot hold the named Discord permission in this guild/channel? */
  botHasPermission(permission: string, channelId?: string): Promise<boolean>;
  /** The invoking member's role ids → for permission checks. */
  getMemberRoleIds(userExternalId: string): Promise<string[]>;
  /** Whether the user is the guild owner. */
  isGuildOwner(userExternalId: string): Promise<boolean>;
}

/** Factory: resolves a GuildService for a given external guild id. */
export interface GuildServiceProvider {
  /** Null when the adapter is disconnected or doesn't know the guild. */
  forGuild(guildExternalId: string): GuildService | null;
  /** True when the underlying adapter is connected and usable. */
  isReady(): boolean;
}
