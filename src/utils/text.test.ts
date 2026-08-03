import { describe, it, expect } from 'vitest';
import {
  inlinesToText,
  decodeEntities,
  normalizeWhitespace,
  truncate,
  levenshtein,
  displayWidth,
  formatBytes,
  slugify,
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
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;q&quot; &apos;s&apos;')).toBe(
      'a & b <c> "q" \'s\'',
    );
    expect(decodeEntities('&#65;&#x42;')).toBe('AB');
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

describe('levenshtein', () => {
  it('computes edit distances', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', 'abc')).toBe(0);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('displayWidth', () => {
  it('counts wide characters as width 2', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('汉字')).toBe(4);
    expect(displayWidth('한')).toBe(2);
  });
});

describe('formatBytes', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaced  out  ')).toBe('spaced-out');
  });
});
