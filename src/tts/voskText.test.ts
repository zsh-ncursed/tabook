import { describe, it, expect } from 'vitest';
import { hasLatin, numberToRussian, prepareVoskText, transliterateLatin } from './voskText.js';

describe('prepareVoskText', () => {
  it('keeps ordinary Russian prose and lowercases it', () => {
    expect(prepareVoskText('Привет, мир!')).toBe('привет, мир!');
    expect(prepareVoskText('Это тест: вопрос? да; нет.')).toBe('это тест: вопрос? да; нет.');
  });

  it('handles Cyrillic out-of-vocabulary words without changes', () => {
    expect(prepareVoskText('Блокчейн, ксерокс, США.')).toBe('блокчейн, ксерокс, сша.');
  });

  it('replaces typographic quotes, ellipsis and dashes', () => {
    expect(prepareVoskText('«Кавычки» — тире…')).toBe('кавычки - тире...');
    expect(prepareVoskText('"double" and „low“')).toBe('доубле анд лов');
  });

  it('transliterates Latin (the G2P KeyError trigger)', () => {
    expect(prepareVoskText('Hello world')).toBe('хелло ворлд');
    expect(prepareVoskText('Tabook')).toBe('табук');
  });

  it('spells numbers, including thousands and percent', () => {
    expect(prepareVoskText('Глава 1.')).toBe('глава один.');
    expect(prepareVoskText('Это 100 процентов.')).toBe('это сто процентов.');
    expect(prepareVoskText('Скидка 12,5%')).toBe('скидка двенадцать запятая пять процентов');
    expect(prepareVoskText('21%')).toBe('двадцать один процент');
    expect(prepareVoskText('2%')).toBe('два процента');
  });

  it('strips characters the G2P cannot map', () => {
    expect(prepareVoskText('№5 $100 & / \\ (скобки)')).toBe('пять сто скобки');
    expect(prepareVoskText('@#$%^&*()')).toBe('');
  });

  it('returns empty only when there is nothing Russian left', () => {
    expect(prepareVoskText('')).toBe('');
    expect(prepareVoskText('123 456')).toBe('сто двадцать три четыреста пятьдесят шесть');
  });
});

describe('transliterateLatin', () => {
  it('prefers long digraphs', () => {
    expect(transliterateLatin('shch')).toBe('щ');
    expect(transliterateLatin('sch')).toBe('щ');
    expect(transliterateLatin('zh')).toBe('ж');
    expect(transliterateLatin('kh')).toBe('х');
    expect(transliterateLatin('x')).toBe('кс');
    expect(transliterateLatin('j')).toBe('дж');
  });

  it('leaves Cyrillic and punctuation untouched', () => {
    expect(transliterateLatin('уже ok!')).toBe('уже ок!');
  });
});

describe('numberToRussian', () => {
  it('uses feminine forms for thousands', () => {
    expect(numberToRussian(1001)).toBe('одна тысяча один');
    expect(numberToRussian(2026)).toBe('две тысячи двадцать шесть');
    expect(numberToRussian(5000)).toBe('пять тысяч');
  });

  it('handles millions and zero', () => {
    expect(numberToRussian(0)).toBe('ноль');
    expect(numberToRussian(1_000_000)).toBe('один миллион');
    expect(numberToRussian(5_000_000)).toBe('пять миллионов');
  });
});

describe('hasLatin', () => {
  it('detects Latin letters only', () => {
    expect(hasLatin('Привет')).toBe(false);
    expect(hasLatin('Привет, world')).toBe(true);
  });
});
