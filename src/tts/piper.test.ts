import { describe, it, expect } from 'vitest';
import { sanitizeTtsText } from './piper.js';

describe('sanitizeTtsText', () => {
  it('removes NUL bytes that crash the piper phonemizer', () => {
    expect(sanitizeTtsText('Текст\u0000с нулём')).toBe('Текстс нулём');
  });
  it('removes other control characters (bell, backspace…)', () => {
    expect(sanitizeTtsText('Звонок\u0007здесь\u0008Назад')).toBe('ЗвонокздесьНазад');
  });
  it('keeps newline and tab (meaningful for speech pauses)', () => {
    expect(sanitizeTtsText('Строка\nВторая\tТретья')).toBe('Строка\nВторая\tТретья');
  });
  it('trims surrounding whitespace', () => {
    expect(sanitizeTtsText('  чистый текст  ')).toBe('чистый текст');
  });
  it('removes DEL (0x7F)', () => {
    expect(sanitizeTtsText('Текст\u007Fконец')).toBe('Текстконец');
  });
  it('leaves normal punctuation and unicode untouched', () => {
    const s = 'Привет, мир! «Кавычки»… — тире. 100% 🎉';
    expect(sanitizeTtsText(s)).toBe(s);
  });
});
