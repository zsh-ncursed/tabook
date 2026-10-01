import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizeTtsText, summarizeStderr } from './piper.js';
import { testTmpdir } from '../testutil/tmpdir.js';

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

describe('PiperBackend config auto-repair', () => {
  it('downloads the missing .onnx.json config next to the model', async () => {
    const root = testTmpdir('piper-fix');
    // Голос лежит так, как его кладёт VoiceManager: <root>/<voiceId>/<file>
    const voiceId = 'ru/ru_RU/test/medium';
    const dir = path.join(root, ...voiceId.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const model = path.join(dir, 'ru_RU-test-medium.onnx');
    fs.writeFileSync(model, Buffer.from('fake-onnx'));

    const origModelsDir = process.env.PIPER_MODELS_DIR;
    const origCmd = process.env.TABOOK_TTS_COMMAND;
    process.env.PIPER_MODELS_DIR = root;
    // Несуществующий бинарник: ensureOnnx отработает до spawn, а синтез
    // ожидаемо упадёт — нам важен только момент авто-восстановления конфига.
    process.env.TABOOK_TTS_COMMAND = path.join(root, 'nonexistent-piper');

    // Перехватываем сетевой запрос: конфиг должен скачаться с HF.
    const downloaded: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('.onnx.json')) {
        downloaded.push(url);
        return new Response('{"audio": {}}', { status: 200 });
      }
      return new Response('model', { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      const { PiperBackend } = await import('./piper.js');
      const backend = new PiperBackend();
      try {
        await backend.synthesize(
          { text: 'тест', startChar: 0 },
          { voice: 'ru_RU-test-medium', rate: 1 },
        );
      } catch {
        // ожидаемо: бинарник не существует
      }

      // Конфиг скачался и лёг рядом с моделью — piper больше не упадёт
      expect(downloaded).toContain(
        'https://hf-mirror.com/rhasspy/piper-voices/resolve/main/ru/ru_RU/test/medium/ru_RU-test-medium.onnx.json',
      );
      expect(fs.existsSync(`${model}.json`)).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
      if (origModelsDir === undefined) delete process.env.PIPER_MODELS_DIR;
      else process.env.PIPER_MODELS_DIR = origModelsDir;
      if (origCmd === undefined) delete process.env.TABOOK_TTS_COMMAND;
      else process.env.TABOOK_TTS_COMMAND = origCmd;
      vi.resetModules();
    }
  });
});
