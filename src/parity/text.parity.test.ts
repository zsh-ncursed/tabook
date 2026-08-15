// Golden parity: text utilities — native (Rust) vs pure-TS fallback.
import { describe, it, expect } from 'vitest';
import { requireNative } from './helpers.js';
import {
  displayWidth,
  decodeEntities,
  normalizeWhitespace,
  stripHtml,
  truncate,
  truncateW,
  splitChars,
} from '../utils/text.js';

const n = requireNative();

const TEXT_CORPUS = [
  'hello world',
  'Hello, World!',
  '  много   пробелов\tи табов  ',
  '漢字かな混じり',
  'emoji 🎉 and 😀 mixed',
  'Привет, мир!',
  'café crème — naïve',
  'İstanbul',
  'a\u00a0b',
  'x'.repeat(200),
  '',
  '   ',
];

const ENTITY_CORPUS = [
  '&amp; &lt; &gt; &quot; &apos;',
  '&#65; &#x41; &#x1F600;',
  '&nbsp;&mdash;&hellip;',
  '&bogus; &amp;amp;',
  'no entities here',
  '&#x110000; &#xFFFF; &#0;',
];

const HTML_CORPUS = [
  '<p>Hello <b>world</b></p>',
  'a<br/>b<br>c',
  '<li>one</li><li>two</li>',
  '<p>Text with <a href="#">link</a></p>\n<p>Second</p>',
  '<div>line1</div><div>line2</div>',
  'plain text, no html',
  '<p>   spaced   </p>',
];

describe('parity: text utilities', () => {
  it('displayWidth matches', () => {
    for (const s of TEXT_CORPUS) {
      expect(n.displayWidth(s), `displayWidth(${JSON.stringify(s)})`).toBe(displayWidth(s));
    }
  });

  it('decodeEntities matches', () => {
    for (const s of ENTITY_CORPUS) {
      expect(n.decodeEntities(s), `decodeEntities(${JSON.stringify(s)})`).toBe(decodeEntities(s));
    }
  });

  it('normalizeWhitespace matches', () => {
    for (const s of TEXT_CORPUS) {
      expect(n.normalizeWhitespace(s), `normalizeWhitespace(${JSON.stringify(s)})`).toBe(
        normalizeWhitespace(s),
      );
    }
  });

  it('stripHtml matches', () => {
    for (const s of HTML_CORPUS) {
      expect(n.stripHtml(s), `stripHtml(${JSON.stringify(s)})`).toBe(stripHtml(s));
    }
  });

  it('truncate matches (default and custom suffix)', () => {
    for (const s of TEXT_CORPUS) {
      for (const max of [0, 1, 2, 3, 5, 10, 50]) {
        expect(n.truncate(s, max), `truncate(${JSON.stringify(s)}, ${max})`).toBe(truncate(s, max));
        expect(n.truncate(s, max, '…'), `truncate(${JSON.stringify(s)}, ${max}, …)`).toBe(
          truncate(s, max, '…'),
        );
      }
    }
  });

  it('truncateW matches', () => {
    for (const s of TEXT_CORPUS) {
      for (const max of [1, 2, 4, 8, 16, 40]) {
        expect(n.truncateW(s, max), `truncateW(${JSON.stringify(s)}, ${max})`).toBe(
          truncateW(s, max),
        );
      }
    }
  });

  it('splitChars matches', () => {
    for (const s of TEXT_CORPUS) {
      expect(n.splitChars(s), `splitChars(${JSON.stringify(s)})`).toEqual(splitChars(s));
    }
  });
});
