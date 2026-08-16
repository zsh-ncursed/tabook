import { describe, it, expect } from 'vitest';
import {
  validCommandPrefixLength,
  COMMANDS,
  COMMAND_NAMES,
  completeCommand,
  commandExecutable,
  fuzzyMatch,
  fuzzyMatchCommands,
  type CommandDef,
} from './commands.js';

describe('validCommandPrefixLength', () => {
  it('returns 0 for empty input', () => {
    expect(validCommandPrefixLength('')).toBe(0);
    expect(validCommandPrefixLength(':')).toBe(0);
    expect(validCommandPrefixLength('  ')).toBe(0);
  });

  it('returns full length for exact command match', () => {
    expect(validCommandPrefixLength(':opds')).toBe(4);
    expect(validCommandPrefixLength(':q')).toBe(1);
    expect(validCommandPrefixLength(':theme')).toBe(5);
  });

  it('returns full length for unique prefix', () => {
    // "ope" only matches "open"
    expect(validCommandPrefixLength(':ope')).toBe(3);
    // "sim" only matches "simplified"
    expect(validCommandPrefixLength(':sim')).toBe(3);
  });

  it('returns the typed length when multiple commands match (still valid prefix)', () => {
    // "o" matches "o" and "open" — both valid, typed length is valid
    expect(validCommandPrefixLength(':o')).toBe(1);
    // "s" matches "sort", "search", "simplified" — still valid prefix
    expect(validCommandPrefixLength(':s')).toBe(1);
  });

  it('trims the invalid tail to the longest matching prefix', () => {
    // "opdf" — no command starts with "opdf", but "opd" matches "opds"
    expect(validCommandPrefixLength(':opdf')).toBe(3);
    // "xyz" — no command starts with "x", so 0
    expect(validCommandPrefixLength(':xyz')).toBe(0);
    // "themee" — "theme" matches (5), extra "e" is invalid
    expect(validCommandPrefixLength(':themee')).toBe(5);
  });

  it('handles input without leading colon', () => {
    expect(validCommandPrefixLength('opds')).toBe(4);
    expect(validCommandPrefixLength('opdf')).toBe(3);
  });

  it('ignores trailing arguments (only validates first token)', () => {
    expect(validCommandPrefixLength(':opds add')).toBe(4);
    expect(validCommandPrefixLength(':theme dracula')).toBe(5);
    expect(validCommandPrefixLength(':opds xyz')).toBe(4);
  });

  it('returns 0 for a command that matches no known command', () => {
    expect(validCommandPrefixLength(':zzz')).toBe(0);
  });
});

describe('COMMANDS registry', () => {
  it('contains the expected core commands', () => {
    expect(COMMAND_NAMES).toContain('opds');
    expect(COMMAND_NAMES).toContain('theme');
    expect(COMMAND_NAMES).toContain('q');
    expect(COMMAND_NAMES).toContain('library');
  });

  it('exposes usage + desc for every command for :help', () => {
    for (const def of COMMANDS) {
      expect(def.usage).toMatch(/^:/);
      expect(def.desc.length).toBeGreaterThan(0);
      expect(def.screens.length).toBeGreaterThan(0);
      expect(def.names.length).toBeGreaterThan(0);
    }
  });
});

describe('commandExecutable', () => {
  const def = (usage: string): CommandDef => ({
    names: ['x'],
    usage,
    desc: 'd',
    screens: ['reader'],
  });

  it('keeps plain commands unchanged', () => {
    expect(commandExecutable(def(':group'))).toBe(':group');
    expect(commandExecutable(def(':themes'))).toBe(':themes');
  });

  it('strips optional arguments', () => {
    expect(commandExecutable(def(':open [path]'))).toBe(':open');
  });

  it('strips required arguments', () => {
    expect(commandExecutable(def(':theme <name>'))).toBe(':theme');
  });

  it('keeps subcommand tokens but drops their arguments', () => {
    expect(commandExecutable(def(':opds add <name> <url> [user] [pass]'))).toBe(':opds add');
    expect(commandExecutable(def(':library remove <path>'))).toBe(':library remove');
  });

  it('drops alias separators in usage strings', () => {
    expect(commandExecutable(def(':q / :quit'))).toBe(':q');
  });

  it('produces a runnable command for every registry entry', () => {
    for (const c of COMMANDS) {
      const exec = commandExecutable(c);
      expect(exec.startsWith(':')).toBe(true);
      expect(exec.split(' ')[0]).toBe(c.usage.split(' ')[0]);
    }
  });
});

describe('fuzzyMatch', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyMatch('xyz', ':theme')).toBeNull();
    expect(fuzzyMatch('tmeh', ':theme')).toBeNull();
  });

  it('matches a subsequence in order, case-insensitively', () => {
    const m = fuzzyMatch('thm', ':theme');
    expect(m).not.toBeNull();
    expect(m!.indices).toEqual([1, 2, 4]); // t h m in ":theme"
  });

  it('scores prefix matches better than scattered ones', () => {
    const prefix = fuzzyMatch('th', ':theme')!;
    const scattered = fuzzyMatch('tme', ':theme')!;
    expect(prefix.score).toBeLessThan(scattered.score);
  });

  it('empty query matches with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });
});

describe('fuzzyMatchCommands', () => {
  it('returns every command for the screen when the query is empty', () => {
    const all = fuzzyMatchCommands('', 'reader');
    expect(all.length).toBe(COMMANDS.filter((c) => c.screens.includes('reader')).length);
    expect(all.every((m) => m.def.screens.includes('reader'))).toBe(true);
  });

  it('filters by screen', () => {
    const library = fuzzyMatchCommands('', 'library');
    expect(library.some((m) => m.def.usage === ':sort <field>')).toBe(true);
    expect(library.some((m) => m.def.usage === ':goto <page>')).toBe(false);
  });

  it('finds commands by fuzzy query and ranks best first', () => {
    const results = fuzzyMatchCommands('simpl', 'reader');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.def.names).toContain('simplified');
  });

  it('searches the description too', () => {
    // 'catalog' appears only in descriptions, never in usage strings.
    const results = fuzzyMatchCommands('catalog', 'reader');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((m) => m.def.usage.startsWith(':opds'))).toBe(true);
  });

  it('ignores a leading colon in the query', () => {
    expect(fuzzyMatchCommands(':simpl', 'reader')[0]!.def.names).toContain('simplified');
  });
});

describe('completeCommand', () => {
  const themeNames = () => ['dracula', 'solarized'];

  it('completes a unique command name', () => {
    expect(completeCommand(':ope', themeNames)).toBe(':open ');
  });

  it('returns null when several commands match', () => {
    expect(completeCommand(':s', themeNames)).toBeNull();
  });

  it('completes opds/library subcommands', () => {
    expect(completeCommand(':opds re', themeNames)).toBe(':opds remove ');
    expect(completeCommand(':library sc', themeNames)).toBe(':library scan ');
  });

  it('completes theme names', () => {
    expect(completeCommand(':theme dra', themeNames)).toBe(':theme dracula');
  });

  it('returns null for empty or unknown input', () => {
    expect(completeCommand('', themeNames)).toBeNull();
    expect(completeCommand(':zzz', themeNames)).toBeNull();
  });
});
