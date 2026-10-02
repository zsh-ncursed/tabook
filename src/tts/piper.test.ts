import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sanitizeTtsText, summarizeStderr, piperBinCandidates } from './piper.js';
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

describe('piperBinCandidates', () => {
  it('includes the real pipx venvs dir (~/.local/share/pipx), not only the legacy one', () => {
    // Баг: pipx кладёт venvs в ~/.local/share/pipx/venvs (подтверждено pipx list),
    // автопоиск смотрел только в несуществующий ~/.local/pipx/venvs.
    const home = process.env.HOME ?? '';
    const cands = piperBinCandidates();
    expect(cands).toContain(
      path.join(home, '.local', 'share', 'pipx', 'venvs', 'piper-tts', 'bin', 'piper'),
    );
    expect(cands).toContain(
      path.join(home, '.local', 'pipx', 'venvs', 'piper-tts', 'bin', 'piper'),
    );
  });

  it('includes the standalone release layout (~/.local/share/piper-tts/piper/piper)', () => {
    // Распаковка piper_linux_x86_64.tar.gz из rhasspy/piper releases:
    // внутри архива — piper/piper; без симлинка в ~/.local/bin его не найти.
    const home = process.env.HOME ?? '';
    expect(piperBinCandidates()).toContain(
      path.join(home, '.local', 'share', 'piper-tts', 'piper', 'piper'),
    );
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

describe('PiperBackend.check', () => {
  // piper не входит в depends пакета — check() обязан объяснить, что ставить.
  it('tells the user to install piper-tts from AUR when no binary is found', async () => {
    const origPath = process.env.PATH;
    const origHome = process.env.HOME;
    // Пустой PATH + пустой HOME: ни piper, ни кандидаты в ~/.local не найдутся.
    process.env.PATH = testTmpdir('tts-check-path');
    process.env.HOME = testTmpdir('tts-check-home');
    fs.mkdirSync(process.env.PATH, { recursive: true });
    fs.mkdirSync(process.env.HOME, { recursive: true });
    try {
      const { PiperBackend } = await import('./piper.js');
      const problem = await new PiperBackend('').check();
      expect(problem).toContain('yay -S piper-tts');
      expect(problem).toContain('pipx install piper-tts');
    } finally {
      process.env.PATH = origPath;
      process.env.HOME = origHome;
    }
  });

  it('stays silent when the binary is available', async () => {
    const { PiperBackend } = await import('./piper.js');
    // Явный command — движок считаем установленным, notification не нужна.
    expect(await new PiperBackend('/usr/bin/piper').check()).toBeNull();
  });
});
