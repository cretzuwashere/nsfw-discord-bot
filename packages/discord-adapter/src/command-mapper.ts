import type { CommandDefinition, CommandOptionDef } from '@botplatform/core';

/**
 * Discord application command option types (subset we use).
 * https://discord.com/developers/docs/interactions/application-commands
 */
export const DISCORD_OPTION_TYPES = {
  string: 3,
  integer: 4,
  boolean: 5,
} as const;

export interface DiscordCommandJson {
  name: string;
  description: string;
  options?: Array<{
    type: number;
    name: string;
    description: string;
    required: boolean;
  }>;
  /** 0 = guild-only (no DMs); omitted = everywhere. */
  contexts?: number[];
}

/** Convert adapter-neutral command definitions into Discord registration JSON. */
export function commandsToDiscordJson(commands: CommandDefinition[]): DiscordCommandJson[] {
  return commands.map((command) => {
    const json: DiscordCommandJson = {
      name: command.name,
      description: truncateDescription(command.description),
    };
    if (command.options && command.options.length > 0) {
      json.options = command.options.map(optionToJson);
    }
    if (command.guildOnly) {
      json.contexts = [0]; // InteractionContextType.Guild
    }
    return json;
  });
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
