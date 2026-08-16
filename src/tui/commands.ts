import { shellSplit } from '../utils/text.js';

export type CommandScreen = 'library' | 'reader' | 'opds';

// One entry per :help line. Several entries may share `names` when a command
// has subcommands (e.g. ':opds add', ':opds list') — each gets its own help
// row, but they all validate/dispatch through the same first token.
export interface CommandDef {
  /** Accepted first-token spellings (e.g. ['open', 'o']). */
  names: string[];
  /** Usage string shown in :help, e.g. ':open [path]'. */
  usage: string;
  /** One-line description for :help. */
  desc: string;
  screens: CommandScreen[];
}

export const COMMANDS: CommandDef[] = [
  {
    names: ['open', 'o'],
    usage: ':open [path]',
    desc: 'Open a book file (falls back to picker)',
    screens: ['library', 'reader'],
  },
  {
    names: ['theme'],
    usage: ':theme <name>',
    desc: 'Switch theme (persisted to config)',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['themes'],
    usage: ':themes',
    desc: 'List available themes',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['sort'],
    usage: ':sort <field>',
    desc: 'Sort by title, author, added or progress',
    screens: ['library'],
  },
  {
    names: ['group'],
    usage: ':group',
    desc: 'Toggle group-by-series',
    screens: ['library'],
  },
  {
    names: ['goto'],
    usage: ':goto <page>',
    desc: 'Jump to a page (:goto 10% also works)',
    screens: ['reader'],
  },
  {
    names: ['simplified'],
    usage: ':simplified',
    desc: 'Toggle simplified reading mode',
    screens: ['reader'],
  },
  {
    names: ['css'],
    usage: ':css',
    desc: 'Respect publisher CSS (engine arrives later)',
    screens: ['reader'],
  },
  {
    names: ['search'],
    usage: ':search <query>',
    desc: 'Search the current book',
    screens: ['reader'],
  },
  {
    names: ['help', '?'],
    usage: ':help',
    desc: 'Show keybindings & commands',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['config'],
    usage: ':config init',
    desc: 'Write a default config file',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['config'],
    usage: ':config edit',
    desc: 'Open config in $EDITOR, reload live',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['opds'],
    usage: ':opds',
    desc: 'Open the OPDS catalog browser',
    screens: ['library', 'reader'],
  },
  {
    names: ['opds'],
    usage: ':opds add <name> <url> [user] [pass]',
    desc: 'Add an OPDS catalog',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['opds'],
    usage: ':opds remove <name>',
    desc: 'Remove an OPDS catalog',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['opds'],
    usage: ':opds list',
    desc: 'List configured OPDS catalogs',
    screens: ['library', 'reader', 'opds'],
  },
  {
    names: ['library', 'folder'],
    usage: ':library add <path>',
    desc: 'Attach a folder as a library',
    screens: ['library', 'reader'],
  },
  {
    names: ['library'],
    usage: ':library list',
    desc: 'List attached folders',
    screens: ['library', 'reader'],
  },
  {
    names: ['library'],
    usage: ':library scan',
    desc: 'Rescan all attached folders',
    screens: ['library', 'reader'],
  },
  {
    names: ['library'],
    usage: ':library remove <path>',
    desc: 'Detach a folder and remove its books',
    screens: ['library', 'reader'],
  },
  {
    names: ['q', 'quit', 'exit'],
    usage: ':q / :quit',
    desc: 'Quit',
    screens: ['library', 'reader', 'opds'],
  },
];

// Every accepted first-token spelling, de-duplicated — used for prefix
// validation and tab completion.
export const COMMAND_NAMES: readonly string[] = [...new Set(COMMANDS.flatMap((c) => c.names))];

/**
 * The executable form of a command for the command palette: the usage string
 * with argument placeholders stripped (':open [path]' → ':open', ':opds add
 * <name> <url> [user] [pass]' → ':opds add'). Running it either performs the
 * command (for optional-arg commands like :open the bare form opens the
 * picker/theme-picker) or prints usage when required args are missing.
 */
export function commandExecutable(def: CommandDef): string {
  // ':q / :quit' → ':q': a ' / ' suffix lists aliases — the first spelling
  // is the canonical executable form.
  const primary = def.usage.split(' / ')[0]!;
  return primary
    .split(' ')
    .filter((token) => !token.startsWith('<') && !token.startsWith('['))
    .join(' ');
}

export interface CommandMatch {
  def: CommandDef;
  /** Fuzzy-match score; lower is better (0 = query is a prefix). */
  score: number;
  /** Char offsets in the haystack that matched the query. */
  indices: number[];
}

/**
 * Subsequence fuzzy match: every query char must appear in `text` in order
 * (case-insensitive). Returns the matched offsets plus a score that rewards
 * matches that start early and are packed together, or null when the query
 * is not a subsequence. Empty query scores 0 with no indices.
 */
export function fuzzyMatch(
  query: string,
  text: string,
): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === '') return { score: 0, indices: [] };
  let prev = -1;
  let score = 0;
  const indices: number[] = [];
  for (const ch of q) {
    const idx = t.indexOf(ch, prev + 1);
    if (idx === -1) return null;
    if (prev === -1)
      score += idx; // start-position penalty
    else score += idx - prev - 1; // gap penalty between consecutive matches
    prev = idx;
    indices.push(idx);
  }
  return { score, indices };
}

/**
 * Commands available for the given screen, fuzzy-filtered by `query` and
 * sorted by match quality (best first). An empty query returns every command
 * for the screen in registry order.
 */
export function fuzzyMatchCommands(query: string, screen: CommandScreen): CommandMatch[] {
  const q = query.trim().toLowerCase().replace(/^:/, '');
  const candidates = COMMANDS.filter((c) => c.screens.includes(screen));
  if (q === '') {
    return candidates.map((def) => ({ def, score: 0, indices: [] }));
  }
  const out: CommandMatch[] = [];
  for (const def of candidates) {
    const haystack = `${def.usage} ${def.desc}`;
    const m = fuzzyMatch(q, haystack);
    if (m !== null) out.push({ def, score: m.score, indices: m.indices });
  }
  out.sort((a, b) => a.score - b.score || a.def.usage.localeCompare(b.def.usage));
  return out;
}

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
  const matches = COMMAND_NAMES.filter((c) => c.startsWith(cmd));
  if (matches.length === 0) {
    // No command starts with this — try the longest prefix that does match.
    for (let i = cmd.length - 1; i > 0; i--) {
      const prefix = cmd.slice(0, i);
      if (COMMAND_NAMES.some((c) => c.startsWith(prefix))) return i;
    }
    return 0;
  }
  return cmd.length;
}

/**
 * Tab completion for the command line. Returns the completed input (with a
 * trailing space when the completion is unambiguous and more tokens may
 * follow), or null when there is nothing to complete.
 * `themeNames` is injected so this module stays free of theme dependencies.
 */
export function completeCommand(value: string, themeNames: () => string[]): string | null {
  const trimmed = value.replace(/^:/, '').trim();
  if (!trimmed) return null;
  const parts = shellSplit(trimmed);
  const cmd = (parts[0] ?? '').toLowerCase();
  if (parts.length <= 1 && !trimmed.includes(' ')) {
    const matches = COMMAND_NAMES.filter((c) => c.startsWith(cmd));
    if (matches.length === 1) return `:${matches[0]} `;
  }
  if (cmd === 'opds' && parts.length === 2) {
    const sub = (parts[1] ?? '').toLowerCase();
    const subs = OPDS_SUBS.filter((s) => s.startsWith(sub));
    if (subs.length === 1) return `:opds ${subs[0]} `;
  }
  if (cmd === 'library' && parts.length === 2) {
    const sub = (parts[1] ?? '').toLowerCase();
    const subs = LIBRARY_SUBS.filter((s) => s.startsWith(sub));
    if (subs.length === 1) return `:library ${subs[0]} `;
  }
  if (cmd === 'theme' && parts.length === 2) {
    const prefix = (parts[1] ?? '').toLowerCase();
    const matches = themeNames().filter((t) => t.startsWith(prefix));
    if (matches.length === 1) return `:theme ${matches[0]}`;
  }
  return null;
}
