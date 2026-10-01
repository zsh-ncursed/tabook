import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TtsBackend, WavSource } from './backend.js';
import type { TtsChunk, TtsVoiceOptions } from './types.js';
import { commandAvailable } from './bincheck.js';

/**
 * Бэкенд Piper (https://github.com/rhasspy/piper).
 * Ожидает установленный `piper`/`piper-speak` в PATH и голос `.onnx` на диске.
 * Ничего не скачивает сам — только вызывает локальный движок.
 *
 * Установка (вне tabook): `pipx install piper-tts`, голоса — на HF
 * (rhasspy/piper-voices), русский, напр. `ru_RU-irina-medium`.
 */
export class PiperBackend implements TtsBackend {
  readonly id = 'piper';
  readonly label = 'Piper (local neural voices)';
  readonly capabilities = {
    languages: ['ru', 'en', 'de', 'es', 'fr', 'it', 'pl', 'pt', 'uk', 'sv', ...MORE_LANGS],
    offline: true,
    rateControl: false,
    // Piper не умеет менять pitch через CLI — только length_scale (rate).
    pitchControl: false,
  } as const;

  private bin: string;
  constructor(command = '') {
    this.bin = command;
  }

  async check(): Promise<string | null> {
    if (!this.bin && !commandAvailable('piper') && !commandAvailable('piper-speak')) {
      return [
        'piper not found in PATH.',
        '',
        'To fix:',
        '  1. Install:  pipx install piper-tts   (needs Python 3.9+)',
        '  2. Enable TTS: :tts config  →  set Engine to piper, or add to config.toml:',
        '',
        '     [tts]',
        '     mode = "active"',
        '     engine = "piper"',
        '     command = "/full/path/to/piper"   # only if piper is not in PATH',
        '',
        '  3. Download a voice: :tts config → Voice → pick one (e.g. ru_RU-irina-medium)',
      ].join('\n');
    }
    return null;
  }

  async synthesize(chunk: TtsChunk, opts: TtsVoiceOptions): Promise<WavSource> {
    const voice = opts.voice ?? 'ru_RU-irina-medium';
    const out = join(
      tmpdir(),
      `tabook-piper-${process.pid}-${Math.random().toString(36).slice(2)}.wav`,
    );
    const rate =
      opts.rate && opts.rate !== 1 ? [`--length_scale=${(1 / opts.rate).toFixed(2)}`] : [];
    const model = ensureOnnx(voice);
    const bin = resolvePiperBin(this.bin);
    await pipeTextToWav(bin, model, rate, sanitizeTtsText(chunk.text), out);
    return { kind: 'file', path: out };
  }

  dispose(): void {
    /* piper — разовый процесс на синтез, свободных ресурсов нет */
  }
}

// Дополнительные языки (полный список piper-голосов большой; этих достаточно для
// «любых языков» по умолчанию, остальные добавляются самим пользователем).
const MORE_LANGS = [
  'ar',
  'ca',
  'cs',
  'cy',
  'da',
  'el',
  'eo',
  'et',
  'fi',
  'hu',
  'is',
  'ka',
  'lb',
  'lt',
  'lv',
  'mt',
  'nl',
  'no',
  'ro',
  'sk',
  'sl',
  'sr',
  'sw',
  'vi',
];

/**
 * Очистить текст перед подачей в piper. Контрольные символы (особенно NUL)
 * роняют piper-фонематизатор с Python traceback; вырезаем всё, что не
 * печатаемое, оставляя перевод строки и табуляцию.
 */
export function sanitizeTtsText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
}

/** Какой бинарник запускать: явный [tts] command, иначе piper/piper-speak из PATH. */
function resolvePiperBin(command: string): string {
  if (command) return command;
  if (process.env.TABOOK_TTS_COMMAND) return process.env.TABOOK_TTS_COMMAND;
  if (commandAvailable('piper')) return 'piper';
  if (commandAvailable('piper-speak')) return 'piper-speak';
  // Автообнаружение в типичных местах установки piper-tts (pipx/pip venv),
  // чтобы не требовать ручной настройки.
  for (const candidate of autoPiperCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  // Ничего нет — отдаём 'piper'; spawn выведет понятную ошибку ENOENT,
  // которую менеджер покажет пользователю.
  return 'piper';
}

/** Типичные пути, куда pipx/pip ставит piper-tts. */
function autoPiperCandidates(): string[] {
  const home = process.env.HOME ?? '';
  const out: string[] = [];
  const push = (p: string): void => {
    if (p) out.push(p);
  };
  push(join(home, '.local', 'bin', 'piper'));
  push(join(home, '.local', 'pipx', 'venvs', 'piper-tts', 'bin', 'piper'));
  push(join(home, '.venv', 'bin', 'piper'));
  push(join(home, '.tts-venv', 'bin', 'piper'));
  // venv рядом с табуком (dev/тестовые окружения): поднимаемся от запускаемого
  // файла к корню пакета и ищем .tts-venv/bin/piper на каждом уровне.
  const start = process.argv[1] ? resolve(process.argv[1]) : resolve(process.cwd());
  let dir: string | null = dirname(start);
  for (let i = 0; i < 6 && dir; i++) {
    push(join(dir, '.tts-venv', 'bin', 'piper'));
    push(join(dir, 'venv', 'bin', 'piper'));
    const parent = dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return out;
}

/** Гарантировать, что имя голоса TTS — это путь к .onnx. */
function ensureOnnx(voice: string): string {
  // Явный путь к существующему .onnx — как есть.
  if (voice.endsWith('.onnx')) {
    const p = resolve(voice);
    if (existsSync(p)) return p;
  }
  // Короткое имя голоса (напр. 'ru_RU-irina-medium') — ищем .onnx в известных
  // каталогах с моделями piper.
  const base = voice.endsWith('.onnx') ? voice : `${voice}.onnx`;
  const hit = findModel(base);
  if (hit) return hit;
  // Ничего не нашли — отдаём как есть; piper выведет понятную ошибку.
  return base;
}

/** Каталоги, где piper-голоса обычно лежат (плюс piper --data-dir по умолчанию). */
function modelDirs(): string[] {
  const home = process.env.HOME ?? '~';
  const dirs = [
    join(home, '.local/share/piper'),
    join(home, '.local/share/piper/voices'),
    join(home, '.config/piper'),
    join(home, 'piper-voices'),
    join(home, 'tts-models'),
    join(home, '.local/share/piper/models'),
  ];
  if (process.env.PIPER_MODELS_DIR) dirs.unshift(process.env.PIPER_MODELS_DIR);
  // Модели рядом с найденным бинарем или корнем пакета (dev/тестовые окружения).
  const bin = resolvePiperBin('');
  if (bin.includes('/')) {
    const binDir = dirname(resolve(bin));
    dirs.unshift(join(binDir, '..', 'models'), join(binDir, '..', '.tts-models'));
  }
  const start = process.argv[1] ? resolve(process.argv[1]) : resolve(process.cwd());
  let dir: string | null = dirname(start);
  for (let i = 0; i < 6 && dir; i++) {
    dirs.unshift(join(dir, '.tts-models'), join(dir, 'tts-models'));
    const parent = dirname(dir);
    dir = parent === dir ? null : parent;
  }
  return dirs.filter((d) => existsSync(d));
}

/** Рекурсивно найти голос по имени в каталогах моделей (глубина 4). */
function findModel(base: string, dir?: string, depth = 4): string | null {
  const dirs = dir === undefined ? modelDirs() : [dir];
  for (const d of dirs) {
    const direct = join(d, base);
    if (existsSync(direct)) return direct;
    if (depth > 0) {
      for (const sub of readdirSync(d, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          const hit = findModel(base, join(d, sub.name), depth - 1);
          if (hit) return hit;
        }
      }
    }
  }
  return null;
}

/** Прогнать piper: текст в stdin -> wav-файл; резолвится по завершении. */
function pipeTextToWav(
  bin: string,
  model: string,
  extraArgs: string[],
  text: string,
  out: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['--model', model, '--output_file', out, ...extraArgs], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-1024);
    });
    child.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            `piper binary not found: "${bin}". Install piper-tts (pipx install piper-tts) or set [tts] command = "/full/path/to/piper" in config.toml`,
          ),
        );
        return;
      }
      reject(e);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`piper failed (${code}): ${err.trim()}`));
        return;
      }
      resolve();
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}
