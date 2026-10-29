import { shellSplit } from '../utils/text.js';
import type { BookRecord } from '../db/db.js';

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
    desc: 'Toggle respect-publisher-CSS (stored; engine pending)',
    screens: ['reader'],
  },
  {
    names: ['css'],
    usage: ':css on',
    desc: 'Respect publisher CSS from EPUBs (engine pending)',
    screens: ['reader'],
  },
  {
    names: ['css'],
    usage: ':css off',
    desc: 'Ignore publisher CSS from EPUBs',
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
    names: ['tts'],
    usage: ':tts',
    desc: 'Read aloud: play / pause from the current position',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts stop',
    desc: 'Stop reading aloud',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts continue',
    desc: 'Resume reading from the last saved position',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts engines',
    desc: 'List available TTS engines / voices',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts voice <engine>[/<voice>]',
    desc: 'Switch TTS engine and/or voice',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts rate <n>',
    desc: 'Set TTS playback rate (0.5-4.0)',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts follow',
    desc: 'Toggle follow-while-reading (scroll with the voice)',
    screens: ['reader'],
  },
  {
    names: ['tts'],
    usage: ':tts config',
    desc: 'Open TTS settings (engine, voice, rate, pitch, download voices)',
    screens: ['reader'],
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

export interface BookMatch {
  book: BookRecord;
  /** Fuzzy-match score; lower is better (0 = query is a prefix). */
  score: number;
  /** Char offsets in the haystack (title + author) that matched the query. */
  indices: number[];
}

/**
 * Fuzzy-match library books by title/authors/series/genres, reusing the same
 * subsequence matcher as commands. Returns the best `limit` matches sorted by
 * score, or [] for an empty query (the palette shows commands only then).
 */
export function fuzzyMatchBooks(query: string, books: BookRecord[], limit = 25): BookMatch[] {
  const q = query.trim().toLowerCase().replace(/^:/, '');
  if (q === '') return [];
  const out: BookMatch[] = [];
  for (const book of books) {
    const haystack = [book.title, book.authorsText, book.seriesText ?? '', ...book.genres].join(
      ' ',
    );
    const m = fuzzyMatch(q, haystack);
    if (m !== null) out.push({ book, score: m.score, indices: m.indices });
  }
  out.sort((a, b) => a.score - b.score || a.book.title.localeCompare(b.book.title));
  return out.slice(0, limit);
}

// Субкоманды выводятся из самого реестра: второй литеральный токен
// usage-строки (':opds add <name>' → 'add'). Единственный источник правды
// держит :help, tab-дополнение и подсветку ввода в согласии друг с другом.
const SUBCOMMANDS: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const def of COMMANDS) {
    const second = def.usage.replace(/^:/, '').split(' ')[1];
    if (!second || !/^[a-z][a-z0-9_-]*$/i.test(second)) continue;
    for (const name of def.names) {
      const list = map.get(name) ?? [];
      if (!list.includes(second)) list.push(second);
      map.set(name, list);
    }
  }
  return map;
})();

/** Известные субкоманды команды, по её полному имени ('tts' → ['stop', …]). */
export function commandSubs(cmd: string): string[] {
  return SUBCOMMANDS.get(cmd.toLowerCase()) ?? [];
}

export const OPDS_SUBS = commandSubs('opds');
export const LIBRARY_SUBS = commandSubs('library');
export const TTS_SUBS = commandSubs('tts');

/** Длина префикса первого токена, который ещё может стать командой. */
function validCommandNameLength(cmd: string): number {
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
 * Returns the length of the typed command prefix that is still valid.
 * e.g. ":opd" → 3 (matches "opds"), ":opdf" → 3 (only "opd" matches, "f" is
 * the invalid tail), ":opds" → 4. A known subcommand extends the valid prefix
 * (":opds add" → 8, ":tts conf" → 8), an unknown one stops it before the
 * subcommand (":tts xyz" → 3). Commands whose second token is an argument
 * placeholder (":theme <name>", ":goto <page>") cannot be validated further,
 * so only their name counts.
 */
export function validCommandPrefixLength(input: string): number {
  const trimmed = input.replace(/^:/, '').trimStart();
  if (!trimmed) return 0;
  const parts = shellSplit(trimmed);
  const rawCmd = parts[0] ?? '';
  const cmd = rawCmd.toLowerCase();
  const firstLen = validCommandNameLength(cmd);
  if (firstLen === 0) return 0;
  // Субкоманда осмысленна только после полного имени команды.
  if (!COMMAND_NAMES.includes(cmd)) return firstLen;
  const subs = commandSubs(cmd);
  if (subs.length === 0) return firstLen;
  const sub = (parts[1] ?? '').toLowerCase();
  if (!sub) return firstLen;
  if (!subs.some((s) => s.startsWith(sub))) return firstLen;
  return rawCmd.length + 1 + sub.length;
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
  const subs = commandSubs(cmd);
  if (subs.length > 0 && parts.length === 2) {
    const sub = (parts[1] ?? '').toLowerCase();
    const matches = subs.filter((s) => s.startsWith(sub));
    if (matches.length === 1) return `:${cmd} ${matches[0]} `;
  }
  if (cmd === 'theme' && parts.length === 2) {
    const prefix = (parts[1] ?? '').toLowerCase();
    const matches = themeNames().filter((t) => t.startsWith(prefix));
    if (matches.length === 1) return `:theme ${matches[0]}`;
  }
  return null;
}
