import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { existsSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type {
  TtsBackend,
  TtsEnginePaths,
  TtsInstallHint,
  TtsVoiceEntry,
  WavSource,
} from './backend.js';
import type { TtsChunk, TtsVoiceOptions } from './types.js';
import { commandAvailable, expandPath, modelSearchDirs } from './modelPaths.js';

/**
 * Бэкенд sherpa-onnx (https://github.com/k2-fsa/sherpa-onnx).
 *
 * Один готовый бинарник `sherpa-onnx-offline-tts` без Python умеет десятки
 * семейств моделей: VITS (в т.ч. MMS `rus` и конвертированные piper),
 * Kokoro, Matcha, KittenTTS, ZipVoice, Supertonic. Для tabook это закрывает
 * русский язык без килограммовых зависимостей torch.
 *
 * Установка (вне tabook):
 *   AUR:      yay -S sherpa-onnx
 *   prebuilt: sherpa-onnx-v1.13.x-linux-x64-shared.tar.bz2 из releases
 *
 * Модели (распакованные каталоги с model.onnx/tokens.txt):
 *   https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models
 *   например vits-mms-rus.tar.bz2 или vits-piper-ru_RU-irina-medium.tar.bz2
 *
 * Особенности CLI (проверено по исходникам sherpa-onnx-offline-tts.cc):
 *   - текст передаётся ЕДИНСТВЕННЫМ позиционным аргументом, не через stdin;
 *   - ровно один позиционный аргумент, лишние — ошибка;
 *   - модель: --vits-model + --vits-tokens, для piper-моделей ещё
 *     --vits-data-dir (espeak-ng-data) и/или --vits-dict-dir;
 *   - скорость: --speed (больше = быстрее) для VITS.
 */

/** Каталоги, где пользователь обычно распаковывает модели sherpa-onnx. */
function standardModelDirs(): string[] {
  const home = process.env.HOME ?? '';
  return [
    join(home, '.local/share/sherpa-onnx'),
    join(home, '.local/share/sherpa-onnx/tts'),
    join(home, '.local/share/sherpa/tts'),
    join(home, '.cache/sherpa-onnx'),
    join(home, 'sherpa-onnx-models'),
    join(home, 'tts-models'),
    join(home, '.config/sherpa-onnx'),
  ];
}

/**
 * Найти бинарник sherpa-onnx. Кроме PATH смотрим типичные места распаковки
 * prebuilt-архива — пользователь часто не делает symlink в ~/.local/bin.
 */
function sherpaBinCandidates(): string[] {
  const home = process.env.HOME ?? '';
  const out: string[] = [];
  const push = (p: string): void => {
    if (p) out.push(p);
  };
  push(join(home, '.local', 'bin', 'sherpa-onnx-offline-tts'));
  for (const base of [
    join(home, '.local/share/sherpa-onnx'),
    join(home, '.local/share/sherpa'),
    join(home, 'sherpa-onnx'),
  ]) {
    push(join(base, 'bin', 'sherpa-onnx-offline-tts'));
    push(join(base, 'sherpa-onnx-offline-tts'));
  }
  return out;
}

export class SherpaBackend implements TtsBackend {
  readonly id = 'sherpa';
  readonly label = 'sherpa-onnx (ONNX, no Python)';
  readonly capabilities = {
    languages: [
      'ru',
      'en',
      'de',
      'es',
      'fr',
      'it',
      'pl',
      'pt',
      'uk',
      'zh',
      'ja',
      'ko',
      'tr',
      'ar',
      'cs',
      'nl',
      'sv',
    ],
    offline: true,
    // --speed работает для VITS, а весь русский MMS/piper — это VITS.
    rateControl: true,
    pitchControl: false,
  } as const;

  private bin = '';
  private modelsDir = '';
  private model = '';

  constructor(command = '') {
    this.bin = command;
  }

  configure(paths: TtsEnginePaths): void {
    if (paths.command) this.bin = paths.command;
    this.modelsDir = paths.modelsDir;
    if (paths.model) this.model = paths.model;
  }

  installHint(): TtsInstallHint {
    return {
      package: 'sherpa-onnx',
      install: 'yay -S sherpa-onnx',
      notes:
        'Then unpack a model into ~/.local/share/sherpa-onnx (e.g. vits-mms-rus) ' +
        'and set [tts.engines.sherpa].model = "vits-mms-rus"',
    };
  }

  /** Голоса = распакованные каталоги моделей (model.onnx / *.onnx + tokens.txt). */
  async listVoices(): Promise<TtsVoiceEntry[]> {
    const dirs = modelSearchDirs({
      modelsDir: this.modelsDir,
      envVars: ['SHERPA_MODELS_DIR'],
      standardDirs: standardModelDirs(),
    });
    const out: TtsVoiceEntry[] = [];
    const seen = new Set<string>();
    // Модель sherpa-onnx — это каталог с .onnx и tokens.txt, поэтому ищем
    // каталоги, а не отдельные файлы (в отличие от piper, где голос = файл).
    const visit = (dir: string, depth: number): void => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (
        entries.some((e) => e.name === 'tokens.txt') &&
        entries.some((e) => e.name.endsWith('.onnx'))
      ) {
        const id = basename(dir);
        if (!seen.has(id)) {
          seen.add(id);
          out.push({ id, label: id });
        }
      }
      if (depth <= 0) return;
      for (const e of entries) {
        if (e.isDirectory()) visit(join(dir, e.name), depth - 1);
      }
    };
    for (const d of dirs) visit(d, 2);
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async check(): Promise<string | null> {
    const bin = this.resolveBin();
    if (!bin) {
      const h = this.installHint();
      return [
        'sherpa-onnx not found — TTS engine not installed.',
        '',
        'Install:',
        `  ${h.install ?? ''}`,
        '',
        'Or download the prebuilt binary from',
        '  https://github.com/k2-fsa/sherpa-onnx/releases',
        '',
        `Then unpack a model and set it: ${h.notes ?? ''}`,
      ].join('\n');
    }
    // Движок есть, но модель не выбрана/не найдена — подсказываем, что делать.
    const model = this.resolveModelDir();
    if (!model) {
      const voices = await this.listVoices();
      if (voices.length === 0) {
        return [
          'No sherpa-onnx model found.',
          '',
          'Download a model (unpacked into a directory), e.g.:',
          '  vits-mms-rus.tar.bz2                 (Russian)',
          '  vits-piper-ru_RU-irina-medium.tar.bz2 (Russian)',
          '  https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models',
          '',
          'Then point tabook at it in config.toml:',
          '',
          '  [tts.engines.sherpa]',
          '  models_dir = "~/.local/share/sherpa-onnx"',
          '  model = "vits-mms-rus"',
        ].join('\n');
      }
    }
    return null;
  }

  async synthesize(chunk: TtsChunk, opts: TtsVoiceOptions): Promise<WavSource> {
    const bin = this.resolveBin();
    if (!bin) throw new Error('sherpa-onnx binary not found (see :tts config → Engine)');
    const dir = this.resolveModelDir();
    if (!dir) {
      throw new Error(
        `sherpa model "${opts.voice ?? this.model}" not found — set [tts.engines.sherpa].model`,
      );
    }
    const onnx = findOnnxIn(dir);
    if (!onnx) throw new Error(`no .onnx model in ${dir}`);
    const tokens = join(dir, 'tokens.txt');
    if (!existsSync(tokens)) {
      throw new Error(`no tokens.txt in ${dir} — sherpa-onnx cannot build the phoneme table`);
    }
    const out = join(tmpdir(), `tabook-sherpa-${process.pid}-${rand()}.wav`);
    const args = [`--vits-model=${onnx}`, `--vits-tokens=${tokens}`, `--output-filename=${out}`];
    // Данные espeak обязательны для моделей, конвертированных из piper
    // (им нужен фонематизатор), и для VITS с лексиконом/словарём.
    for (const [dirName, flag] of [
      ['espeak-ng-data', '--vits-data-dir'],
      ['dict', '--vits-dict-dir'],
      ['lexicon.txt', '--vits-lexicon'],
    ] as const) {
      const p = join(dir, dirName);
      if (existsSync(p)) args.push(`${flag}=${p}`);
    }
    if (opts.rate && opts.rate !== 1) args.push(`--speed=${opts.rate.toFixed(2)}`);
    const threads = Number(opts.provider?.['num_threads'] ?? 0);
    if (Number.isFinite(threads) && threads > 0) args.push(`--num-threads=${Math.floor(threads)}`);
    // Текст — последним позиционным аргументом (требование sherpa CLI).
    // Плейеры, начинающиеся с «-», sherpa принял бы за флаг, поэтому дефис
    // в начале текста заменяем многоточием (на произношение не влияет).
    const text = sanitizeForCli(chunk.text);
    args.push(text);
    await runSherpa(bin, args);
    return { kind: 'file', path: out };
  }

  dispose(): void {
    /* разовый процесс на синтез — вызывается на каждый чанк */
  }

  // ---- внутреннее ----

  private resolveBin(): string {
    const explicit = expandPath(this.bin);
    if (explicit && existsSync(explicit)) return explicit;
    const fromEnv = expandPath(
      process.env.SHERPA_TTS_COMMAND ?? process.env.TABOOK_TTS_COMMAND ?? '',
    );
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    if (commandAvailable('sherpa-onnx-offline-tts')) return 'sherpa-onnx-offline-tts';
    for (const c of sherpaBinCandidates()) {
      if (existsSync(c)) return c;
    }
    return '';
  }

  /** Каталог модели: явный `model` → голос из opts → первый найденный. */
  private resolveModelDir(): string | null {
    const dirs = modelSearchDirs({
      modelsDir: this.modelsDir,
      envVars: ['SHERPA_MODELS_DIR'],
      standardDirs: standardModelDirs(),
    });
    const wanted = expandPath(this.model);
    if (wanted) {
      if (existsSync(wanted) && statSync(wanted).isDirectory()) return resolve(wanted);
      // Голос может быть коротким именем каталога (`vits-mms-rus`).
      for (const d of dirs) {
        const direct = join(d, wanted);
        if (existsSync(direct) && statSync(direct).isDirectory()) return direct;
        for (const sub of safeReaddir(d)) {
          if (!sub.isDirectory()) continue;
          if (sub.name === wanted) return join(d, sub.name);
        }
      }
      return null;
    }
    // Модель не задана — берём первую доступную, чтобы `:tts` работал сразу.
    for (const d of dirs) {
      const hit = findModelDirUnder(d, 2);
      if (hit) return hit;
    }
    return null;
  }
}

/** Найти каталог модели (содержит tokens.txt и .onnx) в поддереве. */
function findModelDirUnder(dir: string, depth: number): string | null {
  const entries = safeReaddir(dir);
  const hasTokens = entries.some((e) => e.name === 'tokens.txt');
  const hasOnnx = entries.some((e) => e.name.endsWith('.onnx'));
  if (hasTokens && hasOnnx) return dir;
  if (depth <= 0) return null;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findModelDirUnder(join(dir, e.name), depth - 1);
    if (hit) return hit;
  }
  return null;
}

function safeReaddir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findOnnxIn(dir: string): string | null {
  for (const e of safeReaddir(dir)) {
    if (e.isFile() && e.name.endsWith('.onnx')) return join(dir, e.name);
  }
  return null;
}

/**
 * Подготовить текст для позиционного аргумента CLI: вырезать управляющие
 * символы (NUL роняет C++-парсер) и не дать строке начаться с «-», иначе
 * sherpa посчитает её флагом и выведет usage вместо синтеза.
 */
export function sanitizeForCli(text: string): string {
  const clean = text
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.startsWith('-') ? `…${clean}` : clean;
}

function rand(): string {
  return Math.random().toString(36).slice(2);
}

/** Прогнать sherpa-onnx-offline-tts; резолвится по завершении процесса. */
function runSherpa(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString()).slice(-2048);
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') {
        rej(new Error(`sherpa-onnx binary not found: "${bin}". Install: yay -S sherpa-onnx`));
        return;
      }
      rej(e);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        rej(new Error(`sherpa-onnx failed (${code}): ${summarizeSherpaStderr(err)}`));
        return;
      }
      res();
    });
  });
}

/**
 * Сжать stderr до одной строки. sherpa печатает в stderr usage (десятки строк
 * с переносами) при любой ошибке конфигурации — в TUI это разорвёт экран,
 * поэтому оставляем только последнюю содержательную строку.
 */
export function summarizeSherpaStderr(raw: string): string {
  const lines = raw
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    // sherpa печатает адрес исходника вместо сообщения
    // ('file.cc:Func:38 ...'): путь неполезен, а сама причина нужна.
    .map((l) => l.replace(/^\S+\.(?:cc|h):[A-Za-z_]*:?\d*\s*/, ''))
    .filter((l) => l.length > 0)
    // Убираем usage: в TUI такой вывод рыхал бы экран.
    .filter((l) => !/^Usage:|^\s+--|^Please read/i.test(l));
  // Конкретная причина важнее общего «Errors in config!», которое sherpa
  // печатает последним при любой проблеме конфигурации.
  const specific = lines.filter((l) => /does not exist|no such|not found|cannot|unable/i.test(l));
  const generic = lines.filter((l) => /error|fail|invalid/i.test(l));
  const line = specific[specific.length - 1] ?? generic[generic.length - 1] ?? lines[0] ?? '';
  return line.slice(0, 200);
}
