/**
 * Safe {{placeholder}} substitution shared by card templates and message
 * templates (welcome, birthday, scheduled, custom commands). Only resolves
 * against the provided data map; unknown placeholders render as empty strings
 * and nothing is ever evaluated as code.
 */

export type PlaceholderData = Record<string, string | number | undefined>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function applyPlaceholders(template: string, data: PlaceholderData): string {
  return template.replace(PLACEHOLDER, (_match, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

/** Placeholder keys the platform documents and supports. */
export const SUPPORTED_PLACEHOLDERS = [
  'user.username',
  'user.displayName',
  'user.mention',
  'user.avatarUrl',
  'user.id',
  'server.name',
  'server.memberCount',
  'date.today',
  'birthday.age',
  'role.name',
] as const;

export function buildPlaceholderData(input: {
  user?: { id?: string; username?: string; displayName?: string; avatarUrl?: string };
  server?: { name?: string; memberCount?: number };
  birthday?: { age?: number };
  role?: { name?: string };
  today?: string;
}): PlaceholderData {
  const data: PlaceholderData = {};
  if (input.user) {
    if (input.user.id !== undefined) {
      data['user.id'] = input.user.id;
      data['user.mention'] = `<@${input.user.id}>`;
    }
    if (input.user.username !== undefined) data['user.username'] = input.user.username;
    if (input.user.displayName !== undefined) data['user.displayName'] = input.user.displayName;
    if (input.user.avatarUrl !== undefined) data['user.avatarUrl'] = input.user.avatarUrl;
  }
  if (input.server) {
    if (input.server.name !== undefined) data['server.name'] = input.server.name;
    if (input.server.memberCount !== undefined) data['server.memberCount'] = input.server.memberCount;
  }
  if (input.birthday?.age !== undefined) data['birthday.age'] = input.birthday.age;
  if (input.role?.name !== undefined) data['role.name'] = input.role.name;
  if (input.today !== undefined) data['date.today'] = input.today;
  return data;
}
