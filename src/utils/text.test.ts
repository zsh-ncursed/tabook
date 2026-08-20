import { describe, it, expect } from 'vitest';
import {
  inlinesToText,
  decodeEntities,
  normalizeWhitespace,
  truncate,
  truncateW,
  displayWidth,
  formatBytes,
  formatDuration,
  shellSplit,
  splitChars,
  formatLocalTimestamp,
  stripHtml,
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

  it('decodes extended named entities (Greek, arrows, math)', () => {
    expect(decodeEntities('&alpha;&beta;&gamma;')).toBe('\u03b1\u03b2\u03b3');
    expect(decodeEntities('&Alpha;&Omega;')).toBe('\u0391\u03a9');
    expect(decodeEntities('&larr;&rarr;&uarr;&darr;')).toBe('\u2190\u2192\u2191\u2193');
    expect(decodeEntities('&sum;&prod;&int;')).toBe('\u2211\u220f\u222b');
    expect(decodeEntities('&le;&ge;&ne;')).toBe('\u2264\u2265\u2260');
    expect(decodeEntities('&spades;&hearts;&diams;&clubs;')).toBe('\u2660\u2665\u2666\u2663');
  });

  it('decodes additional typographic entities', () => {
    expect(decodeEntities('&sbquo;&bdquo;')).toBe('\u201a\u201e');
    expect(decodeEntities('&dagger;&Dagger;')).toBe('\u2020\u2021');
    expect(decodeEntities('&permil;')).toBe('\u2030');
    expect(decodeEntities('&minus;')).toBe('\u2212');
    expect(decodeEntities('&lsaquo;&rsaquo;')).toBe('\u2039\u203a');
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

  it('counts Braille patterns as width 2', () => {
    expect(displayWidth(String.fromCodePoint(0x2800))).toBe(2); // Braille blank
    expect(displayWidth(String.fromCodePoint(0x28ff))).toBe(2); // Braille full
  });

  it('counts Tai Tham as width 2', () => {
    expect(displayWidth(String.fromCodePoint(0x1a20))).toBe(2);
    expect(displayWidth(String.fromCodePoint(0x1aad))).toBe(2);
  });

  it('counts Balinese as width 2', () => {
    expect(displayWidth(String.fromCodePoint(0x1b00))).toBe(2);
    expect(displayWidth(String.fromCodePoint(0x1b7f))).toBe(2);
  });

  it('counts Yi Syllables as width 2', () => {
    expect(displayWidth(String.fromCodePoint(0xa000))).toBe(2);
    expect(displayWidth(String.fromCodePoint(0xa4cf))).toBe(2);
  });

  it('counts emoji as width 2', () => {
    expect(displayWidth(String.fromCodePoint(0x1f300))).toBe(2); // Cyclone
    expect(displayWidth(String.fromCodePoint(0x1f600))).toBe(2); // 😀
  });

  it('handles mixed wide and narrow characters', () => {
    expect(displayWidth('a汉b')).toBe(4); // 1 + 2 + 1
    expect(displayWidth('😀x')).toBe(3); // 2 + 1
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

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h 0m');
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

describe('stripHtml', () => {
  it('converts <br/> to newlines', () => {
    expect(stripHtml('line1<br/>line2<br/>line3')).toBe('line1\nline2\nline3');
  });

  it('converts <br> without self-close', () => {
    expect(stripHtml('a<br>b')).toBe('a\nb');
  });

  it('adds newline after block tags', () => {
    expect(stripHtml('<p>one</p><p>two</p>')).toBe('one\n\ntwo');
  });

  it('strips inline tags', () => {
    expect(stripHtml('<b>bold</b> and <i>italic</i>')).toBe('bold and italic');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&lt;tag&gt; &amp; &quot;quote&quot;')).toBe('<tag> & "quote"');
  });

  it('handles nested tags', () => {
    const html = '<blockquote><p>quoted</p></blockquote>';
    expect(stripHtml(html)).toBe('quoted');
  });

  it('collapses excessive newlines', () => {
    expect(stripHtml('a<br/><br/><br/>b')).toBe('a\n\nb');
  });

  it('trims leading/trailing whitespace', () => {
    expect(stripHtml('  <p>text</p>  ')).toBe('text');
  });

  it('handles empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('handles flibusta-style content', () => {
    const html = 'Формат: fb2<br/>Язык: ru<br/>Размер: 40 Kb<br/>';
    const out = stripHtml(html);
    expect(out).toBe('Формат: fb2\nЯзык: ru\nРазмер: 40 Kb');
    expect(out).not.toContain('<');
    expect(out).not.toContain('&');
  });
});

describe('truncateW', () => {
  it('returns short text unchanged', () => {
    expect(truncateW('hello', 10)).toBe('hello');
  });

  it('truncates ASCII with ellipsis', () => {
    expect(truncateW('hello world', 5)).toBe('hell…');
  });

  it('counts CJK characters as 2 columns', () => {
    // 5 CJK chars × 2 = 10 columns, fits in 10
    expect(truncateW('中文中文中', 10)).toBe('中文中文中');
    // 6 CJK chars × 2 = 12 columns, exceeds 10
    expect(truncateW('中文中文中文', 10)).toBe('中文中文…');
  });

  it('handles mixed ASCII + CJK', () => {
    // 'ab中文' = 2 + 4 = 6 columns
    expect(truncateW('ab中文', 6)).toBe('ab中文');
    // 'ab中文' = 6 columns, exceeds 5
    expect(truncateW('ab中文', 5)).toBe('ab中…');
  });

  it('truncates Russian (1 column each) like ASCII', () => {
    expect(truncateW('Привет мир', 7)).toBe('Привет…');
  });

  it('empty string returns empty', () => {
    expect(truncateW('', 10)).toBe('');
  });
});
