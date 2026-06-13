import type { CommandDefinition, CommandOptionDef } from '@botplatform/core';
import { PermissionsBitField } from 'discord.js';

/**
 * Discord application command option types (subset we use).
 * https://discord.com/developers/docs/interactions/application-commands
 */
export const DISCORD_OPTION_TYPES = {
  subcommand: 1,
  string: 3,
  integer: 4,
  boolean: 5,
  user: 6,
  channel: 7,
} as const;

interface DiscordOptionJson {
  type: number;
  name: string;
  description: string;
  required?: boolean;
  options?: DiscordOptionJson[];
}

export interface DiscordCommandJson {
  name: string;
  description: string;
  options?: DiscordOptionJson[];
  /** 0 = guild-only (no DMs); omitted = everywhere. */
  contexts?: number[];
  /** Stringified permission bitfield gating who can use the command. */
  default_member_permissions?: string;
}

/** Convert adapter-neutral command definitions into Discord registration JSON. */
export function commandsToDiscordJson(commands: CommandDefinition[]): DiscordCommandJson[] {
  return commands.map((command) => {
    const json: DiscordCommandJson = {
      name: command.name,
      description: truncateDescription(command.description),
    };
    if (command.subcommands && command.subcommands.length > 0) {
      json.options = command.subcommands.map((sub) => ({
        type: DISCORD_OPTION_TYPES.subcommand,
        name: sub.name,
        description: truncateDescription(sub.description),
        options: (sub.options ?? []).map(optionToJson),
      }));
    } else if (command.options && command.options.length > 0) {
      json.options = command.options.map(optionToJson);
    }
    if (command.guildOnly) {
      json.contexts = [0]; // InteractionContextType.Guild
    }
    if (command.defaultMemberPermissions && command.defaultMemberPermissions.length > 0) {
      json.default_member_permissions = permissionsToBitfield(command.defaultMemberPermissions);
    }
    return json;
  });
}

/** Combine permission names into the stringified bitfield Discord expects. */
function permissionsToBitfield(names: string[]): string {
  const bits = new PermissionsBitField();
  for (const name of names) {
    const flag = (PermissionsBitField.Flags as Record<string, bigint>)[name];
    if (flag !== undefined) bits.add(flag);
  }
  return bits.bitfield.toString();
}

function optionToJson(option: CommandOptionDef) {
  return {
    type: DISCORD_OPTION_TYPES[option.type],
    name: option.name,
    description: truncateDescription(option.description),
    required: option.required ?? false,
  };
}

/** Discord caps descriptions at 100 characters. */
function truncateDescription(description: string): string {
  return description.length <= 100 ? description : `${description.slice(0, 99)}…`;
}
