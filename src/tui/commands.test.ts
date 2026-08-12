import { describe, it, expect } from 'vitest';
import { validCommandPrefixLength, COMMANDS } from './commands.js';

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

describe('COMMANDS', () => {
  it('contains the expected core commands', () => {
    expect(COMMANDS).toContain('opds');
    expect(COMMANDS).toContain('theme');
    expect(COMMANDS).toContain('q');
    expect(COMMANDS).toContain('library');
  });
});