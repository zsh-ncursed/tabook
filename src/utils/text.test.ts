import { describe, it, expect } from 'vitest';
import {
  inlinesToText,
  decodeEntities,
  normalizeWhitespace,
  truncate,
  displayWidth,
  formatBytes,
  shellSplit,
  splitChars,
  formatLocalTimestamp,
} from './text.js';
import type { Inline } from '../formats/model.js';

describe('inlinesToText', () => {
  it('flattens nested inline styles', () => {
    const inlines: Inline[] = [
      { kind: 'text', text: 'A ' },
      { kind: 'bold', children: [{ kind: 'text', text: 'bold' }] },
      { kind: 'link', href: '#x', children: [{ kind: 'text', text: ' link' }] },
    ];
    expect(inlinesToText(inlines)).toBe('A bold link');
  });

  it('handles every inline kind', () => {
    const inlines: Inline[] = [
      { kind: 'italic', children: [{ kind: 'text', text: 'i' }] },
      { kind: 'underline', children: [{ kind: 'text', text: 'u' }] },
      { kind: 'strike', children: [{ kind: 'text', text: 's' }] },
      { kind: 'code', text: 'c' },
      { kind: 'image', src: '#x', alt: 'alt' },
      { kind: 'image', src: '#y', alt: '' },
      { kind: 'lineBreak' },
    ];
    expect(inlinesToText(inlines)).toBe('iuscalt\n');
  });

  it('returns empty for undefined', () => {
    expect(inlinesToText(undefined)).toBe('');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;q&quot; &apos;s&apos;')).toBe(
      'a & b <c> "q" \'s\'',
    );
    expect(decodeEntities('&#65;&#x42;')).toBe('AB');
  });

  it('decodes common typographic entities', () => {
    expect(decodeEntities('&mdash; &ndash; &laquo;q&raquo; &hellip;')).toBe(
      '\u2014 \u2013 \u00abq\u00bb \u2026',
    );
  });

  it('does not throw on out-of-range or surrogate numeric entities', () => {
    expect(decodeEntities('&#1114112;')).toBe('\ufffd');
    expect(decodeEntities('&#x110000;')).toBe('\ufffd');
    expect(decodeEntities('&#xD800;')).toBe('\ufffd');
    expect(decodeEntities('a&#999999999;b')).toBe('a\ufffdb');
  });

  it('leaves unknown named entities untouched', () => {
    expect(decodeEntities('x &unknown; y')).toBe('x &unknown; y');
  });
});

describe('normalizeWhitespace', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeWhitespace('  hello \n\t world  ')).toBe('hello world');
  });
});

describe('truncate', () => {
  it('truncates with a suffix', () => {
    expect(truncate('abcdefgh', 5)).toBe('ab...');
    expect(truncate('abc', 5)).toBe('abc');
    expect(truncate('abcdef', 3)).toBe('...');
  });
});

describe('displayWidth', () => {
  it('counts wide characters as width 2', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('汉字')).toBe(4);
    expect(displayWidth('한')).toBe(2);
  });

  it('counts every wide range as width 2', () => {
    expect(displayWidth(String.fromCodePoint(0x1100))).toBe(2); // Hangul Jamo
    expect(displayWidth(String.fromCodePoint(0xf900))).toBe(2); // CJK compat
    expect(displayWidth(String.fromCodePoint(0xfe30))).toBe(2); // CJK punctuation
    expect(displayWidth(String.fromCodePoint(0xff01))).toBe(2); // fullwidth form
    expect(displayWidth(String.fromCodePoint(0xffe0))).toBe(2); // fullwidth sign
    expect(displayWidth(String.fromCodePoint(0x20000))).toBe(2); // CJK ext B
    expect(displayWidth(String.fromCodePoint(0x30000))).toBe(2); // CJK ext G
  });
});

describe('formatBytes', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});

describe('shellSplit', () => {
  it('splits simple args', () => {
    expect(shellSplit('open book.fb2')).toEqual(['open', 'book.fb2']);
    expect(shellSplit('')).toEqual([]);
  });

  it('handles double and single quotes', () => {
    expect(shellSplit('open "my book.fb2"')).toEqual(['open', 'my book.fb2']);
    expect(shellSplit("open 'my book.fb2'")).toEqual(['open', 'my book.fb2']);
  });

  it('collapses spaces and tabs', () => {
    expect(shellSplit('  a\t b  ')).toEqual(['a', 'b']);
  });
});

describe('splitChars', () => {
  it('splits by Unicode code point, not UTF-16 code unit', () => {
    expect(splitChars('abc')).toEqual(['a', 'b', 'c']);
    // CJK: single code unit each, but exercised for completeness.
    expect(splitChars('汉字')).toEqual(['汉', '字']);
  });

  it('keeps surrogate pairs (emoji) intact', () => {
    // 😀 is U+1F600, a surrogate pair in UTF-16 — split('') would tear it apart.
    expect(splitChars('a😀b')).toEqual(['a', '😀', 'b']);
    expect(splitChars('a😀b')).toHaveLength(3);
  });

  it('returns empty array for empty string', () => {
    expect(splitChars('')).toEqual([]);
  });
});

describe('formatLocalTimestamp', () => {
  it('converts a UTC SQL timestamp to the given time zone', () => {
    // SQLite datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS".
    expect(formatLocalTimestamp('2026-08-09 10:00:00', 'UTC')).toBe('2026-08-09 10:00:00');
    // Europe/Moscow is fixed UTC+3 (no DST since 2014).
    expect(formatLocalTimestamp('2026-08-09 10:00:00', 'Europe/Moscow')).toBe(
      '2026-08-09 13:00:00',
    );
  });

  it('defaults to the local time zone', () => {
    const local = formatLocalTimestamp('2026-08-09 10:00:00');
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(local).not.toBe('');
  });

  it('returns invalid input unchanged', () => {
    expect(formatLocalTimestamp('')).toBe('');
    expect(formatLocalTimestamp('not a date')).toBe('not a date');
  });
});
