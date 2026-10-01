import { describe, it, expect } from 'vitest';
import { sanitizeTtsText, summarizeStderr } from './piper.js';

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

describe('summarizeStderr', () => {
  it('collapses a piper traceback with ANSI to the exception line', () => {
    const raw = [
      '\u001b[0;93m2026-10-01 [W:onnxruntime:Default, telemetry.cc:800] Failed to persist\u001b[m',
      'Traceback (most recent call last):',
      '  File "/home/osha/.local/bin/piper", line 10, in <module>',
      '    sys.exit(main())',
      'ValueError: Unable to find voice: /nonexistent.onnx',
    ].join('\n');
    // Одна строка, без ANSI — индикатор ошибки не должен разрывать экран TUI
    const out = summarizeStderr(raw);
    expect(out).toBe('ValueError: Unable to find voice: /nonexistent.onnx');
    expect(out).not.toContain('\u001b[');
  });

  it('drops onnxruntime telemetry noise', () => {
    const raw =
      '\u001b[0;93m2026-10-01 [W:onnxruntime:Default] telemetry warning\u001b[m\nespeak: No such voice';
    expect(summarizeStderr(raw)).toBe('espeak: No such voice');
  });

  it('returns an empty string for pure noise', () => {
    expect(summarizeStderr('\u001b[0;93monnxruntime telemetry\u001b[m')).toBe('');
  });
});
