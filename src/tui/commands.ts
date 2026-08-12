import { shellSplit } from '../utils/text.js';

export const COMMANDS = [
  'q',
  'quit',
  'exit',
  'open',
  'o',
  'theme',
  'themes',
  'sort',
  'group',
  'goto',
  'simplified',
  'css',
  'search',
  'help',
  'config',
  'opds',
  'library',
] as const;

export const OPDS_SUBS = ['add', 'remove', 'list'] as const;
export const LIBRARY_SUBS = ['add', 'remove', 'list', 'scan'] as const;

/**
 * Returns the length of the command-name prefix that matches a valid command.
 * e.g. ":opd" → 3 (matches "opds"), ":opdf" → 3 (only "opd" matches, "f" is
 * the invalid tail), ":opds" → 4. Only the first token (before the first
 * space) is validated; subcommands and arguments are not checked here.
 */
export function validCommandPrefixLength(input: string): number {
  const trimmed = input.replace(/^:/, '').trimStart();
  if (!trimmed) return 0;
  const parts = shellSplit(trimmed);
  const cmd = (parts[0] ?? '').toLowerCase();
  if (!cmd) return 0;
  const matches = COMMANDS.filter((c) => c.startsWith(cmd));
  if (matches.length === 0) {
    // No command starts with this — try the longest prefix that does match.
    for (let i = cmd.length - 1; i > 0; i--) {
      const prefix = cmd.slice(0, i);
      if (COMMANDS.some((c) => c.startsWith(prefix))) return i;
    }
    return 0;
  }
  return cmd.length;
}